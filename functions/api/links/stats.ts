import { jsonResponse, errorResponse } from '../../lib/db';
import { requireAdmin } from '../../lib/auth';
import { linkStats, accountUsage } from '../../lib/links';
import { effectiveTier, linkRetentionDays, canExportCSV } from '../../lib/subscription';

function csvCell(v: any): string {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

// GET /api/links/stats —— 统计数据
// ?id=xxx            单条明细
// ?id=xxx&format=csv 导出 CSV（Pro 权益）
// 不带 id            返回全部链接的聚合概览
export async function onRequestGet(context: any): Promise<Response> {
  const { request, env } = context;
  const user = await requireAdmin(request, env);
  if (user instanceof Response) return user;

  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  const tier = effectiveTier(user);
  const retention = linkRetentionDays(tier);

  if (id) {
    if (searchParams.get('format') === 'csv') {
      if (!canExportCSV(tier)) {
        return errorResponse('CSV 导出是 Pro 权益，升级后可用', 403);
      }
      const link = await env.DB.prepare(
        `SELECT * FROM links WHERE id = ? AND developer_id = ?`
      ).bind(id, user.user_id).first<any>();
      if (!link) return errorResponse('链接不存在', 404);

      const stats = await linkStats(env.DB, id, retention);
      const rows = [
        ['时间(UTC)', '来源', '设备', '地区', 'Referer'],
        ...stats.recent.map((r: any) => [
          new Date(r.clicked_at * 1000).toISOString().replace('T', ' ').slice(0, 19),
          r.source, r.device, r.country || '', r.referer || '',
        ]),
      ];
      const csv = '\uFEFF' + rows.map(r => r.map(csvCell).join(',')).join('\r\n');
      return new Response(csv, {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="shademark-${link.slug}.csv"`,
          'Cache-Control': 'no-store',
        },
      });
    }

    const link = await env.DB.prepare(
      `SELECT * FROM links WHERE id = ? AND developer_id = ?`
    ).bind(id, user.user_id).first<any>();
    if (!link) return errorResponse('链接不存在', 404);
    return jsonResponse({
      link,
      stats: await linkStats(env.DB, id, retention),
      tier,
      retention_days: retention,
      can_export_csv: canExportCSV(tier),
    });
  }

  // 全量概览：每个链接的点击量 + 来源/设备总分布
  const links = await env.DB.prepare(
    `SELECT * FROM links WHERE developer_id = ? ORDER BY created_at DESC`
  ).bind(user.user_id).all<any>();
  const rows = links.results || [];

  const perLink: any[] = [];
  const sources = { direct: 0, social: 0, external: 0 };
  const devices = { mobile: 0, desktop: 0, other: 0 };
  let total = 0;

  for (const l of rows) {
    const s = await linkStats(env.DB, l.id, retention);
    perLink.push({
      id: l.id, slug: l.slug, target_url: l.target_url, is_active: l.is_active,
      created_at: l.created_at, total: s.total, trend: s.trend,
      sources: s.sources, devices: s.devices,
    });
    total += s.total;
    sources.direct += s.sources.direct;
    sources.social += s.sources.social;
    sources.external += s.sources.external;
    devices.mobile += s.devices.mobile;
    devices.desktop += s.devices.desktop;
    devices.other += s.devices.other;
  }

  return jsonResponse({
    overview: { links: rows.length, total, sources, devices },
    links: perLink,
    usage: await accountUsage(env.DB, user.user_id),
    tier,
    retention_days: retention,
    can_export_csv: canExportCSV(tier),
  });
}
