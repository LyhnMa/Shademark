import { jsonResponse, errorResponse } from '../../lib/db';
import { authenticate } from '../../lib/auth';
import { isEmail } from '../../lib/validate';

// POST /api/auth/bind-email  { email }
// 用于存量账号（当年登录名不是邮箱）补一个邮箱，补完即可用它登录 / 找回密码。
// 不修改 users.email（老登录名继续可用），只写 recovery_email。
export async function onRequestPost(context: any): Promise<Response> {
  const { request, env } = context;

  const auth = await authenticate(request, env);
  if (!auth.authenticated || !auth.user) return errorResponse('未登录', 401);
  const userId = auth.user.user_id;

  const body = await request.json<any>().catch(() => ({}));
  const email = String(body.email || '').trim();

  if (!isEmail(email)) return errorResponse('请填写有效的邮箱地址', 400);

  const existing = await env.DB.prepare(
    `SELECT id FROM users
     WHERE lower(email) = lower(?) OR (recovery_email <> '' AND lower(recovery_email) = lower(?))`
  )
    .bind(email, email)
    .first<any>();

  if (existing && existing.id !== userId) {
    return errorResponse('这个邮箱已经被其他账号使用了', 400);
  }

  await env.DB.prepare(
    `UPDATE users SET recovery_email = ?, email_prompt_dismissed = 1 WHERE id = ?`
  )
    .bind(email, userId)
    .run();

  return jsonResponse({ success: true, email });
}
