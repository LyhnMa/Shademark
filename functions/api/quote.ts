import { jsonResponse, errorResponse } from '../lib/db';
import { requireAdmin } from '../lib/auth';
import {
  generateQuote, listQuoteHistory, listQuoteTemplates, getLastQuoteTemplate,
} from '../lib/quote';

// GET /api/quote —— 历史记录 + 模板列表 + 上次使用模板（需登录）
export async function onRequestGet(context: any): Promise<Response> {
  const { request, env } = context;
  const user = await requireAdmin(request, env);
  if (user instanceof Response) return user;

  const records = await listQuoteHistory(env.DB, user.user_id);
  const templates = await listQuoteTemplates(env.DB, user.user_id);
  const lastTemplate = await getLastQuoteTemplate(env.DB, user.user_id);
  return jsonResponse({ records, templates, lastTemplate });
}

// POST /api/quote —— 导出即生成：保存一份报价单到历史（需登录，无额度限制）
export async function onRequestPost(context: any): Promise<Response> {
  const { request, env } = context;
  const user = await requireAdmin(request, env);
  if (user instanceof Response) return user;

  const body = await request.json<any>().catch(() => ({}));
  const result = await generateQuote(env.DB, user.user_id, body);

  if (!result.ok) {
    return errorResponse(result.error || '生成失败', result.code === 'invalid' ? 400 : 500);
  }
  return jsonResponse({ ok: true, record: result.record }, 201);
}
