/**
 * 查 Cloudflare Worker 的 Cron Triggers 是否真的注册上了（只读，不改任何东西）
 * 用法：node tools/cf-schedules.mjs [workerName]
 * 鉴权：复用 wrangler 本地存的 OAuth token（不打印 token）
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const cfgPath = path.join(
  os.homedir(),
  'AppData/Roaming/xdg.config/.wrangler/config/default.toml'
);
const toml = fs.readFileSync(cfgPath, 'utf8');
const token = (toml.match(/oauth_token\s*=\s*"([^"]+)"/) || [])[1];
if (!token) {
  console.error('no oauth_token in wrangler config');
  process.exit(1);
}

const H = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
const api = async (p) => {
  const r = await fetch(`https://api.cloudflare.com/client/v4${p}`, { headers: H });
  const j = await r.json();
  if (!j.success) throw new Error(`${p} -> ${JSON.stringify(j.errors)}`);
  return j.result;
};

const target = process.argv[2] || 'shademark-cleanup';
const accounts = await api('/accounts');
const out = { accounts: accounts.map((a) => ({ name: a.name, id: a.id })), workers: {} };

for (const acc of accounts) {
  const scripts = await api(`/accounts/${acc.id}/workers/scripts`);
  const names = scripts.map((s) => s.id);
  if (names.includes(target)) {
    const sched = await api(`/accounts/${acc.id}/workers/scripts/${target}/schedules`);
    out.workers[target] = { account: acc.name, accountId: acc.id, schedules: sched };
  }
  out.workers[`__all_in_${acc.name}`] = names;
}

console.log(JSON.stringify(out, null, 2));
