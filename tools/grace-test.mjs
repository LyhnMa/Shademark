/**
 * Pro 到期 / 宽限 / 自动降级 / 降级后数据保留 —— 测试数据生成器
 *
 * 用法：
 *   node tools/grace-test.mjs seed   > tmp-seed.sql     # 造测试用户 + 40 天前的老数据
 *   node tools/grace-test.mjs clean  > tmp-clean.sql    # 删掉全部测试数据
 *   node tools/grace-test.mjs check  > tmp-check.sql    # 查测试数据是否还在
 *
 * 测试账号（邮箱均为 @test.local，生产库里一眼可辨）：
 *   t_grace@test.local      pro，到期 -1 天  → 宽限期内（权益保留）
 *   t_expired@test.local    pro，到期 -5 天  → 超 3 天宽限，应被自动降级
 *   t_expiring@test.local   pro，到期 +3 天  → 即将到期
 *   t_fresh@test.local      pro，到期 +30 天 → 正常
 *   t_freeold@test.local    free，从未开过 Pro → 清理对照组（老数据应被删）
 */
const now = Math.floor(Date.now() / 1000);
const D = 86400;
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;

const USERS = [
  { id: 'tst_grace', email: 't_grace@test.local', tier: 'pro', exp: now - 1 * D, ever: 1 },
  { id: 'tst_expired', email: 't_expired@test.local', tier: 'pro', exp: now - 5 * D, ever: 1 },
  { id: 'tst_expiring', email: 't_expiring@test.local', tier: 'pro', exp: now + 3 * D, ever: 1 },
  { id: 'tst_fresh', email: 't_fresh@test.local', tier: 'pro', exp: now + 30 * D, ever: 1 },
  { id: 'tst_freeold', email: 't_freeold@test.local', tier: 'free', exp: null, ever: 0 },
];

const mode = process.argv[2] || 'seed';
const out = [];

if (mode === 'seed') {
  out.push(`-- 生成于 ${new Date(now * 1000).toISOString()} (now=${now})`);
  for (const u of USERS) {
    out.push(
      `INSERT INTO users (id, email, password_hash, subscription_tier, subscription_expires_at, ever_pro, role, created_at) ` +
      `VALUES (${q(u.id)}, ${q(u.email)}, ${q('x$y')}, ${q(u.tier)}, ${u.exp === null ? 'NULL' : u.exp}, ${u.ever}, 'user', ${now - 60 * D});`
    );
  }
  // 老数据（40 天前）：覆盖链接/点击/报价单/商品/订单/激活码/验证日志
  const old = now - 40 * D;
  for (const uid of ['tst_expired', 'tst_freeold']) {
    const tag = uid.replace('tst_', '');
    out.push(
      `INSERT INTO links (id, developer_id, slug, target_url, created_at, is_active) VALUES (${q('lk_' + tag)}, ${q(uid)}, ${q('t-' + tag.replace('_', '-') + '-40d')}, 'https://example.com/old', ${old}, 1);`,
      `INSERT INTO link_clicks (id, link_id, clicked_at, referer, user_agent, ip_hash, country) VALUES (${q('clk_' + tag)}, ${q('lk_' + tag)}, ${old}, '', '', '', '');`,
      `INSERT INTO quote_records (id, user_id, quote_no, items, total, grand_total, created_at) VALUES (${q('qt_' + tag)}, ${q(uid)}, ${q('QT-' + tag)}, '[]', 1, 1, ${old});`,
      `INSERT INTO products (id, developer_id, name, price, created_at) VALUES (${q('pr_' + tag)}, ${q(uid)}, ${q('旧商品 ' + tag)}, 1, ${old});`,
      `INSERT INTO orders (id, order_number, product_id, amount, status, created_at) VALUES (${q('or_' + tag)}, ${q('ON-' + tag)}, ${q('pr_' + tag)}, 1, 'cancelled', ${old});`,
      `INSERT INTO activation_codes (id, product_id, code_value, status, order_id, created_at) VALUES (${q('cd_' + tag)}, ${q('pr_' + tag)}, ${q('CODE-' + tag)}, 'unused', ${q('or_' + tag)}, ${old});`,
      `INSERT INTO verification_logs (id, code_id, code_value, result, created_at) VALUES (${q('vl_' + tag)}, ${q('cd_' + tag)}, ${q('CODE-' + tag)}, 'ok', ${old});`
    );
  }
  // 测试用会话（cookie 直接用这个 token 就能以该身份访问）
  out.push(
    `INSERT INTO sessions (token, user_id, created_at) VALUES ('tst_sess_grace', 'tst_grace', ${now});`,
    `INSERT INTO sessions (token, user_id, created_at) VALUES ('tst_sess_expired', 'tst_expired', ${now});`
  );
} else if (mode === 'edge') {
  // 宽限期边界：到期时间正好在「+3 天」两侧各 5 分钟
  out.push(
    `INSERT INTO users (id, email, password_hash, subscription_tier, subscription_expires_at, ever_pro, role, created_at) VALUES ('tst_edge_in', 't_edge_in@test.local', 'x$y', 'pro', ${now - 3 * D + 300}, 1, 'user', ${now - 60 * D});`,
    `INSERT INTO users (id, email, password_hash, subscription_tier, subscription_expires_at, ever_pro, role, created_at) VALUES ('tst_edge_out', 't_edge_out@test.local', 'x$y', 'pro', ${now - 3 * D - 300}, 1, 'user', ${now - 60 * D});`
  );
} else if (mode === 'clean') {
  out.push(
    `DELETE FROM verification_logs WHERE id LIKE 'vl_%';`,
    `DELETE FROM activation_codes WHERE id LIKE 'cd_%';`,
    `DELETE FROM link_clicks WHERE id LIKE 'clk_%';`,
    `DELETE FROM links WHERE id LIKE 'lk_%';`,
    `DELETE FROM quote_records WHERE id LIKE 'qt_%';`,
    `DELETE FROM orders WHERE id LIKE 'or_%';`,
    `DELETE FROM products WHERE id LIKE 'pr_%';`,
    `DELETE FROM sessions WHERE token LIKE 'tst_sess_%';`,
    `DELETE FROM users WHERE id LIKE 'tst_%';`
  );
} else if (mode === 'check') {
  out.push(
    `SELECT 'users' AS t, id, subscription_tier AS v1, subscription_expires_at AS v2, ever_pro AS v3 FROM users WHERE id LIKE 'tst_%' ORDER BY id;`,
    `SELECT 'links' AS t, id FROM links WHERE id LIKE 'lk_%';`,
    `SELECT 'clicks' AS t, id FROM link_clicks WHERE id LIKE 'clk_%';`,
    `SELECT 'quotes' AS t, id FROM quote_records WHERE id LIKE 'qt_%';`,
    `SELECT 'orders' AS t, id, status FROM orders WHERE id LIKE 'or_%';`,
    `SELECT 'codes' AS t, id FROM activation_codes WHERE id LIKE 'cd_%';`,
    `SELECT 'vlogs' AS t, id FROM verification_logs WHERE id LIKE 'vl_%';`,
    `SELECT 'products' AS t, id FROM products WHERE id LIKE 'pr_%';`
  );
}

// 直接写文件（UTF-8 无 BOM）—— 不要用 PowerShell 重定向，那会写成 UTF-16 让 wrangler 报乱码
import fs from 'node:fs';
const target = process.argv[3] || `tmp-${mode}.sql`;
fs.writeFileSync(target, out.join('\n') + '\n', 'utf8');
console.log(`wrote ${target} (${out.length} statements)`);
