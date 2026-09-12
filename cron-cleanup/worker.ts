/**
 * Shademark 定时任务 Cron Worker（两组件方案）
 * ----------------------------------------------
 * Cloudflare **Pages 不支持原生 cron triggers**，故用独立 Worker 承担调度：
 * 该 Worker 不共享 Pages 代码，只发带鉴权的 HTTP 回生产 Pages 的内部端点。
 *
 * 注册了两个 Cron Triggers（见 wrangler.cron.toml [triggers]）：
 *   0 * * * *   每小时  → POST /api/internal/cleanup    过期数据清理（free 30 天 / pro 90 天）
 *   0 3 * * *   每天    → POST /api/internal/downgrade  Pro 到期 + 3 天宽限后自动降级为 free
 *
 * 手动触发（任一 GET/POST 打到本 worker）会把上面两件事都跑一遍，便于验证。
 */
export interface Env {
  // 与 Pages 侧同源：CRON_SECRET 通过 secret 注入（不再写在 toml [vars]）
  CRON_SECRET: string;
  // Pages 生产域名（不带尾斜杠），如 https://shademark.pages.dev
  PAGES_ORIGIN: string;
}

const HOURLY = '0 * * * *';
const DAILY = '0 3 * * *';

export default {
  // 手动触发：GET/POST 任一打到本 worker 即跑一轮（清理 + 降级）
  async fetch(_request: Request, env: Env): Promise<Response> {
    const cleanup = await call(env, '/api/internal/cleanup');
    const downgrade = await call(env, '/api/internal/downgrade');
    return new Response(JSON.stringify({ success: true, trigger: 'manual', cleanup, downgrade }), {
      headers: { 'Content-Type': 'application/json' },
    });
  },

  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    const cron = event.cron;
    // 先 await 再返回，保证 worker 结束前任务跑完（便于 wrangler tail 观测）
    try {
      if (cron === DAILY) {
        const r = await call(env, '/api/internal/downgrade');
        console.log(`[cron] downgrade fired (${cron}): ${JSON.stringify(r)}`);
      } else if (cron === HOURLY) {
        const r = await call(env, '/api/internal/cleanup');
        console.log(`[cron] cleanup fired (${cron}): ${JSON.stringify(r)}`);
      } else {
        // 兜底：未知 cron 表达式也做完整一轮，避免漏跑
        const r = await call(env, '/api/internal/cleanup');
        console.log(`[cron] unknown schedule ${cron}, ran cleanup: ${JSON.stringify(r)}`);
      }
    } catch (err) {
      console.error(`[cron] ${cron} 失败`, err);
    }
  },
};

async function call(env: Env, path: string): Promise<any> {
  const base = (env.PAGES_ORIGIN || 'https://shademark.pages.dev').replace(/\/+$/, '');
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Cron-Auth': env.CRON_SECRET },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${path} responded ${res.status}: ${text}`);
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
