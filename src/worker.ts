import type { Env } from './lib/db';
import { cleanupExpiredData } from './lib/cleanup';

// Pages Functions 路由由 Cloudflare 自动处理
// 这里只做内部清理触发和 404 兜底
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // 内部清理 API（由 Cron Trigger 触发）
    if (url.pathname === '/api/internal/cleanup' && request.method === 'POST') {
      await cleanupExpiredData(env.DB);
      return new Response(JSON.stringify({ success: true }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // 其他请求交由 Pages Functions / 静态资产处理
    return new Response('Not Found', { status: 404 });
  },
};
