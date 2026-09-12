import { newId, now, jsonResponse, errorResponse } from '../lib/db';
import { getSession } from '../lib/auth';

// POST /api/contact —— 站内联系表单（无需登录；已登录则附带 user_id）
// body: { email, type: 'privacy'|'upgrade'|'technical'|'other', message }
const VALID_TYPES = ['privacy', 'upgrade', 'technical', 'other'];

export async function onRequestPost(context: any): Promise<Response> {
  const { request, env } = context;

  const body = await request.json<any>().catch(() => ({}));
  const contact = String(body.email || '').trim();   // 联系方式：邮箱或微信号（自由文本），不做邮箱格式强制
  const type = String(body.type || 'other').trim();
  const message = String(body.message || '').trim();

  // 校验：联系方式非空、长度
  if (!contact) return errorResponse('请填写联系方式（邮箱或微信号）', 400);
  if (contact.length > 200) return errorResponse('联系方式过长', 400);

  // 校验：type 合法
  if (!VALID_TYPES.includes(type)) return errorResponse('联系类型不合法', 400);

  // 校验：message 非空
  if (!message) return errorResponse('请填写留言内容', 400);
  if (message.length > 5000) return errorResponse('留言过长', 400);

  // 已登录则取 user_id（未登录置空）
  let userId: string | null = null;
  const cookie = request.headers.get('cookie') || '';
  const sessionToken = cookie.match(/session=([^;]+)/)?.[1];
  if (sessionToken) {
    const session = await getSession(env.DB, sessionToken);
    if (session) userId = session.user_id;
  }

  await env.DB.prepare(
    `INSERT INTO contact_messages (id, user_id, email, type, message, status, created_at)
     VALUES (?, ?, ?, ?, ?, 'unread', ?)`
  ).bind(newId(), userId, contact, type, message, now()).run();

  // 已登录用户：把最新「联系方式」同步回 users.contact（不同才更新，不覆盖 email）
  if (userId && contact) {
    const u = await env.DB.prepare(
      `SELECT contact FROM users WHERE id = ?`
    ).bind(userId).first<any>();
    const current = (u && u.contact) || '';
    if (current !== contact) {
      await env.DB.prepare(
        `UPDATE users SET contact = ? WHERE id = ?`
      ).bind(contact, userId).run();
    }
  }

  return jsonResponse({ success: true });
}
