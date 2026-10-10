import { randomBytes, pbkdf2Sync, createCipheriv } from 'node:crypto';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { pinyin } from 'pinyin-pro';

const PBKDF2_ITERATIONS = 150000;
const KEY_LENGTH = 32;

function pickText(value) {
  if (value == null) return '';
  if (Array.isArray(value)) return value.length ? String(value[0]).trim() : '';
  return String(value).trim();
}

function pickNumber(value) {
  if (value == null || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

/** 取中文拼音首字母，非中文/符号一律剔除，只保留 a-z0-9 */
function pinyinInitials(text) {
  const cleaned = String(text ?? '').replace(/[^\u4e00-\u9fa5A-Za-z0-9]/g, '');
  if (!cleaned) return '';
  return pinyin(cleaned, { pattern: 'first', toneType: 'none', type: 'array' })
    .join('')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/** 把飞书记录压成前端使用的最小结构，字段名用短键减小体积 */
export function normalizeRecords(records) {
  return records
    .map((record) => {
      const f = record.fields ?? record;
      const brand = pickText(f['商品品牌']);
      const name = pickText(f['商品名称']);
      return {
        n: name,
        br: brand,
        c: pickText(f['所属分类']),
        bc: pickText(f['商品条码']),
        // 搜索用拼音 = 品牌首字母 + 商品名首字母
        py: pinyinInitials(brand) + pinyinInitials(name),
        w: pickNumber(f['批发价']),
        r: pickNumber(f['零售价']),
        s: pickText(f['散称价']),
        pk: pickText(f['整箱|整包'])
      };
    })
    .filter((row) => row.n);
}

/** 用口令派生密钥并做 AES-256-GCM 加密，口令不落盘明文数据 */
export function encryptSnapshot(rows, passcode) {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = pbkdf2Sync(passcode, salt, PBKDF2_ITERATIONS, KEY_LENGTH, 'sha256');

  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(Buffer.from(JSON.stringify(rows), 'utf8')),
    cipher.final()
  ]);
  const tag = cipher.getAuthTag();

  return {
    v: 1,
    kdf: 'PBKDF2-SHA256',
    iterations: PBKDF2_ITERATIONS,
    cipher: 'AES-256-GCM',
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    count: rows.length,
    generatedAt: new Date().toISOString(),
    // AES-GCM 的密文与认证标签拼接，前端直接交给 WebCrypto 解密
    payload: Buffer.concat([ciphertext, tag]).toString('base64')
  };
}

export function writeSnapshot(rows, passcode, outPath) {
  const blob = encryptSnapshot(rows, passcode);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(blob)}\n`, 'utf8');
  return blob;
}