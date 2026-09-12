import { newId, now } from './db';
import { monthlyClickQuota, linkRetentionDays, effectiveTier } from './subscription';

// 与激活码一致：排除易混淆字符 0 O 1 I l
const SLUG_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const SLUG_LENGTH = 6;

// 占用即冲突的保留词
const RESERVED = [
  'api', 'admin', 'store', 'links', 'l', 'platform', 'watermark', 'verify',
  'order-query', 'login', 'logout', 'static', 'assets', 'favicon.ico', 'logo.png'
];

// 明显的恶意/滥用域名黑名单（可扩展）
const BLOCKED_HOSTS = [
  'bit.ly', 'tinyurl.com', 't.co', 'goo.gl', 'is.gd', 'ow.ly', 'buff.ly', 'cutt.ly', 'rebrand.ly'
];

export const FREE_MONTHLY_CLICKS = 10000;
export const PRO_MONTHLY_CLICKS = 500000;
const HOURLY_CREATE_LIMIT = 50;

export function generateSlug(len = SLUG_LENGTH): string {
  let out = '';
  for (let i = 0; i < len; i++) {
    out += SLUG_CHARS[Math.floor(Math.random() * SLUG_CHARS.length)];
  }
  return out;
}

export function validateSlug(slug: string): { ok: boolean; error?: string } {
  if (!slug) return { ok: false, error: '后缀不能为空' };
  if (slug.length < 3 || slug.length > 32) return { ok: false, error: '后缀长度需为 3–32 个字符' };
  if (!/^[A-Za-z0-9-]+$/.test(slug)) return { ok: false, error: '后缀只能包含字母、数字和连字符' };
  if (RESERVED.includes(slug.toLowerCase())) return { ok: false, error: '该后缀为系统保留词，换一个' };
  return { ok: true };
}

export function validateTarget(raw: string): { ok: boolean; error?: string; url?: string } {
  if (!raw) return { ok: false, error: '目标链接不能为空' };
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, error: '链接格式不对，请带上 http:// 或 https://' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, error: '只支持 http / https 链接' };
  }
  const host = url.hostname.toLowerCase();
  if (BLOCKED_HOSTS.some(h => host === h || host.endsWith('.' + h))) {
    return { ok: false, error: '该域名在黑名单中，换一个目标地址' };
  }
  if (host.includes('shademark.cn') && url.pathname.startsWith('/l/')) {
    return { ok: false, error: '不能把短链指向另一个短链' };
  }
  return { ok: true, url: url.toString() };
}

// ---- 分类 ----
const SOCIAL_HOSTS = [
  'twitter.com', 'x.com', 'facebook.com', 'instagram.com', 'weibo.com', 'linkedin.com',
  'reddit.com', 't.me', 'telegram.me', 'youtube.com', 'douyin.com', 'xiaohongshu.com',
  'zhihu.com', 'mp.weixin.qq.com', 'weixin.qq.com', 'bilibili.com'
];

export function classifyReferer(referer: string): 'direct' | 'social' | 'external' {
  if (!referer) return 'direct';
  try {
    const host = new URL(referer).hostname.toLowerCase();
    if (SOCIAL_HOSTS.some(h => host === h || host.endsWith('.' + h))) return 'social';
    return 'external';
  } catch {
    return 'external';
  }
}

export function classifyDevice(ua: string): 'mobile' | 'desktop' | 'other' {
  const s = (ua || '').toLowerCase();
  if (/mobile|android|iphone|ipod|ipad|windows phone|blackberry/.test(s)) return 'mobile';
  if (/windows|macintosh|linux|x11|cros/.test(s)) return 'desktop';
  return 'other';
}

export async function hashIP(ip: string): Promise<string> {
  const data = new TextEncoder().encode('shademark|' + (ip || ''));
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

function monthKey(ts = now()): string {
  const d = new Date(ts * 1000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function monthlyLimit(tier: string): number {
  return tier === 'pro' ? PRO_MONTHLY_CLICKS : FREE_MONTHLY_CLICKS;
}

// ---- 创建 / 查询 ----
export async function createLink(
  db: D1Database,
  developerId: string,
  targetUrl: string,
  customSlug?: string
): Promise<{ ok: boolean; error?: string; link?: any }> {
  const target = validateTarget(targetUrl);
  if (!target.ok) return { ok: false, error: target.error };

  let slug = (customSlug || '').trim();
  if (slug) {
    const v = validateSlug(slug);
    if (!v.ok) return { ok: false, error: v.error };
  } else {
    // 随机生成，冲突则重试
    for (let i = 0; i < 8; i++) {
      const candidate = generateSlug();
      const exists = await db.prepare(`SELECT id FROM links WHERE slug = ?`).bind(candidate).first();
      if (!exists) { slug = candidate; break; }
    }
    if (!slug) return { ok: false, error: '短码生成失败，请重试' };
  }

  const dup = await db.prepare(`SELECT id FROM links WHERE slug = ?`).bind(slug).first();
  if (dup) return { ok: false, error: '该后缀已被占用，换一个' };

  // 创建频率限制：单开发者每小时 50 条
  const recent = await db.prepare(
    `SELECT COUNT(*) AS c FROM links WHERE developer_id = ? AND created_at > ?`
  ).bind(developerId, now() - 3600).first<any>();
  if ((recent?.c || 0) >= HOURLY_CREATE_LIMIT) {
    return { ok: false, error: '创建太频繁了，每小时最多 50 条' };
  }

  const id = newId();
  await db.prepare(
    `INSERT INTO links (id, developer_id, slug, target_url, created_at, is_active)
     VALUES (?, ?, ?, ?, ?, 1)`
  ).bind(id, developerId, slug, target.url, now()).run();

  return { ok: true, link: { id, slug, target_url: target.url } };
}

export async function listLinks(db: D1Database, developerId: string): Promise<any[]> {
  const links = await db.prepare(
    `SELECT * FROM links WHERE developer_id = ? ORDER BY created_at DESC`
  ).bind(developerId).all<any>();
  const rows = links.results || [];
  if (!rows.length) return [];
  return aggregateClicks(db, rows);
}

// 一次性聚合：总点击 + 最近7天趋势 + 来源/设备分布（避免逐条查询）
export async function aggregateClicks(db: D1Database, rows: any[]): Promise<any[]> {
  const ids = rows.map(r => r.id);
  const ph = ids.map(() => '?').join(',');

  const totals = await db.prepare(
    `SELECT link_id, COUNT(*) AS c, MAX(clicked_at) AS last_at
     FROM link_clicks WHERE link_id IN (${ph}) GROUP BY link_id`
  ).bind(...ids).all<any>();
  const totalMap = new Map<string, any>();
  for (const t of totals.results || []) totalMap.set(t.link_id, t);

  const since = now() - 30 * 86400;
  const recent = await db.prepare(
    `SELECT link_id, clicked_at, referer, user_agent FROM link_clicks
     WHERE link_id IN (${ph}) AND clicked_at >= ?`
  ).bind(...ids, since).all<any>();

  const byLink = new Map<string, any[]>();
  for (const c of recent.results || []) {
    if (!byLink.has(c.link_id)) byLink.set(c.link_id, []);
    byLink.get(c.link_id)!.push(c);
  }

  const daySec = 86400;
  const today = Math.floor(now() / daySec);

  return rows.map(r => {
    const arr = byLink.get(r.id) || [];
    const dayCount = new Map<number, number>();
    const sources = { direct: 0, social: 0, external: 0 };
    const devices = { mobile: 0, desktop: 0, other: 0 };
    for (const c of arr) {
      const d = Math.floor(c.clicked_at / daySec);
      dayCount.set(d, (dayCount.get(d) || 0) + 1);
      sources[classifyReferer(c.referer)]++;
      devices[classifyDevice(c.user_agent)]++;
    }
    const trend: { day: string; count: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = today - i;
      const date = new Date(d * daySec * 1000);
      trend.push({
        day: `${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`,
        count: dayCount.get(d) || 0,
      });
    }
    return {
      ...r,
      clicks: totalMap.get(r.id)?.c || 0,
      last_click_at: totalMap.get(r.id)?.last_at || 0,
      trend, sources, devices,
    };
  });
}

export async function attachCounts(db: D1Database, rows: any[]): Promise<any[]> {
  const ids = rows.map(r => r.id);
  const placeholders = ids.map(() => '?').join(',');
  const counts = await db.prepare(
    `SELECT link_id, COUNT(*) AS c, MAX(clicked_at) AS last_at
     FROM link_clicks WHERE link_id IN (${placeholders}) GROUP BY link_id`
  ).bind(...ids).all<any>();
  const map = new Map<string, any>();
  for (const c of counts.results || []) map.set(c.link_id, c);
  return rows.map(r => ({
    ...r,
    clicks: map.get(r.id)?.c || 0,
    last_click_at: map.get(r.id)?.last_at || 0,
  }));
}

export async function getLinkBySlug(db: D1Database, slug: string): Promise<any> {
  return db.prepare(`SELECT * FROM links WHERE slug = ?`).bind(slug).first<any>();
}

export async function setLinkActive(
  db: D1Database, linkId: string, isActive: number
): Promise<void> {
  await db.prepare(`UPDATE links SET is_active = ? WHERE id = ?`).bind(isActive, linkId).run();
}

export async function deleteLink(db: D1Database, linkId: string): Promise<void> {
  await db.prepare(`DELETE FROM link_clicks WHERE link_id = ?`).bind(linkId).run();
  await db.prepare(`DELETE FROM links WHERE id = ?`).bind(linkId).run();
}

// ---- 点击记录 ----
// 返回 { recorded } —— 超额时链接照常跳转，只是不记
export async function recordClick(
  db: D1Database,
  link: any,
  request: Request,
  country: string
): Promise<{ recorded: boolean; reason?: string }> {
  const quota = await db.prepare(
    `SELECT subscription_tier, subscription_expires_at, link_click_month, link_click_count FROM users WHERE id = ?`
  ).bind(link.developer_id).first<any>();
  if (!quota) return { recorded: false, reason: 'no_user' };

  const mk = monthKey();
  const limit = monthlyLimit(effectiveTier(quota));
  const used = quota.link_click_month === mk ? (quota.link_click_count || 0) : 0;
  if (used >= limit) {
    // 额度用尽：不记录，但把月份对齐，避免一直读到旧值
    if (quota.link_click_month !== mk) {
      await db.prepare(`UPDATE users SET link_click_month = ?, link_click_count = 0 WHERE id = ?`)
        .bind(mk, link.developer_id).run();
    }
    return { recorded: false, reason: 'quota_exceeded' };
  }

  const ip = request.headers.get('cf-connecting-ip')
    || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || '';
  const referer = request.headers.get('referer') || '';
  const ua = request.headers.get('user-agent') || '';

  await db.prepare(
    `INSERT INTO link_clicks (id, link_id, clicked_at, referer, user_agent, ip_hash, country)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    newId(), link.id, now(),
    referer.slice(0, 500),
    ua.slice(0, 500),
    await hashIP(ip),
    country || ''
  ).run();

  await db.prepare(
    `UPDATE users SET link_click_month = ?, link_click_count = ? WHERE id = ?`
  ).bind(mk, used + 1, link.developer_id).run();

  return { recorded: true };
}

// ---- 统计 ----
// 统计明细只回看该等级对应的保留期（free 30 天 / pro 90 天）
export async function linkStats(
  db: D1Database,
  linkId: string,
  retentionDays = 30
): Promise<any> {
  const since = now() - Math.max(1, retentionDays) * 86400;
  const clicks = await db.prepare(
    `SELECT clicked_at, referer, user_agent, country FROM link_clicks
     WHERE link_id = ? AND clicked_at >= ? ORDER BY clicked_at DESC LIMIT 500`
  ).bind(linkId, since).all<any>();
  const rows = clicks.results || [];

  const total = await db.prepare(
    `SELECT COUNT(*) AS c FROM link_clicks WHERE link_id = ? AND clicked_at >= ?`
  ).bind(linkId, since).first<any>();

  // 最近 7 天趋势
  const dayMs = 86400;
  const today = Math.floor(now() / dayMs);
  const trend: { day: string; count: number }[] = [];
  const dayCount = new Map<number, number>();
  for (const r of rows) {
    const d = Math.floor(r.clicked_at / dayMs);
    dayCount.set(d, (dayCount.get(d) || 0) + 1);
  }
  for (let i = 6; i >= 0; i--) {
    const d = today - i;
    const date = new Date(d * dayMs * 1000);
    trend.push({
      day: `${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`,
      count: dayCount.get(d) || 0,
    });
  }

  const sources = { direct: 0, social: 0, external: 0 };
  const devices = { mobile: 0, desktop: 0, other: 0 };
  const countries: Record<string, number> = {};
  for (const r of rows) {
    sources[classifyReferer(r.referer)]++;
    devices[classifyDevice(r.user_agent)]++;
    const c = r.country || '未知';
    countries[c] = (countries[c] || 0) + 1;
  }

  const recent = rows.slice(0, 50).map(r => ({
    clicked_at: r.clicked_at,
    source: classifyReferer(r.referer),
    device: classifyDevice(r.user_agent),
    country: r.country || '',
    referer: r.referer,
  }));

  return { total: total?.c || 0, trend, sources, devices, countries, recent };
}

export async function accountUsage(db: D1Database, developerId: string): Promise<any> {
  const u = await db.prepare(
    `SELECT subscription_tier, link_click_month, link_click_count FROM users WHERE id = ?`
  ).bind(developerId).first<any>();
  if (!u) return { limit: FREE_MONTHLY_CLICKS, used: 0, month: monthKey() };
  const mk = monthKey();
  const used = u.link_click_month === mk ? (u.link_click_count || 0) : 0;
  return { limit: monthlyLimit(u.subscription_tier || 'free'), used, month: mk, tier: u.subscription_tier || 'free' };
}
