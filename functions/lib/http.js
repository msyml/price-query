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