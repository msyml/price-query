const BASE = 'https://open.feishu.cn/open-apis';

/** 用自建应用凭证换取 tenant_access_token */
export async function getTenantAccessToken({ appId, appSecret }) {
  const res = await fetch(`${BASE}/auth/v3/tenant_access_token/internal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret })
  });
  const data = await res.json();
  if (data.code !== 0 || !data.tenant_access_token) {
    throw new Error(`获取 tenant_access_token 失败: ${data.code} ${data.msg}`);
  }
  return data.tenant_access_token;
}

/** 分页拉取整张数据表的所有记录 */
export async function fetchAllRecords({ token, appToken, tableId, pageSize = 500 }) {
  const items = [];
  let pageToken = '';
  let page = 0;

  do {
    const url = new URL(`${BASE}/bitable/v1/apps/${appToken}/tables/${tableId}/records`);
    url.searchParams.set('page_size', String(pageSize));
    if (pageToken) url.searchParams.set('page_token', pageToken);

    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const data = await res.json();
    if (data.code !== 0) {
      throw new Error(`读取记录失败: ${data.code} ${data.msg}`);
    }

    items.push(...(data.data?.items ?? []));
    pageToken = data.data?.page_token ?? '';
    page += 1;
    console.log(`  第 ${page} 页 -> 累计 ${items.length} 条`);
  } while (pageToken);

  return items;
}