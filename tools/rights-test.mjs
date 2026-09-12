/**
 * 权益展示对齐测试数据（订阅页四态 + 短链三态）
 *
 * 用法：
 *   node tools/rights-test.mjs seed  tmp-rights-seed.sql
 *   node tools/rights-test.mjs clean tmp-rights-clean.sql
 *
 * 测试账号（@test.local，生产库里一眼可辨）：
 *   t_free@test.local   Free，从未开过 Pro      → 订阅页 Free 态；短链 8,234/10,000
 *   t_pro@test.local    Pro，到期 +21 天        → 订阅页 Pro 态；短链 Pro 行
 *   t_gra@test.local    Pro，到期 -1 天         → 订阅页宽限态
 *   t_down@test.local   Free + ever_pro=1       → 订阅页降级态（保留应显示 90 天）
 *   t_over@test.local   Free，本月点击已用满     → 短链超额态
 */
const now = Math.floor(Date.now() / 1000);
const D = 86400;
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const monthKey = (() => {
  const d = new Date(now * 1000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
})();

const USERS = [
  { id: 'tst_free', email: 't_free@test.local', tier: 'free', exp: null, ever: 0, month: monthKey, cnt: 8234 },
  { id: 'tst_pro', email: 't_pro@test.local', tier: 'pro', exp: now + 21 * D, ever: 1, month: monthKey, cnt: 45000 },
  { id: 'tst_gra', email: 't_gra@test.local', tier: 'pro', exp: now - 1 * D, ever: 1, month: monthKey, cnt: 120 },
  { id: 'tst_down', email: 't_down@test.local', tier: 'free', exp: now - 30 * D, ever: 1, month: monthKey, cnt: 300 },
  { id: 'tst_over', email: 't_over@test.local', tier: 'free', exp: null, ever: 0, month: monthKey, cnt: 10000 },
];

const mode = process.argv[2] || 'seed';
const out = [];

if (mode === 'seed') {
  out.push(`-- 生成于 ${new Date(now * 1000).toISOString()} (now=${now})`);
  for (const u of USERS) {
    out.push(
      `INSERT INTO users (id, email, password_hash, subscription_tier, subscription_expires_at, ever_pro, role, ` +
      `link_click_month, link_click_count, created_at) VALUES (` +
      `${q(u.id)}, ${q(u.email)}, ${q('x$y')}, ${q(u.tier)}, ` +
      `${u.exp === null ? 'NULL' : u.exp}, ${u.ever}, 'user', ${q(u.month)}, ${u.cnt}, ${now - 60 * D});`
    );
    out.push(`INSERT INTO sessions (token, user_id, created_at) VALUES (${q('tst_sess_' + u.id.replace('tst_', ''))}, ${q(u.id)}, ${now});`);
  }
} else if (mode === 'clean') {
  out.push(
    `DELETE FROM sessions WHERE token LIKE 'tst_sess_%';`,
    `DELETE FROM users WHERE id LIKE 'tst_%';`
  );
}

import fs from 'node:fs';
const target = process.argv[3] || `tmp-rights-${mode}.sql`;
fs.writeFileSync(target, out.join('\n') + '\n', 'utf8');
console.log(`wrote ${target} (${out.length} statements) month=${monthKey}`);
