import { randomBytes, pbkdf2Sync, createCipheriv } from 'node:crypto';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

// 字段映射/拼音/数值归一化与 Functions 侧共用同一份实现（shared/pricing.js），
// 这里不再重复定义，避免两边规则漂移导致快照与线上数据不一致。
//
// 注意一处刻意的行为差异：旧实现每次都用品牌+商品名现算 py，且不带 rec 字段；
// 现在复用 toRow，py 优先取表格里已存的「拼音简称」（缺失才回退计算），并带上 rec。
// 这与页面接口返回的行结构一致，快照反而更贴近线上数据。
// 快照仅供离线备份、页面已不读取，因此该收敛是安全的。
export { normalizeRecords } from '../../shared/pricing.js';

const PBKDF2_ITERATIONS = 150000;
const KEY_LENGTH = 32;

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