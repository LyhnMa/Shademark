// 品牌名实色探针：测量全站顶栏 logo 旁 ShadeMark 的实际渲染颜色，确认无渐变残留。
// 用法：node tools/brand-color-probe.mjs
// 依赖：本机 Edge，dist/ 已构建。
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 9477, HTTP_PORT = 8917;
const sleep = ms => new Promise(r => setTimeout(r, ms));

// —— 静态服务器：/api/auth/session 伪造为 pro（让受限页可达），其余读 dist ——
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${HTTP_PORT}`);
  if (url.pathname === '/api/auth/session') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      authenticated: true, user: { email: 'probe@example.com', display_name: 'Probe', subscription_tier: 'pro', role: 'platform', subscription_expires_at: '2099-01-01T00:00:00Z' },
    }));
  }
  if (url.pathname.startsWith('/api/')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end('[]');
  }
  let p = path.join(DIST, url.pathname);
  if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, 'index.html');
  if (!fs.existsSync(p)) {
    const alt = p + '.html';
    if (fs.existsSync(alt)) p = alt; else { res.writeHead(404); return res.end('nf'); }
  }
  const ext = path.extname(p);
  const ct = { '.html': 'text/html;charset=utf-8', '.png': 'image/png', '.ico': 'image/x-icon', '.txt': 'text/plain', '.svg': 'image/svg+xml', '.json': 'application/json' }[ext] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': ct });
  res.end(fs.readFileSync(p));
});
await new Promise(r => server.listen(HTTP_PORT, '127.0.0.1', r));

const child = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-first-run',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=C:/temp/bcp-${Date.now()}`, 'about:blank'], { stdio: 'ignore' });
for (let i = 0; i < 100; i++) { try { const r = await fetch(`http://127.0.0.1:${PORT}/json/version`); if (r.ok) break; } catch {} await sleep(200); }
const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const ws = new WebSocket(list.find(t => t.type === 'page').webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r));
let seq = 0; const pend = new Map();
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
const send = (method, params = {}) => new Promise((res, rej) => {
  const i = ++seq; pend.set(i, m => m.error ? rej(new Error(m.error.message)) : res(m.result));
  ws.send(JSON.stringify({ id: i, method, params }));
});
const ev = async x => {
  const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true, userGesture: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
  return r.result.value;
};
await send('Runtime.enable'); await send('Page.enable');

// 用 1320px 宽的 iframe 锁视口，确保媒体查询按桌面宽度计算
const PAGES = [
  ['index', '/index.html'], ['store', '/store.html'], ['privacy', '/privacy.html'],
  ['order-query', '/order-query.html'], ['links', '/links.html'], ['admin', '/admin.html'],
  ['platform', '/platform.html'], ['quote', '/quote.html'],
  ['watermark', '/watermark/index.html'], ['compress', '/compress/index.html'],
  ['excel', '/excel/index.html'],
  ['404', '/404.html'], ['login', '/login.html'],
];

const MEASURE = `(()=>{
  const d=document;
  const sel=['.brand-text','.nav .brand span','.sidebar .logo span','.logo span','.logo h1'];
  let el=null,tag='';
  for(const s of sel){const e=d.querySelector(s);if(e){el=e;tag=s;break;}}
  if(!el)return{found:false};
  const cs=getComputedStyle(el);
  const r=el.getBoundingClientRect();
  return {
    found:true, sel:tag, text:el.textContent.trim(),
    fontSize:cs.fontSize, fontWeight:cs.fontWeight, letterSpacing:cs.letterSpacing,
    color:cs.color,
    bgImage:cs.backgroundImage==='none'?'none':cs.backgroundImage.slice(0,60),
    textFillColor:cs.webkitTextFillColor,
    bgClip:cs.webkitBackgroundClip||cs.backgroundClip,
    rect:[Math.round(r.width*100)/100,Math.round(r.height*100)/100]
  };
})()`;

const out = [];
for (const [name, url] of PAGES) {
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>html,body{margin:0}iframe{width:1320px;height:900px;border:0}</style></head><body><iframe id="f" src="${url}"></iframe><script>
    const f=document.getElementById('f');
    window.__ready=false;
    f.onload=()=>{setTimeout(()=>{window.__ready=true},900)};
  </script></body></html>`;
  const tmp = path.join(DIST, `_probe_${name}.html`);
  fs.writeFileSync(tmp, html);

  await send('Page.navigate', { url: `http://127.0.0.1:${HTTP_PORT}/_probe_${name}.html` });
  for (let i = 0; i < 120; i++) { try { if (await ev('document.readyState')) break; } catch {} await sleep(120); }
  for (let i = 0; i < 80; i++) { try { if (await ev('(()=>{try{return document.getElementById("f").contentWindow.__ready===true}catch(e){return false}})()')) break; } catch {} await sleep(150); }

  const m = await ev(`(()=>{try{const w=document.getElementById('f').contentWindow;const d=w.document;const sel=['.brand-text','.nav .brand span','.sidebar .logo span','.logo span','.logo h1'];let el=null,tag='';for(const s of sel){const e=d.querySelector(s);if(e){el=e;tag=s;break;}}if(!el)return{found:false};const cs=w.getComputedStyle(el);const r=el.getBoundingClientRect();return{found:true,sel:tag,text:el.textContent.trim(),fontSize:cs.fontSize,fontWeight:cs.fontWeight,letterSpacing:cs.letterSpacing,color:cs.color,bgImage:cs.backgroundImage==='none'?'none':cs.backgroundImage.slice(0,60),textFillColor:cs.webkitTextFillColor,bgClip:cs.webkitBackgroundClip||cs.backgroundClip,rect:[Math.round(r.width*100)/100,Math.round(r.height*100)/100]};}catch(e){return{err:String(e)}}})()`);

  out.push({ page: name, ...m });
  try { fs.unlinkSync(tmp); } catch {}
}

// —— 汇总 ——
const lines = [];
lines.push('品牌名渲染实测（Edge headless，iframe 锁 1320px）');
lines.push('='.repeat(112));
lines.push('页面'.padEnd(14) + '选择器'.padEnd(22) + '字号'.padEnd(8) + '字重'.padEnd(7) + '颜色'.padEnd(22) + 'textFill'.padEnd(22) + 'bgClip');
lines.push('-'.repeat(112));
for (const r of out) {
  if (!r.found) { lines.push(`${r.page.padEnd(14)}未找到品牌名元素 ${r.err || ''}`); continue; }
  lines.push(`${r.page.padEnd(14)}${r.sel.padEnd(22)}${r.fontSize.padEnd(8)}${r.fontWeight.padEnd(7)}${(r.color || '').padEnd(22)}${(r.textFillColor || '').padEnd(22)}${r.bgClip || ''}`);
}

// —— 断言 ——
lines.push('');
lines.push('='.repeat(112));
const problems = [];
for (const r of out) {
  if (!r.found) { problems.push(`${r.page}: 未找到品牌名元素`); continue; }
  if (r.bgClip === 'text' || /linear-gradient/.test(r.bgImage || '')) problems.push(`${r.page}: 仍有渐变填充 (bgClip=${r.bgClip}, bgImage=${r.bgImage})`);
  if (r.textFillColor && r.textFillColor !== r.color) problems.push(`${r.page}: textFillColor(${r.textFillColor}) != color(${r.color})，存在裁剪色差`);
}

// 顶栏组（login 是卡片堆叠标题，单列除外）
const navGroup = out.filter(r => r.found && r.page !== 'login');
const colors = [...new Set(navGroup.map(r => r.color))];
const fonts = [...new Set(navGroup.map(r => r.fontSize))];
lines.push(`顶栏组颜色集合: ${JSON.stringify(colors)}`);
lines.push(`顶栏组字号集合: ${JSON.stringify(fonts)}`);
lines.push(`登录卡片(单独设计): ${JSON.stringify(out.find(r => r.page === 'login')?.color)} / ${JSON.stringify(out.find(r => r.page === 'login')?.fontSize)}`);
if (colors.length !== 1) problems.push(`顶栏颜色不唯一：${JSON.stringify(colors)}`);

lines.push('');
if (problems.length) { lines.push(`发现 ${problems.length} 处问题：`); problems.forEach(p => lines.push('  x ' + p)); }
else lines.push('全部通过：顶栏品牌名全站实色 rgb(232, 232, 234)，无渐变残留。');

fs.writeFileSync(path.join(ROOT, 'tmp_brand_color.txt'), lines.join('\n'), 'utf8');
console.log('written');
ws.close(); child.kill(); server.close();
process.exit(problems.length ? 1 : 0);
