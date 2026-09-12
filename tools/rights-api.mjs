const BASE = 'https://shademark.cn';
const get = async (path, token) => {
  const r = await fetch(BASE + path, { headers: token ? { cookie: `session=${token}` } : {} });
  const t = await r.text();
  return { status: r.status, ct: r.headers.get('content-type'), len: t.length, head: t.slice(0, 160).replace(/\s+/g, ' ') };
};
const out = {};
for (const [k, p, tk] of [
  ['noAuth', '/api/auth/session', null],
  ['free', '/api/auth/session', 'tst_sess_free'],
  ['pro', '/api/auth/session', 'tst_sess_pro'],
  ['grace', '/api/auth/session', 'tst_sess_gra'],
  ['down', '/api/auth/session', 'tst_sess_down'],
  ['linksOver', '/api/links', 'tst_sess_over'],
  ['linksPro', '/api/links', 'tst_sess_pro'],
]) out[k] = await get(p, tk);

const sub = async (tk) => { const r = await fetch(BASE + '/api/auth/session', { headers: { cookie: `session=${tk}` } }); const j = await r.json().catch(() => null); return j && j.subscription ? { tier: j.subscription.tier, stored: j.subscription.stored_tier, ever_pro: j.subscription.ever_pro, retention: j.subscription.retention, in_grace: j.subscription.in_grace, grace_ends_at: j.subscription.grace_ends_at, grace_days_left: j.subscription.grace_days_left, expired: j.subscription.expired, days_left: j.subscription.days_left, status: j.subscription.status } : j; };
out.subs = { free: await sub('tst_sess_free'), pro: await sub('tst_sess_pro'), grace: await sub('tst_sess_gra'), down: await sub('tst_sess_down') };

const lu = async (tk) => { const r = await fetch(BASE + '/api/links', { headers: { cookie: `session=${tk}` } }); const j = await r.json().catch(() => null); return j && j.usage ? { used: j.usage.used, limit: j.usage.limit, tier: j.usage.tier, retention_days: j.usage.retention_days, ever_pro: j.usage.ever_pro, can_export_csv: j.usage.can_export_csv } : j; };
out.usage = { free: await lu('tst_sess_free'), pro: await lu('tst_sess_pro'), over: await lu('tst_sess_over'), down: await lu('tst_sess_down') };
console.log(JSON.stringify(out, null, 2));
