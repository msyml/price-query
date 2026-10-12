/**
 * 记录归一化、拼音生成、表单校验（Cloudflare Pages Functions 运行时）。
 *
 * 纯逻辑（字段映射 / 拼音 / 数值归一化）已抽到 shared/pricing.js，
 * 与 scripts/ 的快照流水线共用同一份实现，避免两处规则漂移。
 * 这里只保留 Functions 侧特有的 HTTP 校验与写入组装。
 */
import { HttpError } from './http.js';
import { FIELD, makePinyin, selectOptions, toRow } from '../../shared/pricing.js';

// 重新导出，保持 functions 内部原有引用路径不变
export { FIELD, makePinyin, selectOptions, toRow };

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

/**
 * 入参 -> 飞书 fields（零售价为数字字段，分类为单选字段）。
 *
 * 品牌为空时的处理分两种场景，务必区分：
 * - 新增（默认）：**不写**该字段，避免在单选字段里凭空建出一个空的品牌选项。
 * - 编辑（clearBrand = true）：**显式写 null** 清空，否则旧品牌会残留在记录上，
 *   而拼音简称已按「无品牌」重新生成，两个字段互相矛盾、品牌搜索也会失准。
 *
 * 新建品牌选项由飞书在写入非空值时自动完成，清空不需要额外接口。
 */
export const toFields = ({ name, brand, category, retail }, { clearBrand = false } = {}) => {
  const fields = {
    [FIELD.name]: name,
    [FIELD.category]: category,
    [FIELD.retail]: retail,
    [FIELD.pinyin]: makePinyin(brand, name)
  };
  if (brand) fields[FIELD.brand] = brand;
  else if (clearBrand) fields[FIELD.brand] = null;
  return fields;
};
