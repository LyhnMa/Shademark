import { jsonResponse } from '../../lib/db';
import { getSession } from '../../lib/auth';
import { subscriptionState } from '../../lib/subscription';
import { isEmail } from '../../lib/validate';

// GET /api/auth/session —— 查询当前登录态
export async function onRequestGet(context: any): Promise<Response> {
  const { request, env } = context;
  const cookie = request.headers.get('cookie') || '';
  const sessionToken = cookie.match(/session=([^;]+)/)?.[1];

  if (!sessionToken) return jsonResponse({ authenticated: false });

  const session = await getSession(env.DB, sessionToken);
  if (!session) return jsonResponse({ authenticated: false });

  return jsonResponse({
    authenticated: true,
    user: {
      email: session.email,
      display_name: session.display_name || '',
      // 角色维度：user=普通用户（自己的后台 /admin）；platform=平台方（/platform）
      role: session.role || 'user',
      // 存量账号（登录名不是邮箱）且还没表态过 → 前端轻提示补一个邮箱
      needs_email: !isEmail(session.email) && !session.email_prompt_dismissed,
      subscription_tier: session.subscription_tier,
      // 曾开过 Pro：降级后数据仍按 Pro 档保留（90 天），界面按这个显示
      ever_pro: !!session.ever_pro,
    },
    // 平台统一订阅：一个账号、一个等级，全矩阵通用
    subscription: subscriptionState(session),
  });
}
