import { jsonResponse, errorResponse } from '../../lib/db';
import { authenticate } from '../../lib/auth';

// POST /api/auth/dismiss-email-prompt —— 关掉「补一个邮箱」的提示，之后不再提
export async function onRequestPost(context: any): Promise<Response> {
  const { request, env } = context;

  const auth = await authenticate(request, env);
  if (!auth.authenticated || !auth.user) return errorResponse('未登录', 401);

  await env.DB.prepare(`UPDATE users SET email_prompt_dismissed = 1 WHERE id = ?`)
    .bind(auth.user.user_id)
    .run();

  return jsonResponse({ success: true });
}
