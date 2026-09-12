import { jsonResponse, errorResponse } from '../../lib/db';
import { verifyPassword, createSession } from '../../lib/auth';
import { isEmail } from '../../lib/validate';

// POST /api/auth/login
// 登录凭据只有一个：邮箱。存量账号当年用非邮箱字符串注册的，老登录名继续可用，
// 登录成功后会轻提示补一个邮箱（不补也能继续用，只是找回密码要靠邮箱）。
export async function onRequestPost(context: any): Promise<Response> {
  const { request, env } = context;
  const body = await request.json<any>().catch(() => ({}));
  const login = String(body.email || '').trim();
  const password = String(body.password || '');

  if (!login || !password) return errorResponse('邮箱和密码必填', 400);

  const user = await env.DB.prepare(
    `SELECT * FROM users
     WHERE lower(email) = lower(?) OR (recovery_email <> '' AND lower(recovery_email) = lower(?))`
  )
    .bind(login, login)
    .first<any>();

  if (!user) return errorResponse('邮箱或密码错误', 401);

  const valid = await verifyPassword(password, user.password_hash);
  if (!valid) return errorResponse('邮箱或密码错误', 401);

  const token = await createSession(env.DB, user.id);
  const response = jsonResponse({
    success: true,
    email: user.email,
    display_name: user.display_name || '',
    // 角色维度：user=普通用户（自己的后台 /admin）；platform=平台方（/platform）
    role: user.role || 'user',
    // 登录名不是邮箱，且用户还没表态过 → 轻提示补一个
    needs_email: !isEmail(user.email) && !user.email_prompt_dismissed,
  });
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  response.headers.set(
    'Set-Cookie',
    `session=${token}; HttpOnly; Path=/; SameSite=Strict${secure}`
  );
  return response;
}
