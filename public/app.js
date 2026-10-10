const API = './api/records';
const STORAGE_KEY = 'price_query_passcode';

const el = (id) => document.getElementById(id);

const gate = el('gate');
const gateForm = el('gate-form');
const gateInput = el('gate-input');
const gateSubmit = el('gate-submit');
const gateError = el('gate-error');

const app = el('app');
const list = el('list');
const empty = el('empty');
const resultCount = el('result-count');
const exactTag = el('tag-exact');
const qInput = el('q');
const clearBtn = el('clear-btn');
const brandSelect = el('brand');
const catSelect = el('cat');

const editor = el('editor');
const editorForm = el('editor-form');
const editorTitle = el('editor-title');
const editorMsg = el('editor-msg');
const editorSave = el('editor-save');
const fName = el('f-name');
const fBrand = el('f-brand');
const fCat = el('f-cat');
const fRetail = el('f-retail');

let passcode = '';
let rows = [];
let brands = [];
let categories = [];
let index = [];
let editingId = null;

/* ---------- 后端接口（口令放在请求头） ---------- */

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: {
      'x-passcode': passcode,
      ...(body ? { 'Content-Type': 'application/json' } : {})
    },
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store'
  });

  let data = {};
  try {
    data = await res.json();
  } catch {
    /* 非 JSON 响应按空对象处理 */
  }
  if (!res.ok) {
    // 已解锁状态下收到 401 说明服务端口令已变更，清除缓存并要求重新输入
    if (res.status === 401 && !app.hidden) relock('访问口令已更新，请重新输入');
    const err = new Error(data.error || `请求失败（${res.status}）`);
    err.status = res.status;
    throw err;
  }
  return data;
}

async function fetchData() {
  const data = await api(API);
  rows = data.rows ?? [];
  brands = data.brands ?? [];
  categories = data.categories ?? [];

  index = rows.map((row) => ({
    row,
    hay: `${row.n} ${row.py} ${row.bc}`.toLowerCase()
  }));

  el('meta-count').textContent = `共 ${data.count ?? rows.length} 个商品`;
  el('meta-time').textContent = formatTime(data.generatedAt);
  fillSelect(brandSelect, '全部品牌', rows.map((r) => r.br));
  fillSelect(catSelect, '全部分类', rows.map((r) => r.c));
}

/* ---------- 解锁流程 ---------- */

gateForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const value = gateInput.value;
  if (!value) return;

  gateSubmit.disabled = true;
  gateError.hidden = true;
  passcode = value;
  try {
    await fetchData();
    localStorage.setItem(STORAGE_KEY, value);
    gate.hidden = true;
    app.hidden = false;
    render();
  } catch (err) {
    passcode = '';
    gateError.textContent =
      err.status === 401 ? '口令不正确，请重试' : `无法加载数据：${err.message}`;
    gateError.hidden = false;
    gateInput.select();
  } finally {
    gateSubmit.disabled = false;
  }
});

function relock(message = '') {
  localStorage.removeItem(STORAGE_KEY);
  passcode = '';
  rows = [];
  closeEditor();
  app.hidden = true;
  gate.hidden = false;
  gateInput.value = '';
  gateError.textContent = message;
  gateError.hidden = !message;
  gateInput.focus();
}

el('lock-btn').addEventListener('click', () => relock());

/* ---------- 筛选 ---------- */

function fillSelect(select, placeholder, values) {
  const counts = new Map();
  for (const value of values) {
    if (!value) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  const sorted = [...counts.entries()].sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh')
  );

  select.innerHTML = `<option value="">${placeholder}</option>`;
  for (const [name, count] of sorted) {
    const option = document.createElement('option');
    option.value = name;
    option.textContent = `${name} (${count})`;
    select.append(option);
  }
}

function queryRows() {
  const raw = qInput.value.trim();
  const tokens = raw.toLowerCase().split(/\s+/).filter(Boolean);
  const brand = brandSelect.value;
  const cat = catSelect.value;

  let result = index;
  if (brand) result = result.filter((x) => x.row.br === brand);
  if (cat) result = result.filter((x) => x.row.c === cat);
  if (tokens.length) {
    result = result.filter((x) => tokens.every((t) => x.hay.includes(t)));
  }

  // 条码精确查询：输入完整数字条码且命中时，只返回该商品
  let exact = false;
  if (/^\d{6,}$/.test(raw)) {
    const hit = result.filter((x) => x.row.bc === raw);
    if (hit.length) {
      result = hit;
      exact = true;
    }
  }

  return { rows: result.map((x) => x.row), exact };
}

/* ---------- 渲染 ---------- */

function render() {
  const { rows: matched, exact } = queryRows();

  exactTag.hidden = !exact;
  resultCount.textContent = `匹配 ${matched.length} 个商品`;
  clearBtn.hidden = !qInput.value;

  if (!matched.length) {
    list.innerHTML = '';
    empty.hidden = false;
    return;
  }
  empty.hidden = true;
  list.innerHTML = matched.map(cardHTML).join('');
}

function cardHTML(row) {
  const badges = [
    row.br ? `<span class="badge brand">${esc(row.br)}</span>` : '',
    row.c ? `<span class="badge cat">${esc(row.c)}</span>` : ''
  ].join('');

  const extras = [
    row.s ? `<span><i>散称价</i><b>${esc(row.s)}</b></span>` : '',
    row.pk ? `<span><i>整箱|整包</i><b>${esc(row.pk)}</b></span>` : ''
  ].join('');

  return `<article class="card">
    <div class="card-top">
      <h2 class="name">${esc(row.n)}</h2>
      ${badges ? `<div class="badges">${badges}</div>` : ''}
    </div>
    ${row.bc ? `<p class="barcode">${esc(row.bc)}</p>` : ''}
    <div class="prices">
      <div class="price"><span>批发价</span>${money(row.w)}</div>
      <div class="price"><span>零售价</span>${money(row.r)}</div>
    </div>
    ${extras ? `<div class="extras">${extras}</div>` : ''}
    <div class="card-actions">
      <button type="button" class="link" data-act="edit" data-rec="${esc(row.rec)}">编辑</button>
    </div>
  </article>`;
}

const esc = (value) =>
  String(value).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function money(value) {
  if (value == null) return '<strong class="miss">—</strong>';
  return `<strong>¥${value}</strong>`;
}

function formatTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso ?? '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

let renderTimerSet;
function scheduleRender() {
  clearTimeout(renderTimerSet);
  renderTimerSet = setTimeout(render, 80);
}

qInput.addEventListener('input', scheduleRender);
brandSelect.addEventListener('change', render);
catSelect.addEventListener('change', render);

clearBtn.addEventListener('click', () => {
  qInput.value = '';
  render();
  qInput.focus();
});

el('reset-btn').addEventListener('click', () => {
  qInput.value = '';
  brandSelect.value = '';
  catSelect.value = '';
  render();
});

/* ---------- 添加 / 编辑弹窗 ---------- */

function fillEditorSelects() {
  const options = (values, placeholder) =>
    `<option value="">${placeholder}</option>` +
    values.map((v) => `<option value="${esc(v)}">${esc(v)}</option>`).join('');
  fBrand.innerHTML = options(brands, '请选择品牌');
  fCat.innerHTML = options(categories, '请选择分类');
}

function showEditorMsg(text, isError = true) {
  editorMsg.textContent = text;
  editorMsg.classList.toggle('error', isError);
  editorMsg.hidden = !text;
}

function openEditor(mode, row) {
  editingId = mode === 'edit' ? row.rec : null;
  fillEditorSelects();
  editorTitle.textContent = mode === 'edit' ? '编辑商品' : '添加商品';
  editorSave.textContent = mode === 'edit' ? '保存' : '添加';
  editorSave.disabled = false;
  showEditorMsg('');
  fName.value = row?.n ?? '';
  fBrand.value = row?.br ?? '';
  fCat.value = row?.c ?? '';
  fRetail.value = row?.r ?? '';
  editor.hidden = false;
  fName.focus();
}

function closeEditor() {
  editor.hidden = true;
  editingId = null;
}

el('add-btn').addEventListener('click', () => openEditor('add'));
el('editor-cancel').addEventListener('click', closeEditor);
editor.addEventListener('click', (event) => {
  if (event.target === editor) closeEditor();
});

editorForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  const payload = {
    name: fName.value.trim(),
    brand: fBrand.value,
    category: fCat.value,
    retail: fRetail.value
  };

  if (!payload.name) return showEditorMsg('请填写商品名称');
  if (!payload.brand) return showEditorMsg('请选择商品品牌');
  if (!payload.category) return showEditorMsg('请选择所属分类');
  if (payload.retail === '' || !Number.isFinite(Number(payload.retail)) || Number(payload.retail) < 0) {
    return showEditorMsg('请填写有效的零售价');
  }

  editorSave.disabled = true;
  showEditorMsg(editingId ? '保存中…' : '添加中…', false);

  try {
    if (editingId) {
      await api(`${API}/${encodeURIComponent(editingId)}`, { method: 'PUT', body: payload });
    } else {
      await api(API, { method: 'POST', body: payload });
    }
    closeEditor();
    await fetchData();
    render();
  } catch (err) {
    showEditorMsg(err.message);
    editorSave.disabled = false;
  }
});

/* ---------- 列表上的编辑 ---------- */

list.addEventListener('click', (event) => {
  const btn = event.target.closest('button[data-act]');
  if (!btn || btn.dataset.act !== 'edit') return;

  const row = rows.find((r) => r.rec === btn.dataset.rec);
  if (row) openEditor('edit', row);
});

/* ---------- 刷新 ---------- */

el('refresh-btn').addEventListener('click', async (event) => {
  const btn = event.currentTarget;
  btn.disabled = true;
  btn.textContent = '刷新中…';
  try {
    await fetchData();
    render();
  } catch (err) {
    alert(`刷新失败：${err.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = '刷新';
  }
});

/* ---------- 启动：尝试用本地缓存口令自动解锁 ---------- */

(async function boot() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (!saved) {
    gateInput.focus();
    return;
  }
  passcode = saved;
  try {
    await fetchData();
    gate.hidden = true;
    app.hidden = false;
    render();
  } catch (err) {
    // 口令已变更（服务端 401）时清除缓存，需重新输入；其余错误保留缓存以便重试
    if (err.status === 401) {
      localStorage.removeItem(STORAGE_KEY);
      gateError.textContent = '访问口令已更新，请重新输入';
      gateError.hidden = false;
    }
    passcode = '';
    gate.hidden = false;
    gateInput.focus();
  }
})();