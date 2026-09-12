import type { Env } from '../lib/db';
import { getLinkBySlug, recordClick } from '../lib/links';
import { now } from '../lib/db';

function notFound(slug: string): Response {
  const html = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>链接不存在 — Shademark</title>
<link rel="icon" href="/logo.png" type="image/png">
<style>
:root{--bg:#0d0d0f;--card:#17171b;--border:#2a2a33;--text:#e8e8ea;--muted:#8a8a94;--accent:#7c6cf0}
*{margin:0;padding:0;box-sizing:border-box}
body{background:var(--bg);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px}
.box{max-width:440px;text-align:center}
img{width:32px;height:32px;border-radius:8px;margin-bottom:20px}
h1{font-size:20px;font-weight:700;margin-bottom:8px}
p{color:var(--muted);font-size:14px;line-height:1.6;margin-bottom:20px}
code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--accent)}
a{display:inline-block;padding:9px 18px;border:1px solid var(--border);border-radius:6px;color:var(--muted);text-decoration:none;font-size:13px;font-weight:600}
a:hover{color:var(--text);border-color:var(--accent)}
</style></head>
<body><div class="box">
<img src="/logo.png" alt="Shademark">
<h1>这个链接不可用</h1>
<p><code>/l/${slug}</code> 不存在、已被停用或已过期。</p>
<a href="/">返回 Shademark 主页</a>
</div></body></html>`;
  return new Response(html, { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

export async function onRequestGet(context: any): Promise<Response> {
  const { request, env, params, waitUntil } = context as {
    request: Request; env: Env; params: { slug: string }; waitUntil: (p: Promise<any>) => void;
  };

  const slug = (params.slug || '').trim();
  if (!slug) return notFound('');

  const link = await getLinkBySlug(env.DB, slug);
  if (!link || !link.is_active) return notFound(slug);
  if (link.expires_at && link.expires_at < now()) return notFound(slug);

  const country = (request as any).cf?.country || '';
  const pending = recordClick(env.DB, link, request, country).catch((e) => {
    console.error('[links] recordClick failed', e);
  });
  if (typeof waitUntil === 'function') waitUntil(pending);
  else await pending;

  // 302：每次点击都经过服务端，统计才准（301 会被浏览器缓存）
  return new Response(null, {
    status: 302,
    headers: {
      Location: link.target_url,
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'Referrer-Policy': 'no-referrer',
    },
  });
}
