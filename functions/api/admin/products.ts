import type { Env } from '../../lib/db';
import { jsonResponse, errorResponse } from '../../lib/db';
import { hashPassword, verifyPassword, createSession, createAPIKey, requireAdmin, generateAPIKey, generateSecret } from '../../lib/auth';
import { canAutoConfirm, effectiveTier } from '../../lib/subscription';

export async function onRequestGet(context: any): Promise<Response> {
  const { request, env } = context;
  const user = await requireAdmin(request, env);
  if (user instanceof Response) return user;

  const products = await env.DB.prepare(
    `SELECT * FROM products WHERE developer_id = ? ORDER BY created_at DESC`
  ).bind(user.user_id).all<any>();

  return jsonResponse({ products: products.results });
}

export async function onRequestPost(context: any): Promise<Response> {
  const { request, env } = context;
  const user = await requireAdmin(request, env);
  if (user instanceof Response) return user;

  const body = await request.json<any>().catch(() => ({}));
  const { product_id, action } = body;

  // 上架 / 下架（软启用状态切换）
  if (product_id && (action === 'activate' || action === 'deactivate')) {
    const p = await env.DB.prepare(
      `SELECT id FROM products WHERE id = ? AND developer_id = ?`
    ).bind(product_id, user.user_id).first();
    if (!p) return errorResponse('商品不存在', 404);
    const isActive = action === 'activate' ? 1 : 0;
    await env.DB.prepare(`UPDATE products SET is_active = ? WHERE id = ?`).bind(isActive, product_id).run();
    return jsonResponse({ success: true });
  }

  const {
    name,
    description = '',
    price,
    code_prefix = '',
    code_length = 16,
    code_charset = 'alphanumeric',
    auto_confirm_enabled = 0,
    callback_url = '',
    callback_secret = '',
    stock = 0,
    code_validity_days = null,
  } = body;

  if (!name || !price) return errorResponse('名称和价格必填', 400);

  // 自动回调发码属于 ShadeMark 平台统一订阅的 Pro 权益
  const tier = effectiveTier(user);
  const autoConfirm = canAutoConfirm(tier) ? (auto_confirm_enabled ? 1 : 0) : 0;
  const cbUrl = autoConfirm ? callback_url : '';
  const cbSecret = autoConfirm ? callback_secret : '';

  const id = crypto.randomUUID();
  const validityDays = code_validity_days != null && code_validity_days !== ''
    ? (parseInt(code_validity_days) > 0 ? parseInt(code_validity_days) : null)
    : null;
  await env.DB.prepare(
    `INSERT INTO products (id, developer_id, name, description, price, code_prefix, code_length, code_charset, auto_confirm_enabled, callback_url, callback_secret, stock, code_validity_days, is_active, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`
  ).bind(id, user.user_id, name, description, price * 100, code_prefix, code_length, code_charset, autoConfirm, cbUrl, cbSecret, stock, validityDays, Math.floor(Date.now() / 1000)).run();

  return jsonResponse({ id, tier, auto_confirm_enabled: autoConfirm }, 201);
}

export async function onRequestDelete(context: any): Promise<Response> {
  const { request, env } = context;
  const user = await requireAdmin(request, env);
  if (user instanceof Response) return user;

  const { searchParams } = new URL(request.url);
  const productId = searchParams.get('id');
  if (!productId) return errorResponse('缺少产品ID', 400);

  const product = await env.DB.prepare(
    `SELECT * FROM products WHERE id = ? AND developer_id = ?`
  ).bind(productId, user.user_id).first<any>();

  if (!product) return errorResponse('商品不存在', 404);

  // 删除校验：存在未完成订单(pending/paid/delivered)或未销完的码(unused/sold/active)时禁止物理删除
  const activeOrder = await env.DB.prepare(
    `SELECT id FROM orders WHERE product_id = ? AND status IN ('pending','paid','delivered') LIMIT 1`
  ).bind(productId).first();
  if (activeOrder) {
    return errorResponse('该商品下存在未完成订单或未使用的激活码，无法删除。可先下架商品。', 400);
  }

  const activeCode = await env.DB.prepare(
    `SELECT id FROM activation_codes WHERE product_id = ? AND status IN ('unused','sold','active') LIMIT 1`
  ).bind(productId).first();
  if (activeCode) {
    return errorResponse('该商品下存在未完成订单或未使用的激活码，无法删除。可先下架商品。', 400);
  }

  // 删除该商品下已作废的激活码 + 历史订单 + 商品本身
  await env.DB.prepare(`DELETE FROM activation_codes WHERE product_id = ?`).bind(productId).run();
  await env.DB.prepare(`DELETE FROM orders WHERE product_id = ?`).bind(productId).run();
  await env.DB.prepare(`DELETE FROM products WHERE id = ?`).bind(productId).run();

  return jsonResponse({ success: true });
}
