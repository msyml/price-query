/** /api/records/:id —— 编辑 + 删除 */
import { updateRecord, deleteRecord } from '../../lib/feishu.js';
import { toRow, toFields, validateInput } from '../../lib/normalize.js';
import { json, authorize, readJson, handleError } from '../../lib/http.js';

export async function onRequestPut({ request, env, params }) {
  if (!authorize(request, env)) return json({ error: '口令不正确' }, 401);
  try {
    const payload = validateInput(await readJson(request));
    const record = await updateRecord(env, params.id, toFields(payload));
    return json({ ok: true, row: toRow(record) });
  } catch (err) {
    return handleError(err);
  }
}

export async function onRequestDelete({ request, env, params }) {
  if (!authorize(request, env)) return json({ error: '口令不正确' }, 401);
  try {
    await deleteRecord(env, params.id);
    return json({ ok: true });
  } catch (err) {
    return handleError(err);
  }
}