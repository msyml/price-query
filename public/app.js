const SNAPSHOT_URL = './data/snapshot.enc.json';
const SESSION_KEY = 'price_query_passcode';

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

let index = [];
let snapshotBlob = null;

/* ---------- 解密 ---------- */

const b64ToBytes = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

async function deriveKey(passcode, saltB64, iterations) {
  const base = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passcode),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: b64ToBytes(saltB64), iterations, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt']
  );
}

async function loadSnapshot() {
  if (!snapshotBlob) {
    const res = await fetch(SNAPSHOT_URL, { cache: 'no-store' });
    if (!res.ok) throw new Error('无法加载数据快照文件');
    snapshotBlob = await res.json();
  }
  return snapshotBlob;
}

async function decryptWith(passcode) {
  const blob = await loadSnapshot();
  const key = await deriveKey(passcode, blob.salt, blob.iterations);
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: b64ToBytes(blob.iv) },
    key,
    b64ToBytes(blob.payload)
  );
  return { rows: JSON.parse(new TextDecoder().decode(plain)), meta: blob };
}

/* ---------- 解锁流程 ---------- */

gateForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const passcode = gateInput.value;
  if (!passcode) return;

  gateSubmit.disabled = true;
  gateError.hidden = true;
  try {
    const { rows, meta } = await decryptWith(passcode);
    sessionStorage.setItem(SESSION_KEY, passcode);
    reveal(rows, meta);
  } catch (err) {
    gateError.textContent =
      err instanceof TypeError ? '无法加载数据快照文件' : '口令不正确，请重试';
    gateError.hidden = false;
    gateInput.select();
  } finally {
    gateSubmit.disabled = false;
  }
});

el('lock-btn').addEventListener('click', () => {
  sessionStorage.removeItem(SESSION_KEY);
  app.hidden = true;
  gate.hidden = false;
  gateInput.value = '';
  gateInput.focus();
});

function reveal(rows, meta) {
  index = rows.map((row) => ({
    row,
    hay: `${row.n} ${row.py} ${row.bc}`.toLowerCase()
  }));

  el('meta-count').textContent = `共 ${meta.count} 个商品`;
  el('meta-time').textContent = formatTime(meta.generatedAt);

  fillSelect(brandSelect, '全部品牌', rows.map((r) => r.br));
  fillSelect(catSelect, '全部分类', rows.map((r) => r.c));

  gate.hidden = true;
  app.hidden = false;
  render();
}

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
  const { rows, exact } = queryRows();

  exactTag.hidden = !exact;
  resultCount.textContent = `匹配 ${rows.length} 个商品`;
  clearBtn.hidden = !qInput.value;

  if (!rows.length) {
    list.innerHTML = '';
    empty.hidden = false;
    return;
  }
  empty.hidden = true;
  list.innerHTML = rows.map(cardHTML).join('');
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
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

let renderTimer;
function scheduleRender() {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(render, 80);
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

/* ---------- 启动：尝试用会话内口令自动解锁 ---------- */

(async function boot() {
  const saved = sessionStorage.getItem(SESSION_KEY);
  if (!saved) {
    gateInput.focus();
    return;
  }
  try {
    const { rows, meta } = await decryptWith(saved);
    reveal(rows, meta);
  } catch {
    sessionStorage.removeItem(SESSION_KEY);
    gateInput.focus();
  }
})();