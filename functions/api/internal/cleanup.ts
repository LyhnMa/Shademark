import type { Env } from '../../lib/db';
import { cleanupExpiredData } from '../../lib/cleanup';

export async function onRequest(context: any): Promise<Response> {
  const { request, env } = context;
  // 内部调用鉴权：校验 X-Cron-Auth 请求头是否匹配 CRON_SECRET（与 cron worker 共享同值），防匿名触发
  const expected = (env as any).CRON_SECRET || '';
  const auth = request.headers.get('X-Cron-Auth') || '';
  if (!expected || auth !== expected) {
    return new Response(JSON.stringify({ error: 'forbidden' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  await cleanupExpiredData(env.DB);
  return new Response(JSON.stringify({ success: true }), {
    headers: { 'Content-Type': 'application/json' },
  });
}
