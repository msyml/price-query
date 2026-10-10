/** 飞书多维表格读写封装，凭证来自 Pages 环境变量 */
import { HttpError } from './http.js';

const BASE = 'https://open.feishu.cn/open-apis';

// token 在单个 Workers 实例内复用，避免每次请求都换一次
let tokenCache = { value: '', expiresAt: 0 };

async function getToken(env) {
  const now = Date.now();
  if (tokenCache.value && tokenCache.expiresAt > now + 60_000) return tokenCache.value;

  const res = await fetch(`${BASE}/auth/v3/tenant_access_token/internal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ app_id: env.FEISHU_APP_ID, app_secret: env.FEISHU_APP_SECRET })
  });
  const data = await res.json();
  if (data.code !== 0 || !data.tenant_access_token) {
    throw new HttpError(`获取 tenant_access_token 失败：${data.code} ${data.msg}`, 502);
  }
  tokenCache = {
    value: data.tenant_access_token,
    expiresAt: now + (data.expire ?? 7200) * 1000
  };
  return tokenCache.value;
}

async function call(env, path, { method = 'GET', query, body } = {}) {
  const token = await getToken(env);
  const url = new URL(BASE + path);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== '') url.searchParams.set(key, String(value));
  }

  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json; charset=utf-8' } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json();
  if (data.code !== 0) {
    throw new HttpError(`飞书接口错误：${data.code} ${data.msg}`, 502);
  }
  return data.data;
}

const recordsPath = (env) =>
  `/bitable/v1/apps/${env.FEISHU_APP_TOKEN}/tables/${env.FEISHU_TABLE_ID}/records`;
const fieldsPath = (env) =>
  `/bitable/v1/apps/${env.FEISHU_APP_TOKEN}/tables/${env.FEISHU_TABLE_ID}/fields`;

/** 分页拉取整表记录 */
export async function listRecords(env) {
  const items = [];
  let pageToken = '';
  do {
    const data = await call(env, recordsPath(env), {
      query: { page_size: 500, page_token: pageToken }
    });
    items.push(...(data.items ?? []));
    pageToken = data.page_token ?? '';
  } while (pageToken);
  return items;
}

/** 读取字段定义，用于取「单选」字段的可选值 */
export async function listFields(env) {
  const data = await call(env, fieldsPath(env), { query: { page_size: 100 } });
  return data.items ?? [];
}

export async function createRecord(env, fields) {
  const data = await call(env, recordsPath(env), { method: 'POST', body: { fields } });
  return data.record;
}

export async function updateRecord(env, recordId, fields) {
  const data = await call(env, `${recordsPath(env)}/${recordId}`, {
    method: 'PUT',
    body: { fields }
  });
  return data.record;
}

export async function deleteRecord(env, recordId) {
  await call(env, `${recordsPath(env)}/${recordId}`, { method: 'DELETE' });
}