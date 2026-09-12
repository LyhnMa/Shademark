/**
 * 本地跑一遍 cron worker 的 scheduled()（真实打到生产 Pages 的内部端点）
 * 用法：node tools/run-cron-test.mjs "0 3 * * *"       # 每日降级
 *       node tools/run-cron-test.mjs "0 * * * *"       # 每小时清理
 *       node tools/run-cron-test.mjs manual            # 走 fetch() 入口，两件事都跑
 * 前提：先 esbuild 打包 cron-cleanup/worker.ts -> tmp-cron-worker.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const toml = fs.readFileSync('cron-cleanup/wrangler.cron.toml', 'utf8');
const pick = (k) => (toml.match(new RegExp(k + '\\s*=\\s*"([^"]+)"')) || [])[1];
const env = { CRON_SECRET: pick('CRON_SECRET'), PAGES_ORIGIN: pick('PAGES_ORIGIN') };

const mod = await import(pathToFileURL(path.resolve('tmp-cron-worker.mjs')).href);
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
