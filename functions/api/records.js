/** /api/records —— 列表读取 + 新增 */
import { listRecords, listFields, createRecord } from '../lib/feishu.js';
import { toRow, toFields, validateInput, selectOptions, FIELD } from '../lib/normalize.js';
import { json, authorize, readJson, handleError } from '../lib/http.js';

export async function onRequestGet({ request, env }) {
  if (!authorize(request, env)) return json({ error: '口令不正确' }, 401);
  try {
    const [records, fields] = await Promise.all([listRecords(env), listFields(env)]);
    const rows = records.map(toRow).filter((row) => row.n);
    return json({
      rows,
      brands: selectOptions(fields, FIELD.brand),
      categories: selectOptions(fields, FIELD.category),
      count: rows.length,
      generatedAt: new Date().toISOString()
    });
  } catch (err) {
    return handleError(err);
  }
}

export async function onRequestPost({ request, env }) {
  if (!authorize(request, env)) return json({ error: '口令不正确' }, 401);
  try {
    const payload = validateInput(await readJson(request));
    const record = await createRecord(env, toFields(payload));
    return json({ ok: true, row: toRow(record) });
  } catch (err) {
    return handleError(err);
  }
}