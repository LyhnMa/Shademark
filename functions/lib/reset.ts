import crypto from 'node:crypto';
import { now } from './db';

/** 重置令牌：只把 sha256 十六进制存库，明文只出现在邮件链接里 */
export function tokenHash(token: string): string {
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}

export function newResetToken(): { token: string; hash: string } {
  const token = crypto.randomBytes(32).toString('base64url');
  return { token, hash: tokenHash(token) };
}

/** 对外隐藏真实 IP：只存加盐哈希 */
export function hashIp(env: any, request: Request): string {
  const ip = request.headers.get('CF-Connecting-IP') || '';
  if (!ip) return '';
  const pepper = env.RESET_IP_PEPPER || env.CRON_SECRET || 'shademark';
  return crypto.createHash('sha256').update(`${ip}|${pepper}`, 'utf8').digest('hex').slice(0, 32);
}

/** 重置链接有效期（分钟），默认 30，允许 5–1440 */
export function resetTtlMinutes(env: any): number {
  const n = parseInt(String(env.RESET_TTL_MINUTES || '30'), 10);
  if (!Number.isFinite(n) || n < 5 || n > 1440) return 30;
  return n;
}

/** 站点来源：邮件里的链接域名以此为准，默认取本次请求的来源 */
export function appOrigin(request: Request, env: any): string {
  const configured = String(env.APP_ORIGIN || '').trim().replace(/\/+$/, '');
  if (configured) return configured;
  return new URL(request.url).origin;
}

const RATE_WINDOW_SECONDS = 15 * 60;
const MAX_PER_USER = 3;
const MAX_PER_IP = 10;

/**
 * 限频：同一账号 15 分钟内最多 3 次，同一 IP 最多 10 次。
 * 命中限频时依然返回同一句文案（不泄露邮箱是否存在）。
 */
export async function resetRateLimited(
  db: D1Database,
  userId: string,
  ipHashValue: string,
  nowSec: number
): Promise<boolean> {
  const since = nowSec - RATE_WINDOW_SECONDS;

  const byUser = await db
    .prepare(`SELECT COUNT(*) AS c FROM password_reset_tokens WHERE user_id = ? AND created_at > ?`)
    .bind(userId, since)
    .first<any>();
  if ((byUser?.c || 0) >= MAX_PER_USER) return true;

  if (ipHashValue) {
    const byIp = await db
      .prepare(`SELECT COUNT(*) AS c FROM password_reset_tokens WHERE request_ip = ? AND created_at > ?`)
      .bind(ipHashValue, since)
      .first<any>();
    if ((byIp?.c || 0) >= MAX_PER_IP) return true;
  }
  return false;
}

/** 按邮箱找账号（主邮箱或找回邮箱，忽略大小写） */
export async function findUserByEmail(db: D1Database, email: string): Promise<any> {
  return db
    .prepare(
      `SELECT id, email, recovery_email, display_name, email_prompt_dismissed
       FROM users
       WHERE lower(email) = lower(?) OR (recovery_email <> '' AND lower(recovery_email) = lower(?))`
    )
    .bind(email, email)
    .first<any>();
}

/** 抹平「账号存在 / 不存在」的响应时间差，避免通过耗时探测邮箱是否注册 */
export async function padResponse(startedAt: number, minMs = 600): Promise<void> {
  const elapsed = Date.now() - startedAt;
  if (elapsed < minMs) await new Promise((r) => setTimeout(r, minMs - elapsed));
}

export { now };
