import type { Env } from '../../lib/db';
import { jsonResponse, errorResponse } from '../../lib/db';
import { requireAdmin } from '../../lib/auth';
import { batchGenerate, getAllCodes, revokeCode } from '../../lib/codes';
import { effectiveTier, canBatch } from '../../lib/subscription';

// GET /api/admin/codes?product_id=&status= —— 按开发者+可选筛选列出激活码
export async function onRequestGet(context: any): Promise<Response> {
  const { request, env } = context;
  const user = await requireAdmin(request, env);
  if (user instanceof Response) return user;

  const { searchParams } = new URL(request.url);
  const product_id = searchParams.get('product_id') || undefined;
  const status = searchParams.get('status') || undefined;

  const codes = await getAllCodes(env.DB, user.user_id, { product_id, status });
  return jsonResponse({ codes: codes.results });
}

// POST /api/admin/codes { product_id, count } —— 按商品有效期批量生成
export async function onRequestPost(context: any): Promise<Response> {
  const { request, env } = context;
  const user = await requireAdmin(request, env);
  if (user instanceof Response) return user;

  const body = await request.json<any>().catch(() => ({}));

  // 单码作废：POST /api/admin/codes { action: "revoke", code_id }
  // 仅 unused 可作废；校验归属后调用 lib/codes.revokeCode()
  if (body?.action === 'revoke') {
    const codeId = body.code_id;
    if (!codeId) return errorResponse('缺少激活码ID', 400);
    const code = await env.DB.prepare(
      `SELECT c.status FROM activation_codes c
       JOIN products p ON c.product_id = p.id
       WHERE c.id = ? AND p.developer_id = ?`
    ).bind(codeId, user.user_id).first<any>();
    if (!code) return errorResponse('激活码不存在', 404);
    if (code.status !== 'unused') return errorResponse('仅未售的激活码可作废', 400);
    const ok = await revokeCode(env.DB, codeId);
    if (!ok) return errorResponse('作废失败', 400);
    return jsonResponse({ success: true, id: codeId, status: 'revoked' });
  }

  const { product_id, count = 10 } = body;

  if (!product_id) return errorResponse('缺少产品ID', 400);
  if (count < 1 || count > 10000) return errorResponse('生成数量必须在1-10000之间', 400);

  const tier = effectiveTier(user);
  const maxBatch = canBatch(tier) ? 10000 : 100;
  if (count > maxBatch) {
    return errorResponse(`当前等级（${tier}）单次最多生成 ${maxBatch} 个，升级 Pro 可单次生成 10000 个`, 403);
  }

  const product = await env.DB.prepare(
    `SELECT * FROM products WHERE id = ? AND developer_id = ?`
  ).bind(product_id, user.user_id).first<any>();
  if (!product) return errorResponse('商品不存在', 404);

  const nowTs = Math.floor(Date.now() / 1000);
  // 有效期：生成时即计算。商品 code_validity_days 有值 → expires_at = 生成时间 + 天数；无值/0 → NULL(永久)
  const expiresAt: number | null = product.code_validity_days && product.code_validity_days > 0
    ? nowTs + product.code_validity_days * 86400
    : null;

  const batchSize = 20;
  for (let i = 0; i < count; i += batchSize) {
    const batchCount = Math.min(batchSize, count - i);
    const codes = batchGenerate(batchCount, product.code_prefix, product.code_length, product.code_charset as any);
    const values = codes.map((code_value: string) => ({
      id: crypto.randomUUID(),
      product_id,
      code_value,
      status: 'unused',
      created_at: nowTs,
      expires_at: expiresAt,
    }));

    const placeholders = values.map(() => '(?, ?, ?, ?, ?, ?)').join(', ');
    const params = values.flatMap((v: any) => [v.id, v.product_id, v.code_value, v.status, v.created_at, v.expires_at]);
    await env.DB.prepare(
      `INSERT INTO activation_codes (id, product_id, code_value, status, created_at, expires_at) VALUES ${placeholders}`
    ).bind(...params).run();
  }

  return jsonResponse({ success: true, count });
}

// DELETE /api/admin/codes?id=xxx  或  body { ids: [..] } —— 仅 unused / revoked 可物理删除（支持批量）
export async function onRequestDelete(context: any): Promise<Response> {
  const { request, env } = context;
  const user = await requireAdmin(request, env);
  if (user instanceof Response) return user;

  const { searchParams } = new URL(request.url);
  const single = searchParams.get('id');
  let ids: string[] = [];
  if (single) {
    ids = [single];
  } else {
    const body = await request.json<any>().catch(() => ({}));
    if (Array.isArray(body?.ids) && body.ids.length) ids = body.ids;
  }
  if (!ids.length) return errorResponse('缺少激活码ID', 400);

  let deleted = 0;
  for (const codeId of ids) {
    // 归属 + 状态校验
    const owned = await env.DB.prepare(
      `SELECT c.id, c.status FROM activation_codes c
       JOIN products p ON c.product_id = p.id
       WHERE c.id = ? AND p.developer_id = ?`
    ).bind(codeId, user.user_id).first<any>();
    if (!owned) continue;
    if (owned.status !== 'unused' && owned.status !== 'revoked') continue;

    await env.DB.prepare(`DELETE FROM activation_codes WHERE id = ?`).bind(codeId).run();
    deleted++;
  }

  if (deleted === 0 && ids.length === 1) {
    // 单删且全部未通过校验 → 明确提示
    const codeId = ids[0];
    const owned = await env.DB.prepare(
      `SELECT c.status FROM activation_codes c
       JOIN products p ON c.product_id = p.id
       WHERE c.id = ? AND p.developer_id = ?`
    ).bind(codeId, user.user_id).first<any>();
    if (!owned) return errorResponse('激活码不存在', 404);
    return errorResponse('仅未售或已作废的激活码可删除', 400);
  }

  return jsonResponse({ success: true, deleted });
}
