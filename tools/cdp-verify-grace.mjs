// 验证：Pro 到期 / 宽限 / 降级在页面上的呈现（真实线上 + 真实测试会话 cookie）
//   /platform  到期提醒块 + 状态列 + 筛选
//   /admin     宽限期横幅（顶栏订阅条 + 订阅卡片）
//   /links     宽限期横幅
// 用法：node tools/cdp-verify-grace.mjs
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 9446;
const SITE = 'https://shademark.cn';
const OUT = 'E:/Workbuddy/Shademark/tools/shots/';
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const child = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-first-run', '--hide-scrollbars',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=C:/temp/cdp-grace-${Date.now()}`, 'about:blank'], { stdio: 'ignore' });

let ready = false;
for (let i = 0; i < 100; i++) {
  try { const r = await fetch(`http://127.0.0.1:${PORT}/json/version`); if (r.ok) { ready = true; break; } } catch {}
  await sleep(200);
}
if (!ready) { child.kill(); throw new Error('DevTools 端口未就绪'); }

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const target = list.find((t) => t.type === 'page');
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));

let seq = 0; const pend = new Map(); const errs = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails;
    errs.push((d.text || '') + ' :: ' + ((d.exception && d.exception.description) || ''));
  }
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
};
const send = (method, params = {}) => new Promise((res, rej) => {
  const i = ++seq; pend.set(i, (m) => (m.error ? rej(new Error(method + ': ' + m.error.message)) : res(m.result)));
  ws.send(JSON.stringify({ id: i, method, params }));
});
async function ev(expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true });
  if (r.exceptionDetails) throw new Error('evaluate 异常: ' + ((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text));
  return r.result.value;
}
async function goto(url) {
  await send('Page.navigate', { url });
  for (let i = 0; i < 140; i++) { try { if (await ev('document.readyState') === 'complete') break; } catch {} await sleep(150); }
  await sleep(1500);
}
async function shot(name) {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(OUT + name, Buffer.from(r.data, 'base64'));
}
async function setSession(token) {
  await send('Network.setCookie', { name: 'session', value: token, domain: 'shademark.cn', path: '/', secure: true, httpOnly: true });
}
const VIS = `const vis=el=>{if(!el)return false;const cs=getComputedStyle(el);if(cs.display==='none'||cs.visibility==='hidden'||Number(cs.opacity)===0)return false;const r=el.getBoundingClientRect();return r.width>0&&r.height>0};`;

await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1360, height: 940, deviceScaleFactor: 1, mobile: false });
const results = {};

/* ---------- 1) /platform：平台方视角（真实平台会话） ---------- */
await setSession('tst_sess_plat');
await goto(SITE + '/platform');
results.platform = await ev(`(()=>{${VIS}
  const box=document.getElementById('attnBox');
  const rows=[...document.querySelectorAll('#attnBox .attn-row')].map(r=>r.textContent.replace(/\\s+/g,' ').trim());
  const badges=[...document.querySelectorAll('#userTable .badge')].map(b=>b.textContent.trim());
  const cnt=t=>badges.filter(x=>x===t).length;
  const sel=document.getElementById('tierFilter');
  return {
    denied: document.body.innerText.includes('没有平台管理权限'),
    attnVisible: vis(box),
    attnHead: (document.querySelector('#attnBox .attn-head')||{}).textContent||'',
    attnRows: rows,
    badgeGrace: cnt('宽限期中'), badgeExpiring: cnt('即将到期'), badgeDowngraded: cnt('已降级'), badgePro: cnt('Pro'),
    filterOptions: sel?[...sel.options].map(o=>o.value):null,
    hintHas3Days: (document.body.innerText||'').includes('3 天宽限期'),
    tableTextHasGrace: (document.getElementById('userTable').innerText||'').includes('宽限剩 1 天')
  };
})()`);
await shot('platform-grace.png');

/* ---------- 2) /platform 筛选「宽限期中」 ---------- */
results.platformFilter = await ev(`(()=>{
  const sel=document.getElementById('tierFilter');sel.value='grace';sel.dispatchEvent(new Event('change'));
  const t=document.getElementById('userTable');
  return { rows:t.querySelectorAll('tr').length, text:t.innerText.replace(/\\s+/g,' ').trim().slice(0,120) };
})()`);
await ev(`(()=>{const s=document.getElementById('tierFilter');s.value='';s.dispatchEvent(new Event('change'))})()`);

/* ---------- 3) /admin：宽限期用户视角 ---------- */
await setSession('tst_sess_grace');
await goto(SITE + '/admin');
results.admin = await ev(`(()=>{${VIS}
  const bar=document.getElementById('subBar');
  return {
    barVisible: vis(bar), barGraceClass: bar?bar.classList.contains('grace'):null,
    barText: bar?(bar.innerText||'').replace(/\\s+/g,' ').trim():'',
    renewClickable: !!(bar&&bar.querySelector('.renew')),
    autoCallbackLocked: !!document.getElementById('p_auto')&&document.getElementById('p_auto').disabled
  };
})()`);
await ev(`(()=>{const it=[...document.querySelectorAll('.menu-item')].find(m=>m.dataset.section==='subscription');if(it)it.click()})()`);
await sleep(400);
results.adminPlanCard = await ev(`(()=>({text:(document.getElementById('subPlanText')||{}).textContent||'',note:(document.getElementById('subPlanNote')||{}).textContent||''}))()`);
await shot('admin-grace.png');

/* ---------- 4) /links：宽限期横幅 ---------- */
await goto(SITE + '/links');
results.links = await ev(`(()=>{${VIS}
  const gb=document.getElementById('graceBar');
  return { visible: vis(gb), text: gb?(gb.innerText||'').replace(/\\s+/g,' ').trim():'' };
})()`);
await shot('links-grace.png');

results.pageExceptions = errs;
console.log(JSON.stringify(results, null, 2));
writeFileSync(OUT + 'grace-result.json', JSON.stringify(results, null, 2));
ws.close(); child.kill();
