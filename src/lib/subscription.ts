import { now } from './db';

/**
 * Shademark 平台统一订阅（Platform-wide Subscription）
 * ------------------------------------------------------------------
 * 一个账号、一个等级、所有工具通用。
 * users.subscription_tier / users.subscription_expires_at 是**平台级状态**，
 * 不是某个工具的状态：在 /platform 把开发者改成 pro 之后，发码平台、
 * 短链接、水印工具的付费功能同时生效，不需要分别开通。
 *
 * 过期不做删除，只做回落：expires_at < now 时自动按 free 权益运行。
 */

export type Tier = 'free' | 'pro';

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
  },
  pro: {
    code_auto_confirm: true,
    code_batch: true,
    code_api_per_min: 600,
    code_retention_days: 90,
    link_monthly_clicks: 500000,
    link_retention_days: 90,
    link_csv_export: true,
    watermark_pro: true,
  },
};

/** 该记录当前是否处于 Pro 有效期（tier=pro 且未过期） */
export function isProNow(tier?: string | null, expiresAt?: number | null): boolean {
  if (tier !== 'pro') return false;
  if (!expiresAt) return true;          // NULL / 0 = 不限期
  return expiresAt > now();
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

/** 前端 / 接口用的订阅状态快照 */
export function subscriptionState(user?: {
  subscription_tier?: string | null;
  subscription_expires_at?: number | null;
} | null) {
  const tier = effectiveTier(user);
  const expiresAt = user?.subscription_expires_at || null;
  const secondsLeft = expiresAt ? expiresAt - now() : null;
  return {
    tier,                                        // 实际生效等级
    stored_tier: user?.subscription_tier || 'free',
    is_pro: tier === 'pro',
    expires_at: expiresAt,
    expired: !!user && user.subscription_tier === 'pro' && tier === 'free',
    days_left: secondsLeft && secondsLeft > 0 ? Math.ceil(secondsLeft / 86400) : null,
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
 * SQL 片段：判断某用户当前是否为 Pro（用于清理任务的按等级保留）。
 * 传入当前时间戳与表别名，例如 proSql(nowSec, 'u')。
 */
export function proSql(ts: number, alias = 'u'): string {
  return `(${alias}.subscription_tier = 'pro' AND (${alias}.subscription_expires_at IS NULL OR ${alias}.subscription_expires_at > ${ts}))`;
}

/** 计算到期时间：days 为空/0 表示不限期（NULL） */
export function computeExpiresAt(tier: Tier, days?: number | null): number | null {
  if (tier !== 'pro') return null;
  if (!days || days <= 0) return null;
  return now() + Math.floor(days * 86400);
}
