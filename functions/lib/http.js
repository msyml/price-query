/** 统一响应与鉴权工具（Cloudflare Pages Functions 运行时） */

export class HttpError extends Error {
  constructor(message, status = 500) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

export const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    }
  });

/** 校验请求头里的口令，与 Pages 环境变量 ACCESS_PASSCODE 比对（定时比较） */
export function authorize(request, env) {
  const expected = env.ACCESS_PASSCODE;
  if (!expected) return false;
  const got = request.headers.get('x-passcode') ?? '';
  if (got.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i += 1) {
    diff |= got.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

/** 把请求体解析成普通对象，非法 JSON 视为空对象交给后续校验报错 */
export const readJson = async (request) => {
  try {
    const data = await request.json();
    return data && typeof data === 'object' ? data : {};
  } catch {
    return {};
  }
};

export function handleError(err) {
  if (err instanceof HttpError) return json({ error: err.message }, err.status);
  console.error('未处理异常:', err);
  return json({ error: `服务器错误：${err?.message ?? '未知'}` }, 500);
}

/* ---------- 短时间高频请求限制 ---------- */

/**
 * 内存态滑动窗口限流（best-effort）。
 *
 * 状态只存在于当前 Worker 实例内，多实例 / 多边缘节点下为近似值；
 * 本项目请求量很低，够用。若需全局精确限流，应改用 KV 或 Durable Objects。
 */
const HITS = new Map(); // 来源标识 -> 窗口内已放行的请求时间戳数组
let lastSweep = 0;

function limitConfig(env) {
  const max = Number(env?.RATE_LIMIT_MAX ?? 60); // 每窗口允许的请求数，<=0 表示关闭
  const windowMs = Number(env?.RATE_LIMIT_WINDOW_MS ?? 60000); // 窗口长度（毫秒）
  return { max, windowMs };
}

/** 取调用方标识：优先 Cloudflare 真实 IP，其次 X-Forwarded-For，最后回退 */
function clientKey(request) {
  const ip =
    request.headers.get('cf-connecting-ip') ||
    request.headers.get('x-forwarded-for')?.split(',')[0].trim();
  return ip || 'unknown';
}

/** 返回 { ok, retryAfter }；ok 为 false 时表示该请求已被限流 */
export function rateLimit(request, env) {
  const { max, windowMs } = limitConfig(env);
  if (!(max > 0) || !(windowMs > 0)) return { ok: true };

  const now = Date.now();

  // 惰性清理：每过一个窗口才扫一次，避免 Map 无限增长
  if (now - lastSweep > windowMs) {
    for (const [key, times] of HITS) {
      const kept = times.filter((t) => now - t < windowMs);
      if (kept.length) HITS.set(key, kept);
      else HITS.delete(key);
    }
    lastSweep = now;
  }

  const key = clientKey(request);
  const times = (HITS.get(key) ?? []).filter((t) => now - t < windowMs);

  if (times.length >= max) {
    HITS.set(key, times);
    const retryAfter = Math.max(1, Math.ceil((windowMs - (now - times[0])) / 1000));
    return { ok: false, retryAfter };
  }

  times.push(now);
  HITS.set(key, times); // 数组长度受 max 约束，天然有界
  return { ok: true };
}

/** 429 响应 */
export function tooMany(retryAfter = 60) {
  return new Response(JSON.stringify({ error: '请求过于频繁，请稍后再试' }), {
    status: 429,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Retry-After': String(retryAfter)
    }
  });
}