import { now } from './db';

/**
 * ShadeMark 平台统一订阅（Platform-wide Subscription）
 * ------------------------------------------------------------------
 * 一个账号、一个等级、所有工具通用。
 * users.subscription_tier / users.subscription_expires_at 是**平台级状态**，
 * 不是某个工具的状态：在 /platform 把开发者改成 pro 之后，发码平台、
 * 短链接、水印工具的付费功能同时生效，不需要分别开通。
 *
 * 过期不做删除，只做回落：过期后先走 3 天宽限期（权益不变、仅提示续费），
 * 宽限结束才按 free 权益运行，并由定时任务把 tier 落库成 free。
 * 降级只改 tier 一列，用户的链接 / 订单 / 报价单 / 统计记录一律保留。
 */

export type Tier = 'free' | 'pro';

/**
 * 宽限期（Grace Period）
 * ------------------------------------------------------------------
 * 到期后不立刻断供：再给 3 天，功能全保留，页面提示续费。
 * 宽限算法**不额外存字段** —— 一律由 `subscription_expires_at + GRACE_DAYS` 推导：
 *   到期时间 + 3 天 > now   → 仍按 pro 运行（宽限期内）
 *   到期时间 + 3 天 <= now  → 按 free 运行，并由定时任务把库里的 tier 落为 free
 */
export const GRACE_DAYS = 3;
const DAY_SECONDS = 86400;

/** 宽限结束时间戳 = 到期时间 + 3 天；不限期返回 null */
export function graceEndsAt(expiresAt?: number | null): number | null {
  if (!expiresAt) return null;
  return expiresAt + GRACE_DAYS * DAY_SECONDS;
}

/** 是否处于宽限期：已过到期时间，但还在「到期时间 + 3 天」以内 */
export function inGrace(
  tier?: string | null,
  expiresAt?: number | null,
  at: number = now()
): boolean {
  if (tier !== 'pro' || !expiresAt) return false;
  return expiresAt <= at && expiresAt + GRACE_DAYS * DAY_SECONDS > at;
}

export interface PlanLimits {
  // 发码平台
  code_auto_confirm: boolean;        // 自动回调发码
  code_batch: boolean;               // 批量操作
  code_api_per_min: number;          // 验证 API 每分钟调用上限
  code_retention_days: number;       // 订单 / 验证日志保留天数
  // 短链接
  link_monthly_clicks: number;       // 每月可记录的点击数
  link_retention_days: number;       // 点击统计保留天数
  link_csv_export: boolean;          // CSV 导出
  // 水印工具
  watermark_pro: boolean;            // 高级功能（当前工具免费，后续高级功能对 Pro 开放）
  // 报价单
  quote_monthly: number;             // 每月可生成的报价单份数（0 = 无限）
  quote_retention_days: number;      // 报价单历史保留天数
}

export const PLANS: Record<Tier, PlanLimits> = {
  free: {
    code_auto_confirm: false,
    code_batch: false,
    code_api_per_min: 60,
    code_retention_days: 30,
    link_monthly_clicks: 10000,
    link_retention_days: 30,
    link_csv_export: false,
    watermark_pro: false,
    quote_monthly: 5,                // 免费 5 份/月
    quote_retention_days: 30,
  },
  pro: {
    code_auto_confirm: true,
    code_batch: true,
    code_api_per_min: 600,
    code_retention_days: 90,
    link_monthly_clicks: 100000,
    link_retention_days: 90,
    link_csv_export: true,
    watermark_pro: true,
    quote_monthly: 0,                // Pro 无限
    quote_retention_days: 90,
  },
};

/** 该记录当前是否处于 Pro 有效期（tier=pro 且未过期，或过期未超 3 天宽限） */
export function isProNow(
  tier?: string | null,
  expiresAt?: number | null,
  at: number = now()
): boolean {
  if (tier !== 'pro') return false;
  if (!expiresAt) return true;          // NULL / 0 = 不限期
  return expiresAt + GRACE_DAYS * DAY_SECONDS > at;
}

/** 用户对象 → 实际生效等级（过期自动回落 free） */
export function effectiveTier(user?: {
  subscription_tier?: string | null;
  subscription_expires_at?: number | null;
} | null): Tier {
  if (!user) return 'free';
  return isProNow(user.subscription_tier, user.subscription_expires_at) ? 'pro' : 'free';
}

export function planFor(tier: Tier | string | null | undefined): PlanLimits {
  return PLANS[effectiveTier({ subscription_tier: tier })];
}

// ---- 各项权益读取 ----
export function monthlyClickQuota(tier: Tier | string | null | undefined): number {
  return planFor(tier).link_monthly_clicks;
}
export function linkRetentionDays(tier: Tier | string | null | undefined): number {
  return planFor(tier).link_retention_days;
}
export function orderRetentionDays(tier: Tier | string | null | undefined): number {
  return planFor(tier).code_retention_days;
}
export function codeApiPerMinute(tier: Tier | string | null | undefined): number {
  return planFor(tier).code_api_per_min;
}
export function canAutoConfirm(tier: Tier | string | null | undefined): boolean {
  return planFor(tier).code_auto_confirm;
}
export function canBatch(tier: Tier | string | null | undefined): boolean {
  return planFor(tier).code_batch;
}
export function canExportCSV(tier: Tier | string | null | undefined): boolean {
  return planFor(tier).link_csv_export;
}
export function canWatermarkPro(tier: Tier | string | null | undefined): boolean {
  return planFor(tier).watermark_pro;
}

// ---- 报价单 ----
/** 每月生成上限：返回 0 表示无限（Pro）。 */
export function quoteMonthlyQuota(tier: Tier | string | null | undefined): number {
  return planFor(tier).quote_monthly || 0;
}
export function quoteRetentionDays(tier: Tier | string | null | undefined): number {
  return planFor(tier).quote_retention_days;
}
export function quoteUnlimited(tier: Tier | string | null | undefined): boolean {
  return quoteMonthlyQuota(tier) === 0;
}

/** 「即将到期」的判定窗口（天）：到期时间在这个天数内 → 平台页列入即将到期 */
export const EXPIRING_DAYS = 7;

/**
 * 订阅状态机（平台页与接口共用，唯一口径）
 * permanent  不限期 Pro
 * active     Pro 有效，剩余天数 > 7
 * expiring   Pro 即将到期（剩余 ≤ 7 天）
 * grace      已到期，正处于 3 天宽限期（权益保留，提示续费）
 * expired    已超宽限期、库里的 tier 还没被定时任务落成 free
 * downgraded 已降级为 free（曾是 Pro）
 * free       普通免费用户（从未开过 Pro）
 */
export type SubStatus =
  | 'permanent' | 'active' | 'expiring' | 'grace' | 'expired' | 'downgraded' | 'free';

export function subscriptionStatus(
  user?: {
    subscription_tier?: string | null;
    subscription_expires_at?: number | null;
    ever_pro?: number | null;
  } | null,
  at: number = now()
): SubStatus {
  if (!user) return 'free';
  const storedPro = user.subscription_tier === 'pro';
  const expiresAt = user.subscription_expires_at || null;
  // 注意顺序：宽限期也已算「Pro 有效」，必须先判宽限，否则会被误标成 expiring
  if (storedPro && isProNow(user.subscription_tier, expiresAt, at)) {
    if (!expiresAt) return 'permanent';
    if (inGrace(user.subscription_tier, expiresAt, at)) return 'grace';
    const daysLeft = Math.ceil((expiresAt - at) / DAY_SECONDS);
    return daysLeft <= EXPIRING_DAYS ? 'expiring' : 'active';
  }
  if (storedPro) return 'expired';   // 已超宽限、定时任务还没落库
  // tier 已是 free：有到期时间 / 开过 Pro 的都是「降级而来」，其余是从未开通过
  if (user.ever_pro || expiresAt) return 'downgraded';
  return 'free';
}

/**
 * 数据保留天数（与清理任务同一口径）。
 * 关键：降级用户只要「曾经是 Pro」（ever_pro=1 或库里 tier 仍是 pro），
 * 就按 Pro 档保留（90 天），而不是 Free 的 30 天 —— 界面上绝不能显示成 30 天，
 * 否则用户以为旧数据要没了。三个 key：link / order / quote。
 */
export function retainedDays(
  user?: {
    subscription_tier?: string | null;
    ever_pro?: number | null;
  } | null,
  key: 'link' | 'order' | 'quote' = 'link'
): number {
  const everPro = !!(user && (user.ever_pro || user.subscription_tier === 'pro'));
  const plan = everPro ? PLANS.pro : PLANS.free;
  if (key === 'link') return plan.link_retention_days;
  if (key === 'order') return plan.code_retention_days;
  return plan.quote_retention_days;
}

/** 前端 / 接口用的订阅状态快照 */
export function subscriptionState(user?: {
  subscription_tier?: string | null;
  subscription_expires_at?: number | null;
  ever_pro?: number | null;
} | null) {
  const at = now();
  const tier = effectiveTier(user);
  const expiresAt = user?.subscription_expires_at || null;
  const storedTier = user?.subscription_tier || 'free';
  const secondsLeft = expiresAt ? expiresAt - at : null;
  const grace = inGrace(storedTier, expiresAt, at);
  const graceEnd = graceEndsAt(expiresAt);
  const everPro = !!(user && (user.ever_pro || storedTier === 'pro'));
  return {
    tier,                                        // 实际生效等级（含宽限期）
    stored_tier: storedTier,
    is_pro: tier === 'pro',
    status: subscriptionStatus(user, at),
    // 曾开过 Pro：降级后数据仍按 Pro 档保留，界面上不能显示成 Free 的 30 天
    ever_pro: everPro,
    // 实际生效的数据保留窗口（与清理任务同一口径）
    retention: {
      link: retainedDays(user, 'link'),
      order: retainedDays(user, 'order'),
      quote: retainedDays(user, 'quote'),
    },
    expires_at: expiresAt,
    // 已超宽限期、按 Free 运行（宽限期内为 false）
    expired: storedTier === 'pro' && tier === 'free',
    // 宽限期：已到期但功能保留，页面提示续费
    in_grace: grace,
    grace_days: GRACE_DAYS,
    grace_ends_at: grace ? graceEnd : null,
    grace_days_left: grace && graceEnd ? Math.ceil((graceEnd - at) / DAY_SECONDS) : null,
    days_left: secondsLeft && secondsLeft > 0 ? Math.ceil(secondsLeft / DAY_SECONDS) : null,
    features: PLANS[tier],
  };
}

/** 从库里读一个用户的生效等级 */
export async function loadTier(db: D1Database, userId: string): Promise<Tier> {
  const u = await db.prepare(
    `SELECT subscription_tier, subscription_expires_at FROM users WHERE id = ?`
  ).bind(userId).first<any>();
  return effectiveTier(u);
}

/** 从库里读一个用户的完整订阅状态 */
export async function loadSubscription(db: D1Database, userId: string) {
  const u = await db.prepare(
    `SELECT subscription_tier, subscription_expires_at FROM users WHERE id = ?`
  ).bind(userId).first<any>();
  return subscriptionState(u);
}

/**
 * 验证 API 限流：返回 { limit, used, allowed }
 * 统计过去 60 秒内该开发者的验证日志条数（写入失败/异常时不拦截）。
 */
export async function checkVerifyQuota(
  db: D1Database,
  developerId: string
): Promise<{ limit: number; used: number; allowed: boolean }> {
  const row = await db.prepare(
    `SELECT subscription_tier, subscription_expires_at FROM users WHERE id = ?`
  ).bind(developerId).first<any>();
  const tier = effectiveTier(row);
  const limit = codeApiPerMinute(tier);
  try {
    const c = await db.prepare(
      `SELECT COUNT(*) AS c FROM verification_logs
       WHERE created_at > ?
         AND code_value IN (
           SELECT ac.code_value FROM activation_codes ac
           JOIN products p ON ac.product_id = p.id
           WHERE p.developer_id = ?
         )`
    ).bind(now() - 60, developerId).first<any>();
    const used = c?.c || 0;
    return { limit, used, allowed: used < limit };
  } catch {
    return { limit, used: 0, allowed: true };
  }
}

/**
 * SQL 片段：该用户是否按「Pro 保留期」清理数据（用于清理任务分档）。
 *
 * 注意这里**不看是否已过期、也不看宽限期**：只认「现在是 Pro」或「曾经是 Pro」
 * （ever_pro=1）。原因：降级只该限制"新的操作"，绝不能顺手删掉"已有的结果"；
 * 若按实时等级判断，自动降级一落库，用户的 90 天数据会在下一次清理时被当成
 * free 的 30 天档删掉 —— 那就成了降级即删库。续费回来后数据必须还在。
 */
export function proRetentionSql(alias = 'u'): string {
  return `(${alias}.subscription_tier = 'pro' OR ${alias}.ever_pro = 1)`;
}

/**
 * 自动降级：把「Pro 且已超过 3 天宽限期」的账号落为 free。
 * 只 UPDATE subscription_tier 一列，不动 expires_at、不动任何业务数据。
 * 返回受影响行数（即本次降级了几个账号）。
 */
export async function downgradeExpiredPro(
  db: D1Database,
  at: number = now()
): Promise<{ downgraded: number; cutoff: number; checked_at: number }> {
  const cutoff = at - GRACE_DAYS * DAY_SECONDS;   // 到期时间 <= cutoff 即已超宽限
  const res = await db.prepare(
    `UPDATE users SET subscription_tier = 'free'
     WHERE subscription_tier = 'pro'
       AND subscription_expires_at IS NOT NULL
       AND subscription_expires_at <= ?`
  ).bind(cutoff).run();
  return { downgraded: res.meta?.changes ?? 0, cutoff, checked_at: at };
}

/** 计算到期时间：days 为空/0 表示不限期（NULL） */
export function computeExpiresAt(tier: Tier, days?: number | null): number | null {
  if (tier !== 'pro') return null;
  if (!days || days <= 0) return null;
  return now() + Math.floor(days * 86400);
}
