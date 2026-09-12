import { errorResponse, jsonResponse } from '../../../lib/db';
import { requireAdmin } from '../../../lib/auth';
import { getOrders } from '../../../lib/orders';
import { loadTier } from '../../../lib/subscription';

function csvCell(v: any): string {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function fmtTime(ts: any): string {
  if (!ts) return '';
  return new Date(Number(ts) * 1000).toISOString().replace('T', ' ').slice(0, 19);
}
const STATUS_CN: Record<string, string> = {
  pending: '待支付', paid: '已支付', delivered: '已发码', cancelled: '已取消', refunded: '已退款',
};

// GET /api/admin/orders/export?status=&product_id= —— 导出订单 CSV(UTF-8 BOM)
export async function onRequestGet(context: any): Promise<Response> {
  const { request, env } = context;
  const user = await requireAdmin(request, env);
  if (user instanceof Response) return user;

  // CSV 导出为 Pro 权益
  if ((await loadTier(env.DB, user.user_id)) !== 'pro') {
    return jsonResponse({ error: '订单导出是 Pro 权益，升级后可用', code: 'pro_required' }, 403);
  }

  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status') || undefined;
  const product_id = searchParams.get('product_id') || undefined;

  const { results } = await getOrders(env.DB, user.user_id, status, product_id);

  const header = ['订单号', '商品名称', '买家备注', '金额', '状态', '激活码', '创建时间', '支付时间', '发码时间'];
  const rows = results.map((o: any) => [
    csvCell(o.order_number),
    csvCell(o.product_name || ''),
    csvCell(o.buyer_email || ''),
    csvCell((o.amount / 100).toFixed(2)),
    csvCell(STATUS_CN[o.status] || o.status),
    csvCell(o.code_value || ''),
    csvCell(fmtTime(o.created_at)),
    csvCell(fmtTime(o.paid_at)),
    csvCell(fmtTime(o.delivered_at)),
  ]);

  const bom = '\uFEFF';
  const body = bom + [header.map(csvCell).join(','), ...rows.map(r => r.join(','))].join('\n');
  const ts = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const filename = `orders_${ts.getFullYear()}${pad(ts.getMonth() + 1)}${pad(ts.getDate())}_${pad(ts.getHours())}${pad(ts.getMinutes())}${pad(ts.getSeconds())}.csv`;

  return new Response(body, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}
