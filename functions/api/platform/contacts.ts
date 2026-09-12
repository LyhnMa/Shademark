import { jsonResponse } from '../../lib/db';
import { requirePlatform } from '../../lib/auth';

// GET /api/platform/contacts —— 全部联系消息（按时间倒序）
export async function onRequestGet(context: any): Promise<Response> {
  const { request, env } = context;
  const user = await requirePlatform(request, env);
  if (user instanceof Response) return user;

  const rows = await env.DB.prepare(
    `SELECT id, user_id, email, type, message, status, created_at
     FROM contact_messages
     ORDER BY created_at DESC
     LIMIT 500`
  ).all<any>();

  return jsonResponse({ contacts: (rows.results || []) });
}

// 未实现集合级 PATCH / DELETE；单条走 /contacts/:id
