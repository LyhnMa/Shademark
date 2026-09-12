import { jsonResponse, now } from '../../lib/db';
import { tokenHash } from '../../lib/reset';
import { maskEmail } from '../../lib/validate';

// POST /api/auth/reset-verify  —— 打开重置页时先校验链接是否还能用
export async function onRequestPost(context: any): Promise<Response> {
  const { request, env } = context;
  const body = await request.json<any>().catch(() => ({}));
  const token = String(body.token || '').trim();

  if (!token) return jsonResponse({ valid: false, reason: 'missing' });

  const row = await env.DB.prepare(
    `SELECT t.expires_at, t.used_at, u.email, u.recovery_email
     FROM password_reset_tokens t
     JOIN users u ON t.user_id = u.id
     WHERE t.token_hash = ?`
  )
    .bind(tokenHash(token))
    .first<any>();

  if (!row) return jsonResponse({ valid: false, reason: 'not_found' });
  if (row.used_at) return jsonResponse({ valid: false, reason: 'used' });
  if (row.expires_at <= now()) return jsonResponse({ valid: false, reason: 'expired' });

  return jsonResponse({
    valid: true,
    account: maskEmail(row.recovery_email || row.email),
  });
}
