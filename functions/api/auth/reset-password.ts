import { jsonResponse, errorResponse, now } from '../../lib/db';
import { tokenHash } from '../../lib/reset';
import { hashPassword } from '../../lib/auth';
import { maskEmail } from '../../lib/validate';

// POST /api/auth/reset-password  { token, password }
export async function onRequestPost(context: any): Promise<Response> {
  const { request, env } = context;
  const body = await request.json<any>().catch(() => ({}));
  const token = String(body.token || '').trim();
  const password = String(body.password || '');

  if (!token) return errorResponse('链接不完整，请重新获取', 400);
  if (password.length < 6) return errorResponse('密码至少6位', 400);
  if (password.length > 200) return errorResponse('密码过长', 400);

  const nowSec = now();
  const row = await env.DB.prepare(
    `SELECT t.token_hash, t.user_id, t.expires_at, t.used_at, u.email, u.recovery_email
     FROM password_reset_tokens t
     JOIN users u ON t.user_id = u.id
     WHERE t.token_hash = ?`
  )
    .bind(tokenHash(token))
    .first<any>();

  if (!row || row.used_at || row.expires_at <= nowSec) {
    return errorResponse('这个链接失效了，请重新获取', 400);
  }

  const password_hash = await hashPassword(password);

  // 1) 改密码
  await env.DB.prepare(`UPDATE users SET password_hash = ? WHERE id = ?`)
    .bind(password_hash, row.user_id)
    .run();

  // 2) 该令牌一次性作废，同一账号其余未用令牌一并作废
  await env.DB.prepare(
    `UPDATE password_reset_tokens SET used_at = ? WHERE user_id = ? AND used_at IS NULL`
  )
    .bind(nowSec, row.user_id)
    .run();

  // 3) 密码已变更 → 踢掉所有旧会话，其他设备必须重新登录
  await env.DB.prepare(`DELETE FROM sessions WHERE user_id = ?`).bind(row.user_id).run();

  return jsonResponse({
    success: true,
    account: maskEmail(row.recovery_email || row.email),
  });
}
