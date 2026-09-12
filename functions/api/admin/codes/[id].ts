import { jsonResponse, errorResponse } from '../../../lib/db';
import { requireAdmin } from '../../../lib/auth';

// 归属校验：该激活码必须属于当前开发者
async function ownedCode(env: any, codeId: string, developerId: string) {
  return env.DB.prepare(
    `SELECT c.id, c.product_id, c.code_value, c.status, c.expires_at, c.issued_at, c.created_at, c.used_at,
            p.name as product_name, o.order_number as order_number
     FROM activation_codes c
     JOIN products p ON c.product_id = p.id
     LEFT JOIN orders o ON c.order_id = o.id
     WHERE c.id = ? AND p.developer_id = ?`
  ).bind(codeId, developerId).first<any>();
}

// GET /api/admin/codes/:id —— 单个激活码完整信息（激活码详情弹窗用）
export async function onRequestGet(context: any): Promise<Response> {
  const { request, env, params } = context;
  const user = await requireAdmin(request, env);
  if (user instanceof Response) return user;

  const codeId = decodeURIComponent(String(params?.id || ''));
  const code = await ownedCode(env, codeId, user.user_id);
  if (!code) return errorResponse('激活码不存在', 404);

  return jsonResponse({ code });
}

// PATCH /api/admin/codes/:id  body { expires_at: 时间戳 或 null } —— 修改有效期
export async function onRequestPatch(context: any): Promise<Response> {
  const { request, env, params } = context;
  const user = await requireAdmin(request, env);
  if (user instanceof Response) return user;

  const codeId = decodeURIComponent(String(params?.id || ''));
  const code = await ownedCode(env, codeId, user.user_id);
  if (!code) return errorResponse('激活码不存在', 404);

  const body = await request.json<any>().catch(() => ({}));
  // expires_at: 允许为 null(永久) 或正整数时间戳
  const raw = body.expires_at;
  let expires_at: number | null = null;
  if (raw !== null && raw !== undefined && raw !== '') {
    expires_at = Math.floor(Number(raw));
    if (!Number.isFinite(expires_at) || expires_at <= 0) {
      return errorResponse('有效期格式不正确', 400);
    }
  }

  await env.DB.prepare(`UPDATE activation_codes SET expires_at = ? WHERE id = ?`)
    .bind(expires_at, codeId).run();

  return jsonResponse({ success: true, id: codeId, expires_at });
}
