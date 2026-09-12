import { downgradeExpiredPro } from '../../lib/subscription';

/**
 * 内部定时任务端点：把「Pro 且已超过 3 天宽限期」的账号自动降级为 free。
 * 由 cron-cleanup Worker（Cloudflare Cron Triggers）每天 03:00 UTC 调一次；
 * 也可手动 POST 触发（带 X-Cron-Auth）。降级只改 subscription_tier，不动用户数据。
 */
export async function onRequest(context: any): Promise<Response> {
  const { request, env } = context;
  const expected = (env as any).CRON_SECRET || '';
  const auth = request.headers.get('X-Cron-Auth') || '';
  if (!expected || auth !== expected) {
    return new Response(JSON.stringify({ error: 'forbidden' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  const result = await downgradeExpiredPro(env.DB);
  console.log(`[downgrade] 降级 ${result.downgraded} 个账号`);
  return new Response(JSON.stringify({ success: true, ...result }), {
    headers: { 'Content-Type': 'application/json' },
  });
}
