import { jsonResponse } from '../../lib/db';
import { deleteSession } from '../../lib/auth';

// POST /api/auth/logout
export async function onRequestPost(context: any): Promise<Response> {
  const { request, env } = context;
  const cookie = request.headers.get('cookie') || '';
  const sessionToken = cookie.match(/session=([^;]+)/)?.[1];

  if (sessionToken) {
    await deleteSession(env.DB, sessionToken);
  }

  const response = jsonResponse({ success: true });
  response.headers.set('Set-Cookie', 'session=; HttpOnly; Path=/; SameSite=Strict; Max-Age=0');
  return response;
}
