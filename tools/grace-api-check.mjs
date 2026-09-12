/**
 * 线上验证：宽限期 / 降级后的状态口径（真实 HTTP，带测试会话 cookie）
 * 用法：node tools/grace-api-check.mjs
 */
const BASE = process.env.BASE || 'https://shademark.cn';
const get = async (path, token) => {
  const r = await fetch(BASE + path, { headers: { cookie: `session=${token}` } });
  const t = await r.text();
  try { return { status: r.status, body: JSON.parse(t) }; } catch { return { status: r.status, body: t.slice(0, 200) }; }
};

const out = {};
out.grace = await get('/api/auth/session', 'tst_sess_grace');
out.downgraded = await get('/api/auth/session', 'tst_sess_expired');
out.expiring = await get('/api/platform/users', 'tst_sess_plat');

// session 只保留关注字段
for (const k of ['grace', 'downgraded']) {
  const b = out[k].body;
  out[k] = b && b.subscription
    ? { user: b.user?.email, sub: {
        tier: b.subscription.tier, stored_tier: b.subscription.stored_tier, status: b.subscription.status,
        is_pro: b.subscription.is_pro, in_grace: b.subscription.in_grace,
        grace_days_left: b.subscription.grace_days_left, grace_ends_at: b.subscription.grace_ends_at,
        expired: b.subscription.expired, days_left: b.subscription.days_left,
      } }
    : b;
}

const pu = out.expiring.body;
if (pu && pu.users) {
  out.expiring = {
    summary: pu.summary,
    attention: (pu.attention || []).map((u) => ({ email: u.email, status: u.status, days_left: u.days_left, grace_days_left: u.grace_days_left })),
    testUsers: pu.users.filter((u) => (u.email || '').includes('@test.local'))
      .map((u) => ({ email: u.email, tier: u.subscription_tier, eff: u.effective_tier, status: u.status, is_pro: u.is_pro, days_left: u.days_left, grace_days_left: u.grace_days_left, ever_pro: u.ever_pro })),
    realUsers: pu.users.filter((u) => !(u.email || '').includes('@test.local'))
      .map((u) => ({ email: u.email, status: u.status, is_pro: u.is_pro, days_left: u.days_left })),
  };
}
// 权益差异实测：宽限期内（pro）应保留 Pro 额度，降级后（free）应降到免费额度
const linksUsage = async (label, token) => {
  const r = await get('/api/links', token);
  const u = r.body && r.body.usage;
  return u ? { [label]: { tier: u.tier, limit: u.limit, retention_days: u.retention_days, can_export_csv: u.can_export_csv } } : { [label]: r.body };
};
out.quota = { ...(await linksUsage('grace_pro', 'tst_sess_grace')), ...(await linksUsage('downgraded_free', 'tst_sess_expired')) };

console.log(JSON.stringify(out, null, 2));
