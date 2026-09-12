import { jsonResponse, errorResponse } from '../lib/db';
import { requireAdmin } from '../lib/auth';
import {
  createLink, listLinks, setLinkActive, deleteLink, linkStats, accountUsage, attachCounts
} from '../lib/links';
import { effectiveTier, linkRetentionDays, canExportCSV } from '../lib/subscription';

// GET /api/links —— 列表（含用量）；?id=xxx&detail=1 —— 单条统计
export async function onRequestGet(context: any): Promise<Response> {
  const { request, env } = context;
  const user = await requireAdmin(request, env);
  if (user instanceof Response) return user;

  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

  const tier = effectiveTier(user);
  const retention = linkRetentionDays(tier);

  if (id && searchParams.get('detail') === '1') {
    const link = await env.DB.prepare(
      `SELECT * FROM links WHERE id = ? AND developer_id = ?`
    ).bind(id, user.user_id).first<any>();
    if (!link) return errorResponse('链接不存在', 404);
    const stats = await linkStats(env.DB, id, retention);
    return jsonResponse({ link, stats, tier, retention_days: retention });
  }

  const links = await listLinks(env.DB, user.user_id);
  const usage = await accountUsage(env.DB, user.user_id);
  return jsonResponse({ links, usage });
}

// POST /api/links —— 创建
export async function onRequestPost(context: any): Promise<Response> {
  const { request, env } = context;
  const user = await requireAdmin(request, env);
  if (user instanceof Response) return user;

  const body = await request.json<any>().catch(() => ({}));
  const result = await createLink(env.DB, user.user_id, body.target_url, body.slug);
  if (!result.ok) return errorResponse(result.error || '创建失败', 400);

  const origin = new URL(request.url).origin;
  return jsonResponse({
    id: result.link!.id,
    slug: result.link!.slug,
    short_url: `${origin}/l/${result.link!.slug}`,
    target_url: result.link!.target_url,
  }, 201);
}

// DELETE /api/links?id=xxx —— 删除
export async function onRequestDelete(context: any): Promise<Response> {
  const { request, env } = context;
  const user = await requireAdmin(request, env);
  if (user instanceof Response) return user;

  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  if (!id) return errorResponse('缺少链接 ID', 400);

  const link = await env.DB.prepare(
    `SELECT id FROM links WHERE id = ? AND developer_id = ?`
  ).bind(id, user.user_id).first<any>();
  if (!link) return errorResponse('链接不存在', 404);

  await deleteLink(env.DB, id);
  return jsonResponse({ success: true });
}

// PUT /api/links —— 启用/停用
export async function onRequestPut(context: any): Promise<Response> {
  const { request, env } = context;
  const user = await requireAdmin(request, env);
  if (user instanceof Response) return user;

  const body = await request.json<any>().catch(() => ({}));
  const { id, is_active } = body;
  if (!id) return errorResponse('缺少链接 ID', 400);

  const link = await env.DB.prepare(
    `SELECT id FROM links WHERE id = ? AND developer_id = ?`
  ).bind(id, user.user_id).first<any>();
  if (!link) return errorResponse('链接不存在', 404);

  await setLinkActive(env.DB, id, is_active ? 1 : 0);
  const [row] = await attachCounts(env.DB, [{ ...link }]);
  return jsonResponse({ success: true, is_active: is_active ? 1 : 0, clicks: row?.clicks || 0 });
}
