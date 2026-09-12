import type { Env } from '../../lib/db';
import { jsonResponse, errorResponse } from '../../lib/db';
import { requireAdmin } from '../../lib/auth';
import { confirmOrder, cancelOrder, refundOrder, getOrders } from '../../lib/orders';

export async function onRequestGet(context: any): Promise<Response> {
  const { request, env } = context;
  const user = await requireAdmin(request, env);
  if (user instanceof Response) return user;

  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status') || undefined;
  const product_id = searchParams.get('product_id') || undefined;

  const orders = await getOrders(env.DB, user.user_id, status, product_id);
  return jsonResponse({ orders: orders.results });
}

export async function onRequestPost(context: any): Promise<Response> {
  const { request, env } = context;
  const user = await requireAdmin(request, env);
  if (user instanceof Response) return user;

  const body = await request.json<any>().catch(() => ({}));
  const { order_id, action } = body;

  if (!order_id || !action) return errorResponse('缺少必要参数', 400);

  if (action === 'confirm') {
    const result = await confirmOrder(env.DB, order_id, user.user_id);
    if (!result.success) return errorResponse(result.error || '确认失败', 400);
    return jsonResponse({ success: true, code: result.code });
  }

  if (action === 'cancel') {
    const result = await cancelOrder(env.DB, order_id, user.user_id);
    if (!result.success) return errorResponse(result.error || '取消失败', 400);
    return jsonResponse({ success: true });
  }

  if (action === 'refund') {
    const result = await refundOrder(env.DB, order_id, user.user_id);
    if (!result.success) return errorResponse(result.error || '退款失败', 400);
    return jsonResponse({ success: true });
  }

  return errorResponse('未知操作', 400);
}
