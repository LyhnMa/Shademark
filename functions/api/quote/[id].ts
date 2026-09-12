import { jsonResponse, errorResponse } from '../../lib/db';
import { requireAdmin } from '../../lib/auth';
import { getQuote, deleteQuote } from '../../lib/quote';

// GET /api/quote/:id —— 取回某份报价单（用于“重新打开为模板”）
export async function onRequestGet(context: any): Promise<Response> {
  const { request, env, params } = context;
  const user = await requireAdmin(request, env);
  if (user instanceof Response) return user;

  const q = await getQuote(env.DB, user.user_id, params.id);
  if (!q) return errorResponse('报价单不存在', 404);
  q.items = typeof q.items === 'string' ? JSON.parse(q.items) : (q.items || []);
  return jsonResponse({ record: q });
}

// DELETE /api/quote/:id —— 删除某份历史报价单
export async function onRequestDelete(context: any): Promise<Response> {
  const { request, env, params } = context;
  const user = await requireAdmin(request, env);
  if (user instanceof Response) return user;

  const ok = await deleteQuote(env.DB, user.user_id, params.id);
  if (!ok) return errorResponse('报价单不存在', 404);
  return jsonResponse({ success: true });
}
