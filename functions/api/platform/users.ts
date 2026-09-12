import { jsonResponse, errorResponse } from '../../lib/db';
import { requirePlatform } from '../../lib/auth';
import {
  effectiveTier,
  computeExpiresAt,
  subscriptionStatus,
  graceEndsAt,
  GRACE_DAYS,
  EXPIRING_DAYS,
} from '../../lib/subscription';

const DAY = 86400;

// GET /api/platform/users —— 全平台用户 + 订阅等级 + 到期状态（Shademark 平台统一订阅）
// status: permanent 永久 / active 正常 / expiring 即将到期 / grace 宽限期中 / expired 待降级 / downgraded 已降级 / free
export async function onRequestGet(context: any): Promise<Response> {
  const { request, env } = context;
  const user = await requirePlatform(request, env);
  if (user instanceof Response) return user;

  const rows = await env.DB.prepare(
    `SELECT u.id, u.email, u.contact, u.subscription_tier, u.subscription_expires_at, u.ever_pro,
            u.role, u.created_at,
            (SELECT COUNT(*) FROM links l WHERE l.developer_id = u.id) AS link_count,
            (SELECT COUNT(*) FROM products p WHERE p.developer_id = u.id) AS product_count
     FROM users u ORDER BY u.created_at DESC LIMIT 500`
  ).all<any>();

  const nowSec = Math.floor(Date.now() / 1000);
  const users = (rows.results || []).map((u: any) => {
    const status = subscriptionStatus(u, nowSec);
    const isPro = status === 'permanent' || status === 'active' || status === 'expiring' || status === 'grace';
    const graceEnd = graceEndsAt(u.subscription_expires_at);
    return {
      ...u,
      effective_tier: effectiveTier(u),          // grace 期内仍为 pro
      status,
      is_pro: isPro,                             // 当前是否真的能用 Pro 功能
      expired: u.subscription_tier === 'pro' && effectiveTier(u) === 'free',
      in_grace: status === 'grace',
      grace_ends_at: status === 'grace' ? graceEnd : null,
      grace_days_left: status === 'grace' && graceEnd
        ? Math.max(0, Math.ceil((graceEnd - nowSec) / DAY))
        : null,
      days_left: u.subscription_expires_at
        ? Math.max(0, Math.ceil((u.subscription_expires_at - nowSec) / DAY))
        : null,
    };
  });

  // 「即将到期」清单：即将到期 + 宽限期中，最紧急的排前面
  const attention = users
    .filter((u: any) => u.status === 'expiring' || u.status === 'grace')
    .sort((a: any, b: any) => {
      const rank = (x: any) => (x.status === 'grace' ? 0 : 1);
      if (rank(a) !== rank(b)) return rank(a) - rank(b);
      return (a.days_left || 0) - (b.days_left || 0);
    });

  return jsonResponse({
    users,
    summary: {
      total: users.length,
      pro: users.filter((u: any) => u.is_pro).length,
      expiring: users.filter((u: any) => u.status === 'expiring').length,
      grace: users.filter((u: any) => u.status === 'grace').length,
      expired: users.filter((u: any) => u.status === 'expired').length,
      downgraded: users.filter((u: any) => u.status === 'downgraded').length,
      expiring_days: EXPIRING_DAYS,
      grace_days: GRACE_DAYS,
    },
    attention,
  });
}

// PUT /api/platform/users —— 设置订阅等级
// body: { user_id, tier: 'free' | 'pro', days?: number }  days 省略或 0 = 不限期
export async function onRequestPut(context: any): Promise<Response> {
  const { request, env } = context;
  const user = await requirePlatform(request, env);
  if (user instanceof Response) return user;

  const body = await request.json<any>().catch(() => ({}));
  const { user_id, tier, days } = body;
  if (!user_id) return errorResponse('缺少用户 ID', 400);
  if (tier !== 'free' && tier !== 'pro') return errorResponse('等级只能是 free 或 pro', 400);

  const target = await env.DB.prepare(
    `SELECT id FROM users WHERE id = ?`
  ).bind(user_id).first<any>();
  if (!target) return errorResponse('用户不存在', 404);

  const expiresAt = computeExpiresAt(tier, days);
  // ever_pro=1 表示「开过 Pro」：降级后保留期仍按 Pro 档（90 天），数据不因降级被清
  const everPro = tier === 'pro' ? 1 : 0;
  await env.DB.prepare(
    `UPDATE users
       SET subscription_tier = ?, subscription_expires_at = ?,
           ever_pro = CASE WHEN ? = 1 THEN 1 ELSE ever_pro END
     WHERE id = ?`
  ).bind(tier, expiresAt, everPro, user_id).run();

  const after = { subscription_tier: tier, subscription_expires_at: expiresAt, ever_pro: tier === 'pro' ? 1 : undefined };
  return jsonResponse({
    success: true,
    user_id,
    tier,
    expires_at: expiresAt,
    effective_tier: effectiveTier(after),
    status: subscriptionStatus(after),
  });
}
