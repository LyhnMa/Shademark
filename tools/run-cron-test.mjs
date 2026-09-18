/**
 * 本地跑一遍 cron worker 的 scheduled()（真实打到生产 Pages 的内部端点）
 * 用法：node tools/run-cron-test.mjs "0 3 * * *"       # 每日降级
 *       node tools/run-cron-test.mjs "0 * * * *"       # 每小时清理
 *       node tools/run-cron-test.mjs manual            # 走 fetch() 入口，两件事都跑
 * 前提：
 *   1) export CRON_SECRET=<生产值>      ← 禁止硬编码：仓库是公开的
 *   2) 先打包：esbuild cron-cleanup/worker.ts --bundle --format=esm --outfile=tmp-cron-worker.mjs
 *      （tmp-*.mjs 已被 .gitignore 忽略，勿提交）
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// 禁止硬编码：仓库是公开的。跑之前先 export CRON_SECRET=...
const SECRET = process.env.CRON_SECRET || '';
if (!SECRET) { console.error('缺少环境变量 CRON_SECRET（生产值，从密码管理器 / Cloudflare 注入记录取）'); process.exit(2); }

// PAGES_ORIGIN 非敏感，仍从 toml [vars] 读；允许用环境变量覆盖
const tomlPath = path.resolve('cron-cleanup/wrangler.cron.toml');
const toml = fs.readFileSync(tomlPath, 'utf8');
const pick = (k) => (toml.match(new RegExp(k + '\\s*=\\s*"([^"]+)"')) || [])[1];
const env = {
  CRON_SECRET: SECRET,
  PAGES_ORIGIN: process.env.PAGES_ORIGIN || pick('PAGES_ORIGIN') || 'https://shademark.cn',
};

const bundlePath = path.resolve('tmp-cron-worker.mjs');
if (!fs.existsSync(bundlePath)) {
  console.error('缺少 tmp-cron-worker.mjs，先打包：');
  console.error('  esbuild cron-cleanup/worker.ts --bundle --format=esm --outfile=tmp-cron-worker.mjs');
  process.exit(2);
}

const mod = await import(pathToFileURL(bundlePath).href);
const arg = process.argv[2] || '0 3 * * *';

const logs = [];
const origLog = console.log;
console.log = (...a) => { logs.push(a.join(' ')); };

if (arg === 'manual') {
  const res = await mod.default.fetch(new Request('https://shademark-cleanup.local/'), env);
  console.log = origLog;
  origLog('fetch() 返回：' + (await res.text()));
} else {
  await mod.default.scheduled({ cron: arg }, env, {});
  console.log = origLog;
  origLog(`scheduled({cron:'${arg}'}) 执行完成`);
}
for (const l of logs) origLog('  > ' + l);
