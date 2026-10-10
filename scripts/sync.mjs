import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getTenantAccessToken, fetchAllRecords } from './lib/feishu.mjs';
import { normalizeRecords, writeSnapshot } from './lib/snapshot.mjs';

if (existsSync('.env')) process.loadEnvFile('.env');

const OUT_PATH = resolve('public/data/snapshot.enc.json');

export async function runSync() {
  const appId = process.env.FEISHU_APP_ID?.trim();
  const appSecret = process.env.FEISHU_APP_SECRET?.trim();
  const appToken = process.env.FEISHU_APP_TOKEN?.trim();
  const tableId = process.env.FEISHU_TABLE_ID?.trim();
  const passcode = process.env.ACCESS_PASSCODE;

  const missing = [];
  if (!appId) missing.push('FEISHU_APP_ID');
  if (!appSecret) missing.push('FEISHU_APP_SECRET');
  if (!appToken) missing.push('FEISHU_APP_TOKEN');
  if (!tableId) missing.push('FEISHU_TABLE_ID');
  if (!passcode) missing.push('ACCESS_PASSCODE');
  if (missing.length) {
    throw new Error(`.env 缺少配置: ${missing.join(', ')}`);
  }

  console.log('1/3 获取 tenant_access_token ...');
  const token = await getTenantAccessToken({ appId, appSecret });

  console.log('2/3 拉取价目表记录 ...');
  const records = await fetchAllRecords({ token, appToken, tableId });
  const rows = normalizeRecords(records);

  console.log(`3/3 写入加密快照（${rows.length} 条）...`);
  const blob = writeSnapshot(rows, passcode, OUT_PATH);

  console.log(`完成: ${OUT_PATH}`);
  console.log(`  记录数: ${blob.count}`);
  console.log(`  生成时间: ${blob.generatedAt}`);
  return blob;
}

const isDirectRun = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  runSync().catch((err) => {
    console.error(`同步失败: ${err.message}`);
    process.exit(1);
  });
}