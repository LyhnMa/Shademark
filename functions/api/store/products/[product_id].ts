import { jsonResponse, errorResponse } from '../../../lib/db';

// GET /api/store/products/:product_id —— 买家查询单个在售商品
export async function onRequestGet(context: any): Promise<Response> {
  const { env, params } = context;

  const productId = decodeURIComponent(String(params?.product_id || ''));
  if (!productId) return errorResponse('缺少商品ID', 400);

  const product = await env.DB.prepare(
    `SELECT id, developer_id, name, description, price, stock, auto_confirm_enabled, is_active, created_at
     FROM products WHERE id = ?`
  ).bind(productId).first<any>();

  if (!product) return errorResponse('商品不存在', 404);
  if (product.is_active !== 1) return errorResponse('商品已下架', 404);

  return jsonResponse({
    id: product.id,
    name: product.name,
    description: product.description,
    price: product.price,
    is_active: product.is_active,
    auto_confirm_enabled: product.auto_confirm_enabled,
  });
}
