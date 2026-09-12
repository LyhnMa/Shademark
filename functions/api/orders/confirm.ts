import type { Env } from '../../lib/db';
import { jsonResponse, errorResponse } from '../../lib/db';
import { requireAPIKey, verifySignature } from '../../lib/auth';
import { confirmOrder } from '../../lib/orders';
import { effectiveTier } from '../../lib/subscription';

export async function onRequestPost(context: any): Promise<Response> {
  const { request, env } = context;
  const { key, response } = await requireAPIKey(request, env);
  if (response) return response;

  // HMAC 签名验证
  const timestamp = request.headers.get('X-Timestamp');
  const signature = request.headers.get('X-Signature');
  const bodyText = await request.text();

  if (!timestamp || !signature) {
    return errorResponse('缺少签名头', 401);
  }

  const valid = verifySignature(key.secret, signature, parseInt(timestamp), bodyText);
  if (!valid) {
    return errorResponse('签名验证失败', 401);
  }

  const body = JSON.parse(bodyText);
  const { order_id } = body;

  if (!order_id) return errorResponse('缺少订单ID', 400);

  // —— 自动回调双重校验（仅此回调端点；后台手动确认不受影响）——
  // 校验一：商品必须开启自动确认
  const order = await env.DB.prepare(
    `SELECT product_id FROM orders WHERE id = ?`
  ).bind(order_id).first<{ product_id: string }>();
  if (!order) return errorResponse('订单不存在', 404);

  const product = await env.DB.prepare(
    `SELECT developer_id, auto_confirm_enabled FROM products WHERE id = ?`
  ).bind(order.product_id).first<{ developer_id: string; auto_confirm_enabled: number }>();
  if (!product) return errorResponse('商品不存在', 404);

  if (product.auto_confirm_enabled !== 1) {
    return jsonResponse({ error: '商品未开启自动确认，请使用手动确认', code: 'auto_confirm_disabled' }, 403);
  }

  // 校验二：开发者必须是 Pro 且未过期
  const dev = await env.DB.prepare(
    `SELECT subscription_tier, subscription_expires_at FROM users WHERE id = ?`
  ).bind(product.developer_id).first<{ subscription_tier: string | null; subscription_expires_at: number | null }>();
  if (effectiveTier(dev) !== 'pro') {
    return jsonResponse({ error: '自动回调发码是 Pro 权益，升级后可用', code: 'pro_required' }, 403);
  }

  const result = await confirmOrder(env.DB, order_id);
  if (!result.success) return errorResponse(result.error || '确认失败', 400);

  return jsonResponse({ success: true, code: result.code });
}
