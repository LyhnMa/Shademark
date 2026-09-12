import { jsonResponse, errorResponse } from '../../lib/db';
import { hashPassword, createSession } from '../../lib/auth';
import { isEmail } from '../../lib/validate';

// POST /api/auth/register
// 注册只认邮箱：邮箱就是登录名，也是找回密码的唯一凭据。
export async function onRequestPost(context: any): Promise<Response> {
  const { request, env } = context;
  const body = await request.json<any>().catch(() => ({}));
  const email = String(body.email || '').trim();
  const password = String(body.password || '');
  // 可选：显示名（只用于界面显示，不作登录用）
  const display_name = String(body.display_name || '').trim();
  // 可选联系方式（微信号/手机号等，与 email 独立，不填则空）
  const contact = String(body.contact || '').trim();

  if (!email || !password) return errorResponse('邮箱和密码必填', 400);
  if (!isEmail(email)) return errorResponse('请填写有效的邮箱地址', 400);
  if (password.length < 6) return errorResponse('密码至少6位', 400);
  if (display_name.length > 40) return errorResponse('显示名过长', 400);
  if (contact.length > 200) return errorResponse('联系方式过长', 400);

  // 主邮箱与找回邮箱统一查重，避免同一邮箱出现两个账号
  const existing = await env.DB.prepare(
    `SELECT id FROM users
     WHERE lower(email) = lower(?) OR (recovery_email <> '' AND lower(recovery_email) = lower(?))`
  )
    .bind(email, email)
    .first<any>();
  if (existing) return errorResponse('该邮箱已注册', 400);

  const password_hash = await hashPassword(password);
  const id = crypto.randomUUID();
  const created_at = Math.floor(Date.now() / 1000);

  await env.DB.prepare(
    `INSERT INTO users (id, email, display_name, contact, password_hash, subscription_tier, created_at)
     VALUES (?, ?, ?, ?, ?, 'free', ?)`
  ).bind(id, email, display_name, contact, password_hash, created_at).run();

  const token = await createSession(env.DB, id);
  const response = jsonResponse({ success: true, email });
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  response.headers.set(
    'Set-Cookie',
    `session=${token}; HttpOnly; Path=/; SameSite=Strict${secure}`
  );
  return response;
}
