import { jsonResponse, errorResponse } from '../../../lib/db';
import { requirePlatform } from '../../../lib/auth';

// PATCH /api/platform/contacts/:id —— 标记为已处理
// body: { status: 'done' }
export async function onRequestPatch(context: any): Promise<Response> {
  const { request, env } = context;
  const user = await requirePlatform(request, env);
  if (user instanceof Response) return user;

  const id = context.params?.id as string;
  if (!id) return errorResponse('缺少消息 ID', 400);

  const body = await request.json<any>().catch(() => ({}));
  const status = body.status === 'done' ? 'done' : 'done';

  const r = await env.DB.prepare(
    `UPDATE contact_messages SET status = ? WHERE id = ?`
  ).bind(status, id).run();

  if (r.meta.changes === 0) return errorResponse('消息不存在', 404);
  return jsonResponse({ success: true });
}

// DELETE /api/platform/contacts/:id —— 删除消息
export async function onRequestDelete(context: any): Promise<Response> {
  const { request, env } = context;
  const user = await requirePlatform(request, env);
  if (user instanceof Response) return user;

  const id = context.params?.id as string;
  if (!id) return errorResponse('缺少消息 ID', 400);

  const r = await env.DB.prepare(
    `DELETE FROM contact_messages WHERE id = ?`
  ).bind(id).run();

  if (r.meta.changes === 0) return errorResponse('消息不存在', 404);
  return jsonResponse({ success: true });
}
