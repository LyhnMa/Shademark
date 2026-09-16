// 线上复验：确认 shademark.cn 三页 .brand-text 已为实色（无渐变）
const SITE = 'https://shademark.cn';
const PAGES = ['/quote', '/watermark/', '/compress/', '/', '/links', '/admin'];
const cb = Date.now();

const out = [];
for (const p of PAGES) {
  const url = `${SITE}${p}${p.includes('?') ? '&' : '?'}cb=${cb}`;
  try {
    const r = await fetch(url, { headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' } });
    const html = await r.text();
    const m = html.match(/\.brand-text\{([^}]*)\}|\.brand span\{([^}]*)\}/);
    const rule = m ? (m[1] || m[2]) : '(未匹配)';
    const grad = /background-clip:\s*text|-webkit-text-fill-color:\s*transparent|linear-gradient/.test(rule);
    out.push({ page: p, status: r.status, gradient: grad, rule: rule.trim() });
  } catch (e) {
    out.push({ page: p, status: 'ERR', err: String(e).slice(0, 80), rule: '' });
  }
}

const L = [];
L.push('线上复验（shademark.cn，带 ?cb= 绕缓存）');
L.push('='.repeat(100));
for (const r of out) {
  L.push(`${r.page.padEnd(14)} ${String(r.status).padEnd(5)} 渐变=${r.gradient ? '是 ✗' : '否 ✓'}  ${r.rule}`);
}
const bad = out.filter(r => r.gradient || r.status !== 200);
L.push('');
L.push(bad.length ? `✗ ${bad.length} 页未通过` : '✓ 全部通过：线上顶栏品牌名为实色，无渐变残留');

const fs = await import('node:fs');
fs.writeFileSync('tmp_live_check.txt', L.join('\n'), 'utf8');
console.log(L.join('\n'));
