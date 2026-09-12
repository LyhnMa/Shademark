import { jsonResponse, errorResponse } from '../../lib/db';
import { getOrderNumber } from '../../lib/orders';

// GET /api/orders/:number —— 买家凭订单号查询状态与激活码
export async function onRequestGet(context: any): Promise<Response> {
  const { env, params } = context;

  const orderNumber = decodeURIComponent(String(params?.number || ''));
  if (!orderNumber) return errorResponse('缺少订单号', 400);

  const order = await getOrderNumber(env.DB, orderNumber);
  if (!order) return errorResponse('订单不存在或订单号有误', 404);

  // 已发码的订单回传真实激活码 + 其状态与有效期
  let activation_code: string | null = null;
  let code_status: string | null = null;
  let expires_at: number | null = null;
  if (order.activation_code_id) {
    const code = await env.DB.prepare(
      `SELECT code_value, status, expires_at FROM activation_codes WHERE id = ?`
    ).bind(order.activation_code_id).first<any>();
    activation_code = code?.code_value || null;
    code_status = code?.status || null;
    expires_at = code?.expires_at ?? null;
  }

  return jsonResponse({
    order_number: order.order_number,
    product_name: order.product_name,
    status: order.status,
    amount: order.amount,
    buyer_email: order.buyer_email,
    created_at: order.created_at,
    paid_at: order.paid_at,
    delivered_at: order.delivered_at,
    activation_code,
    code_status,
    expires_at,
  });
}
