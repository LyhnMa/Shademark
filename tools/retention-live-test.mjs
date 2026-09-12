/**
 * 真实实测：调用生产 /api/internal/cleanup，看已降级 ever_pro 账号的 45 天前订单
 * 是否被保留（走 90 天档），纯 Free 账号的同样订单是否被删（走 30 天档）。
 */
import { execFileSync } from 'node:child_process';
const SECRET = '5d81dfb1fe0df802b01e161f5c1905e0685c16cc16aca551';
const ORIGIN = 'https://shademark.cn';
const WRANGLER = 'C:/Users/87882/AppData/Local/npm-cache/_npx/32026684e21afda6/node_modules/wrangler/bin/wrangler.js';

function d1(sql) {
  try {
    const out = execFileSync(process.execPath, [WRANGLER, 'd1', 'execute', 'shademark', '--remote', '--command', sql, '--json'], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
    const i = out.indexOf('[');
    const parsed = JSON.parse(out.slice(i));
    return parsed[0]?.results || [];
  } catch (e) {
    return [{ ERR: (e.stdout || '') + (e.stderr || '') }];
  }
}

console.log('--- 清理前订单状态 ---');
for (const r of d1(`SELECT o.id, u.id AS uid, u.ever_pro, u.subscription_tier AS tier FROM orders o JOIN products p ON o.product_id=p.id JOIN users u ON p.developer_id=u.id WHERE o.id LIKE 'rt_or_%' ORDER BY o.id`)) {
  console.log(JSON.stringify(r));
}

// 触发真实清理
let res;
try {
  res = await fetch(`${ORIGIN}/api/internal/cleanup`, { method: 'POST', headers: { 'X-Cron-Auth': SECRET } });
  console.log('清理端点返回:', res.status, await res.text());
} catch (e) {
  console.log('清理端点调用失败:', e.message);
}

console.log('--- 清理后订单存活状态 ---');
for (const r of d1(`SELECT o.id, u.id AS uid, u.ever_pro, u.subscription_tier AS tier FROM orders o JOIN products p ON o.product_id=p.id JOIN users u ON p.developer_id=u.id WHERE o.id LIKE 'rt_or_%' ORDER BY o.id`)) {
  console.log(JSON.stringify(r));
}
