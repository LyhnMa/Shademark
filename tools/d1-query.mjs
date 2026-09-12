/**
 * 便捷 D1 查询：逐条跑 SQL（绕开 D1 的 compound SELECT 上限与 PowerShell 的引号地狱）
 * 用法：node tools/d1-query.mjs "SELECT 1" "SELECT 2"
 * 输出：每条 SQL 一段，结果是紧凑 JSON
 */
import { execFileSync } from 'node:child_process';

const WRANGLER = 'C:/Users/87882/AppData/Local/npm-cache/_npx/32026684e21afda6/node_modules/wrangler/bin/wrangler.js';
const queries = process.argv.slice(2);

for (const sql of queries) {
  let out = '';
  try {
    out = execFileSync(process.execPath, [WRANGLER, 'd1', 'execute', 'shademark', '--remote', '--command', sql, '--json'], {
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
    });
  } catch (e) {
    out = (e.stdout || '') + (e.stderr || '');
  }
  const i = out.indexOf('[');
  let parsed = null;
  if (i >= 0) {
    try {
      parsed = JSON.parse(out.slice(i));
    } catch {}
  }
  console.log('### ' + sql.replace(/\s+/g, ' ').trim());
  if (!parsed) {
    console.log('  ERR ' + out.split('\n').filter(Boolean).slice(-4).join(' | '));
  } else {
    const rows = parsed[0]?.results || [];
    if (!rows.length) console.log('  (0 rows)');
    for (const r of rows) console.log('  ' + JSON.stringify(r));
  }
}
