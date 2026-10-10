// 一次性数据治理脚本：按「全拼首字母缩写」重算 拼音简称 并生成回写用 payload。
// 用法：node scripts/fill-pinyin.mjs <names.ndjson> [输出前缀]
import { readFileSync, writeFileSync } from 'node:fs';
import { pinyin } from 'pinyin-pro';

const inputPath = process.argv[2] ?? 'names.ndjson';
const outPrefix = process.argv[3] ?? 'pinyin-updates';
const CHUNK_SIZE = 200; // 飞书单批上限

const records = readFileSync(inputPath, 'utf8')
  .trim()
  .split(/\r?\n/)
  .map((line) => JSON.parse(line));

/** 芝士熔岩包 -> zsryb；「冰+芒果泥」-> bmgn（标点丢弃，英文数字保留） */
function abbreviate(name) {
  return pinyin(String(name), {
    pattern: 'first',
    toneType: 'none',
    type: 'array',
    nonZh: 'consecutive'
  })
    .join('')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

const updates = {};
const preview = [];
for (const record of records) {
  const name = record['商品名称'];
  if (!name) continue;
  const abbr = abbreviate(name);
  if (!abbr) continue;
  updates[record.record_id] = { 拼音简称: abbr };
  preview.push([name, abbr]);
}

const ids = Object.keys(updates);
let chunkIndex = 0;
for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
  const slice = ids.slice(i, i + CHUNK_SIZE);
  const payload = {
    update_records: Object.fromEntries(slice.map((id) => [id, updates[id]]))
  };
  const file = `${outPrefix}-${++chunkIndex}.json`;
  writeFileSync(file, JSON.stringify(payload), 'utf8');
  console.log(`写出 ${file}（${slice.length} 条）`);
}

console.log(`\n总计 ${ids.length} 条；预览前 15 条：`);
for (const [name, abbr] of preview.slice(0, 15)) {
  console.log(`  ${name} -> ${abbr}`);
}