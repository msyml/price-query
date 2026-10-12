/**
 * 价目表纯逻辑（字段映射 + 拼音简称 + 数值归一化）。
 *
 * 这个模块同时被两条链路使用，**不得引入任何运行时专有依赖**：
 * - functions/  → Cloudflare Workers（由 wrangler 打包，无 Node 内置模块）
 * - scripts/    → 本地/CI 的 Node 快照流水线
 *
 * 因此这里只能有纯函数 + pinyin-pro。加密（node:crypto）与落盘（node:fs）
 * 留在 scripts/lib/snapshot.mjs。
 *
 * 历史背景：这段逻辑原先在 functions/lib/normalize.js 与 scripts/lib/snapshot.mjs
 * 各抄了一份，注释写着「保持同一套规则」却没有机制约束；一旦漂移，
 * 新增记录的拼音简称就会和历史数据不一致。现在只有这一份。
 */
import { pinyin } from 'pinyin-pro';

/** 多维表格字段名，必须与表格完全一致（改名后接口会读到空值） */
export const FIELD = {
  name: '商品名称',
  brand: '商品品牌',
  category: '所属分类',
  barcode: '商品条码',
  wholesale: '批发价',
  retail: '零售价',
  bulk: '散称价',
  pack: '整箱|整包',
  pinyin: '拼音简称'
};

/** 取文本：数组（多选/富文本）取首项，其余转字符串并 trim */
export const pickText = (value) => {
  if (value == null) return '';
  if (Array.isArray(value)) return value.length ? String(value[0]).trim() : '';
  return String(value).trim();
};

/** 取数值：空值/非法值一律返回 null，避免把 NaN 写进数字字段 */
export const pickNumber = (value) => {
  if (value == null || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

/** 取中文拼音首字母，非中文/符号一律剔除，只保留 a-z0-9 */
export function pinyinInitials(text) {
  const cleaned = String(text ?? '').replace(/[^\u4e00-\u9fa5A-Za-z0-9]/g, '');
  if (!cleaned) return '';
  return pinyin(cleaned, { pattern: 'first', toneType: 'none', type: 'array' })
    .join('')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/**
 * 拼音结果缓存：拼音首字母要过一遍 350KB 的词典做分词，单次约几毫秒。
 * 列表请求会对「拼音简称」为空的历史记录逐行回退计算，同一串文字反复出现
 * （品牌尤其集中），缓存能把这部分开销摊掉。上限设死，防止长期运行无限增长。
 */
const PINYIN_CACHE_MAX = 2000;
const pinyinCache = new Map();

function cachedPinyinInitials(text) {
  const key = String(text ?? '');
  const hit = pinyinCache.get(key);
  if (hit !== undefined) return hit;

  const value = pinyinInitials(key);
  // 简单的 FIFO 淘汰：Map 保证插入顺序，超限就丢最早的一条
  if (pinyinCache.size >= PINYIN_CACHE_MAX) {
    pinyinCache.delete(pinyinCache.keys().next().value);
  }
  pinyinCache.set(key, value);
  return value;
}

/** 与表格「拼音简称」一致的规则：品牌首字母 + 商品名首字母 */
export const makePinyin = (brand, name) =>
  cachedPinyinInitials(brand) + cachedPinyinInitials(name);

/**
 * 飞书记录 -> 前端使用的最小结构（字段名用短键减小体积）。
 * 只有在表格里「拼音简称」缺失时才回退计算，正常记录零成本。
 */
export function toRow(record) {
  const f = record.fields ?? record;
  const name = pickText(f[FIELD.name]);
  const brand = pickText(f[FIELD.brand]);
  const stored = pickText(f[FIELD.pinyin]);
  return {
    rec: record.record_id,
    n: name,
    br: brand,
    c: pickText(f[FIELD.category]),
    bc: pickText(f[FIELD.barcode]),
    py: stored || makePinyin(brand, name),
    w: pickNumber(f[FIELD.wholesale]),
    r: pickNumber(f[FIELD.retail]),
    s: pickText(f[FIELD.bulk]),
    pk: pickText(f[FIELD.pack])
  };
}

/** 把飞书记录列表压成行，并丢掉没有商品名称的行（表格里的空行/草稿） */
export const normalizeRecords = (records) =>
  records.map(toRow).filter((row) => row.n);

/** 从字段定义里取出某个单选字段的可选值 */
export function selectOptions(fields, fieldName) {
  const field = fields.find((item) => item.field_name === fieldName);
  return (field?.property?.options ?? []).map((option) => option.name).filter(Boolean);
}
