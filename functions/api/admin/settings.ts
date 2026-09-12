import type { Env } from '../../lib/db';
import { jsonResponse, errorResponse } from '../../lib/db';
import { requireAdmin, createAPIKey } from '../../lib/auth';

export async function onRequestGet(context: any): Promise<Response> {
  const { request, env } = context;
  const user = await requireAdmin(request, env);
  if (user instanceof Response) return user;

  const keys = await env.DB.prepare(
    `SELECT * FROM api_keys WHERE developer_id = ? ORDER BY created_at DESC`
  ).bind(user.user_id).all<any>();

  return jsonResponse({ apiKeys: keys.results });
}

export async function onRequestPost(context: any): Promise<Response> {
  const { request, env } = context;
  const user = await requireAdmin(request, env);
  if (user instanceof Response) return user;

  const body = await request.json<any>().catch(() => ({}));
  const { action, scope, key_id } = body;

  if (action === 'create_api_key') {
    const validScopes = ['verify', 'confirm', 'all'];
    if (!validScopes.includes(scope)) return errorResponse('权限范围无效', 400);

    const { key_value, secret } = await createAPIKey(env.DB, user.user_id, scope);
    return jsonResponse({ key_value, secret }, 201);
  }

  if (action === 'revoke_api_key' && key_id) {
    await env.DB.prepare(
      `UPDATE api_keys SET is_active = 0 WHERE id = ? AND developer_id = ?`
    ).bind(key_id, user.user_id).run();
    return jsonResponse({ success: true });
  }

  return errorResponse('未知操作', 400);
}
