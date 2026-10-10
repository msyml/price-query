import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { runSync } from './sync.mjs';

if (existsSync('.env')) process.loadEnvFile('.env');

const args = process.argv.slice(2);
const skipDeploy = args.includes('--skip-deploy');

function run(cmd, cmdArgs) {
  const res = spawnSync(cmd, cmdArgs, { stdio: 'inherit', shell: true });
  if (res.status !== 0) throw new Error(`命令执行失败: ${cmd} ${cmdArgs.join(' ')}`);
}

async function main() {
  // 本地快速发布：拉最新数据 -> 生成加密快照 -> 部署
  // 快照不进版本库，正式发布请用 GitHub Actions（.github/workflows/deploy.yml）
  await runSync();

  if (skipDeploy) return;

  const projectName = process.env.CF_PROJECT_NAME?.trim() || 'price-query';
  console.log(`部署到 Cloudflare Pages: ${projectName} ...`);
  run('npx', [
    'wrangler', 'pages', 'deploy', 'public',
    '--project-name', projectName,
    '--commit-dirty=true'
  ]);
}

main().catch((err) => {
  console.error(`发布失败: ${err.message}`);
  process.exit(1);
});