// 验证：报价单 navContact 位置 + 主页徽章显示
import { spawn } from 'node:child_process';
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 9457, SITE = 'https://shademark.cn';
const sleep = ms => new Promise(r => setTimeout(r, ms));

const child = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-first-run',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=C:/temp/cdp-v4-${Date.now()}`, 'about:blank'], { stdio: 'ignore' });

for (let i = 0; i < 100; i++) { try { const r = await fetch(`http://127.0.0.1:${PORT}/json/version`); if (r.ok) break; } catch {} await sleep(200); }
const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const ws = new WebSocket(list.find(t => t.type === 'page').webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r));
let seq = 0; const pend = new Map(); const errs = [];
ws.onmessage = e => {
  const m = JSON.parse(e.data);
  if (m.method === 'Runtime.exceptionThrown') errs.push(m.params.exceptionDetails.text);
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
};
const send = (method, params = {}) => new Promise((res, rej) => {
  const i = ++seq; pend.set(i, m => m.error ? rej(new Error(m.error.message)) : res(m.result));
  ws.send(JSON.stringify({ id: i, method, params }));
});
const ev = async x => { const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true, userGesture: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.text); return r.result.value; };
await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');

const result = {};
await send('Network.setCookie', { name: 'session', value: 'tst_sess_v4pro', domain: 'shademark.cn', path: '/', secure: true, httpOnly: true });

// 场景1：报价单 navContact 顺序（navContact 应在 navAcct 之后）
await send('Page.navigate', { url: SITE + '/quote' });
for (let i = 0; i < 160; i++) { try { if (await ev('document.readyState') === 'complete') break; } catch {} await sleep(150); }
await sleep(2000);
result.quote = await ev(`(()=>{
  const ta=document.querySelector('.top-actions');
  if(!ta)return {topActionsExists:false};
  const kids=[...ta.children].map(x=>x.id||x.className||x.tagName);
  const nc=document.getElementById('navContact');
  const na=document.getElementById('navAcct');
  const nu=document.getElementById('navUser');
  return {
    order:kids,
    navContactIndex:kids.findIndex(k=>k==='navContact'),
    navAcctIndex:kids.findIndex(k=>k==='navAcct'),
    navUserHtml:nu?nu.innerHTML:''
  };
})()`);

// 场景2：主页徽章显示
await send('Page.navigate', { url: SITE + '/' });
for (let i = 0; i < 160; i++) { try { if (await ev('document.readyState') === 'complete') break; } catch {} await sleep(150); }
await sleep(2000);
result.home = await ev(`(()=>{
  const nu=document.getElementById('navUser');
  const nc=document.getElementById('navContact');
  return {
    navUserHtml:nu?nu.innerHTML:'',
    hasBadge:nu?!!nu.querySelector('.badge'):false,
    badgeText:nu?nu.querySelector('.badge')?.innerText||'':'',
    navContactDisplay:nc?getComputedStyle(nc).display:'n/a'
  };
})()`);

result.pageExceptions = errs;
console.log(JSON.stringify(result, null, 2));
ws.close(); child.kill();
