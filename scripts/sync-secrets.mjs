#!/usr/bin/env node
/**
 * 把本地 .env 同步到 GitHub Actions Secrets / Variables。
 *
 * 用法：
 *   node scripts/sync-secrets.mjs              # 校验 .env，生成上传脚本
 *   bash .gh-secrets-upload.sh                 # 在 bash 里执行真正上传
 *
 * 为什么生成 shell 脚本而不是 Node 直接调 gh：
 *   Node 的 spawnSync 在部分沙箱/受管环境下无法拉起 .exe 子进程（EBUSY），
 *   而 bash 可以。拆成两步后，两种环境都能跑通。
 *
 * 安全设计：
 *   - 不在 Node 侧打印任何明文密钥
 *   - 上传脚本临时生成、权限 700，用完自动删除
 *   - 空值直接拦下，避免把空串写进 Secrets 导致线上神秘失败
 */
import { existsSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';

const OUT = '.gh-secrets-upload.sh';

/** GH Secrets：敏感值 */
const SECRET_KEYS = [
  'FEISHU_APP_ID',
  'FEISHU_APP_SECRET',
  'FEISHU_APP_TOKEN',
  'FEISHU_TABLE_ID',
  'ACCESS_PASSCODE',
  'CLOUDFLARE_API_TOKEN',
  'CLOUDFLARE_ACCOUNT_ID'
];

/** GH Variables：非敏感值 */
const VARIABLE_KEYS = ['CF_PROJECT_NAME'];

function loadEnv() {
  if (!existsSync('.env')) {
    console.error('找不到 .env，请先在项目根目录准备好本地配置');
    process.exit(1);
  }
  const out = {};
  for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 0) continue;
    out[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
  return out;
}

/** 单引号转义，防止值里的引号破坏 shell 字符串 */
const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

function main() {
  const env = loadEnv();
  const empty = [];
  const missing = [];
  const lines = [
    '#!/usr/bin/env bash',
    '# 由 scripts/sync-secrets.mjs 自动生成，执行后自动删除。',
    '# 内容含明文密钥，请勿提交或分享。',
    'set -euo pipefail',
    ''
  ];

  console.log('=== 校验 .env ===\n');
  console.log('将上传为 secret：');
  for (const key of SECRET_KEYS) {
    const val = env[key];
    if (val === undefined) { missing.push(key); continue; }
    if (!val) { empty.push(key); console.log(`  ✗ ${key.padEnd(22)} [空值，已跳过]`); continue; }

    if (key === 'ACCESS_PASSCODE' && val.length < 8) {
      empty.push(key);
      console.log(`  ✗ ${key.padEnd(22)} [仅 ${val.length} 位，太短会削弱加密强度，已拦下]`);
      continue;
    }
    console.log(`  ✓ ${key.padEnd(22)} [${String(val.length).padStart(3)} 字符]`);
    lines.push(`gh secret set ${key} --body ${q(val)}`);
  }

  console.log('\n将上传为 variable：');
  for (const key of VARIABLE_KEYS) {
    const val = env[key];
    if (!val) { empty.push(key); console.log(`  ✗ ${key.padEnd(22)} [空值，已跳过]`); continue; }
    console.log(`  ✓ ${key.padEnd(22)} = ${val}`);
    lines.push(`gh variable set ${key} --body ${q(val)}`);
  }

  lines.push('');
  lines.push('echo "全部写入完成，可用 gh secret list / gh variable list 复核。"');
  lines.push('rm -f "$0"');

  writeFileSync(OUT, `${lines.join('\n')}\n`, 'utf8');
  try { chmodSync(OUT, 0o700); } catch { /* Windows 上可能不支持，忽略 */ }

  console.log('');
  if (empty.length) {
    console.log(`⚠ 空值已跳过：${empty.join(', ')}`);
    if (empty.some((k) => k.startsWith('CLOUDFLARE'))) {
      console.log('  Cloudflare 凭证为空，部署会失败。请到控制台取 Account ID 与 API Token，');
      console.log('  填进 .env 后重新生成本脚本。');
    }
  }
  if (missing.length) console.log(`⚠ .env 中不存在：${missing.join(', ')}`);

  if (!empty.some((k) => k.startsWith('CLOUDFLARE'))) {
    console.log('\n下一步：');
    console.log('  1) gh auth login            # 若尚未登录');
    console.log(`  2) bash ${OUT}                 # 执行上传`);
  } else {
    console.log('\n补齐 Cloudflare 凭证后再执行本步骤。');
  }
}

main();