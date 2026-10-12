/** 记录归一化、拼音生成、表单校验（与 scripts/lib/snapshot.mjs 保持同一套规则） */
import { pinyin } from 'pinyin-pro';
import { HttpError } from './http.js';

// 必须与多维表格字段名完全一致
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

const pickText = (value) => {
  if (value == null) return '';
  if (Array.isArray(value)) return value.length ? String(value[0]).trim() : '';
  return String(value).trim();
};

const pickNumber = (value) => {
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

/** 与表格「拼音简称」一致的规则：品牌首字母 + 商品名首字母 */
export const makePinyin = (brand, name) => pinyinInitials(brand) + pinyinInitials(name);

/** 飞书记录 -> 前端使用的最小结构（字段名用短键减小体积） */
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

/** 校验并规整新增/编辑的入参；商品名称、所属分类、零售价必填，品牌可留空 */
export function validateInput(body) {
  const name = String(body.name ?? '').trim();
  const brand = String(body.brand ?? '').trim();
  const category = String(body.category ?? '').trim();
  const retailRaw = body.retail;

  if (!name) throw new HttpError('商品名称不能为空', 400);
  if (!category) throw new HttpError('所属分类不能为空', 400);
  if (retailRaw === '' || retailRaw == null) throw new HttpError('零售价不能为空', 400);

  const retail = Number(retailRaw);
  if (!Number.isFinite(retail) || retail < 0) {
    throw new HttpError('零售价必须是不小于 0 的数字', 400);
  }

  return { name, brand, category, retail };
}

/** 入参 -> 飞书 fields（零售价为数字字段，分类为单选字段）；品牌为空时不写该字段 */
export const toFields = ({ name, brand, category, retail }) => {
  const fields = {
    [FIELD.name]: name,
    [FIELD.category]: category,
    [FIELD.retail]: retail,
    [FIELD.pinyin]: makePinyin(brand, name)
  };
  if (brand) fields[FIELD.brand] = brand;
  return fields;
};

/** 从字段定义里取出某个单选字段的可选值 */
export function selectOptions(fields, fieldName) {
  const field = fields.find((item) => item.field_name === fieldName);
  return (field?.property?.options ?? []).map((option) => option.name).filter(Boolean);
}