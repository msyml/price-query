import { randomBytes, pbkdf2Sync, createCipheriv } from 'node:crypto';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

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

/** 把飞书记录压成前端使用的最小结构，字段名用短键减小体积 */
export function normalizeRecords(records) {
  return records
    .map((record) => {
      const f = record.fields ?? record;
      return {
        n: pickText(f['商品名称']),
        br: pickText(f['商品品牌']),
        c: pickText(f['所属分类']),
        bc: pickText(f['商品条码']),
        py: pickText(f['拼音简称']),
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