import { jsonResponse, errorResponse } from '../../lib/db';
import { requirePlatform } from '../../lib/auth';
import { setLinkActive, deleteLink, attachCounts } from '../../lib/links';

// GET /api/platform/links —— 全平台链接（含归属开发者）
export async function onRequestGet(context: any): Promise<Response> {
  const { request, env } = context;
  const user = await requirePlatform(request, env);
  if (user instanceof Response) return user;

  const rows = await env.DB.prepare(
    `SELECT l.*, u.email AS developer_email
     FROM links l JOIN users u ON l.developer_id = u.id
     ORDER BY l.created_at DESC LIMIT 200`
  ).all<any>();

  const links = await attachCounts(env.DB, rows.results || []);
  const stats = await env.DB.prepare(
    `SELECT (SELECT COUNT(*) FROM links) AS link_count,
            (SELECT COUNT(*) FROM link_clicks) AS click_count,
            (SELECT COUNT(*) FROM users) AS user_count`
  ).first<any>();

  return jsonResponse({ links, stats });
}

// PUT /api/platform/links —— 一键停用 / 启用任意链接
export async function onRequestPut(context: any): Promise<Response> {
  const { request, env } = context;
  const user = await requirePlatform(request, env);
  if (user instanceof Response) return user;

  const body = await request.json<any>().catch(() => ({}));
  const { id, is_active } = body;
  if (!id) return errorResponse('缺少链接 ID', 400);

  const link = await env.DB.prepare(`SELECT id FROM links WHERE id = ?`).bind(id).first<any>();
  if (!link) return errorResponse('链接不存在', 404);

  await setLinkActive(env.DB, id, is_active ? 1 : 0);
  return jsonResponse({ success: true, is_active: is_active ? 1 : 0 });
}

// DELETE /api/platform/links?id=xxx —— 删除违规链接及其点击数据
export async function onRequestDelete(context: any): Promise<Response> {
  const { request, env } = context;
  const user = await requirePlatform(request, env);
  if (user instanceof Response) return user;

  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  if (!id) return errorResponse('缺少链接 ID', 400);

  await deleteLink(env.DB, id);
  return jsonResponse({ success: true });
}
