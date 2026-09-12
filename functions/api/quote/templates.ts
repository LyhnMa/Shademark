import { jsonResponse, errorResponse } from '../../lib/db';
import { requireAdmin } from '../../lib/auth';
import {
  listQuoteTemplates, getQuoteTemplate, saveQuoteTemplate, deleteQuoteTemplate,
} from '../../lib/quote';

// GET /api/quote/templates —— 模板列表；带 ?id= 则返回单个模板完整内容
export async function onRequestGet(context: any): Promise<Response> {
  const { request, env } = context;
  const user = await requireAdmin(request, env);
  if (user instanceof Response) return user;

  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  if (id) {
    const t = await getQuoteTemplate(env.DB, user.user_id, id);
    if (!t) return errorResponse('模板不存在', 404);
    return jsonResponse({ template: t });
  }
  const templates = await listQuoteTemplates(env.DB, user.user_id);
  return jsonResponse({ templates });
}

// POST /api/quote/templates —— 保存/更新模板（需登录）
// body: { id?, name?, data, setLast? }  —— 有 id 则更新；无 id 则新建
export async function onRequestPost(context: any): Promise<Response> {
  const { request, env } = context;
  const user = await requireAdmin(request, env);
  if (user instanceof Response) return user;

  const body = await request.json<any>().catch(() => ({}));
  const result = await saveQuoteTemplate(env.DB, user.user_id, {
    id: body.id || undefined,
    name: body.name,
    data: body.data,
    setLast: body.setLast !== false,
  });
  if (!result.ok) {
    return jsonResponse({ error: result.error, code: result.code }, result.code === 'not_found' ? 404 : 400);
  }
  return jsonResponse({ ok: true, record: result.record }, result.id ? 200 : 201);
}

// DELETE /api/quote/templates —— 删除模板（需登录）
// body: { id } 或 query ?id=
export async function onRequestDelete(context: any): Promise<Response> {
  const { request, env } = context;
  const user = await requireAdmin(request, env);
  if (user instanceof Response) return user;
  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  if (!id) {
    const b = await request.json<any>().catch(() => ({}));
    if (!b.id) return errorResponse('缺少模板 id', 400);
  }
  const tid = id || ((await request.json<any>().catch(() => ({})))?.id);
  const ok = await deleteQuoteTemplate(env.DB, user.user_id, tid);
  if (!ok) return errorResponse('模板不存在', 404);
  return jsonResponse({ ok: true });
}
