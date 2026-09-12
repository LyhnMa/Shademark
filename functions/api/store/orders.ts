import type { Env } from '../../lib/db';
import { jsonResponse, errorResponse } from '../../lib/db';
import { createOrder } from '../../lib/orders';

export async function onRequestPost(context: any): Promise<Response> {
  const { request, env } = context;
  const body = await request.json<any>().catch(() => ({}));
  const { product_id, buyer_email } = body;

  if (!product_id) return errorResponse('缺少商品ID', 400);

  const product = await env.DB.prepare(
    `SELECT * FROM products WHERE id = ? AND is_active = 1`
  ).bind(product_id).first<any>();

  if (!product) return errorResponse('商品不存在或已下架', 404);

  const { id, order_number } = await createOrder(env.DB, product_id, buyer_email || '', product.price);

  return jsonResponse({ id, order_number, price: product.price, email: buyer_email }, 201);
}
