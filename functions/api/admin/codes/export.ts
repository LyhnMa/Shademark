import { errorResponse, jsonResponse } from '../../../lib/db';
import { requireAdmin } from '../../../lib/auth';
import { getAllCodes } from '../../../lib/codes';
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
  unused: '未售', sold: '已售', active: '已激活', revoked: '已作废',
};

// GET /api/admin/codes/export?product_id=&status= —— 导出当前筛选结果 CSV(UTF-8 BOM)
export async function onRequestGet(context: any): Promise<Response> {
  const { request, env } = context;
  const user = await requireAdmin(request, env);
  if (user instanceof Response) return user;

  // CSV 导出为 Pro 权益
  if ((await loadTier(env.DB, user.user_id)) !== 'pro') {
    return jsonResponse({ error: '激活码导出是 Pro 权益，升级后可用', code: 'pro_required' }, 403);
  }

  const { searchParams } = new URL(request.url);
  const product_id = searchParams.get('product_id') || undefined;
  const status = searchParams.get('status') || undefined;

  const { results } = await getAllCodes(env.DB, user.user_id, { product_id, status });

  const header = ['所属商品', '激活码', '状态', '生成时间', '生效时间', '有效期至', '关联订单号'];
  const rows = results.map((c: any) => [
    csvCell(c.product_name || ''),
    csvCell(c.code_value),
    csvCell(STATUS_CN[c.status] || c.status),
    csvCell(fmtTime(c.created_at)),
    csvCell(fmtTime(c.issued_at)),
    csvCell(fmtTime(c.expires_at)),
    csvCell(c.order_number || ''),
  ]);

  const bom = '\uFEFF';
  const body = bom + [header.map(csvCell).join(','), ...rows.map(r => r.join(','))].join('\n');
  const ts = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const filename = `activation_codes_${ts.getFullYear()}${pad(ts.getMonth() + 1)}${pad(ts.getDate())}_${pad(ts.getHours())}${pad(ts.getMinutes())}${pad(ts.getSeconds())}.csv`;

  return new Response(body, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}
