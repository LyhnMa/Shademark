// 权益展示对齐验证 v2（本轮改动）：
//   1) 短链页 /links 权益块两行（Free/Pro/宽限/超额）
//   2) 发码页 /admin 权益块两行（Free/Pro/宽限/接近上限/超额）+ 侧栏无「联系」+ 主界面无 subBar
//   3) 订阅页 /admin?sub=1 对比表两列（Free/Pro 都显示）+ 无当前套餐 + 联系平台方一次
//   4) 主页 / 右上角邮箱+徽章+菜单
//   5) 报价单 /quote 右上角邮箱+徽章+菜单
// 用法：node tools/cdp-verify-rights2.mjs
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 9452;
const SITE = 'https://shademark.cn';
const OUT = 'E:/Workbuddy/Shademark/tools/shots/';
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const child = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-first-run', '--hide-scrollbars',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=C:/temp/cdp-rights2-${Date.now()}`, 'about:blank'], { stdio: 'ignore' });

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
  for (let i = 0; i < 160; i++) { try { if (await ev('document.readyState') === 'complete') break; } catch {} await sleep(150); }
  await sleep(1800);
}
async function shot(name) {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(OUT + name, Buffer.from(r.data, 'base64'));
}
async function setSession(token) {
  await send('Network.setCookie', { name: 'session', value: token, domain: 'shademark.cn', path: '/', secure: true, httpOnly: true });
}
const VIS = `const vis=el=>{if(!el)return false;const cs=getComputedStyle(el);if(cs.display==='none'||cs.visibility==='hidden'||Number(cs.opacity)===0)return false;const r=el.getBoundingClientRect();return r.width>0&&r.height>0};`;
const FOOT = `(()=>{const el=document.getElementById('planFoot');return {text:el?(el.innerText||'').replace(/\\s+/g,' ').trim():null,lines:el?[...el.querySelectorAll('.pf-line')].map(x=>(x.innerText||'').replace(/\\s+/g,' ').trim()):[],cls:el?el.className:null,visible:el?vis(el):false}})()`;
const NAV = `(()=>{${VIS}const u=document.getElementById('navUser');const acct=document.getElementById('navAcct');return {user:u?u.innerText.replace(/\\s+/g,' ').trim():null,acctVisible:vis(acct),hasBadge:!!(u&&u.querySelector('.badge'))}})()`;

await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
const results = {};

await send('Emulation.setDeviceMetricsOverride', { width: 1360, height: 900, deviceScaleFactor: 1, mobile: false });

/* ================= 短链页两行四态 ================= */
for (const [key, sess, file] of [
  ['linksFree', 'tst_sess_rfree', 'r2-links-free.png'],
  ['linksPro', 'tst_sess_rpro', 'r2-links-pro.png'],
  ['linksGrace', 'tst_sess_rgrace', 'r2-links-grace.png'],
  ['linksOver', 'tst_sess_rfree', 'r2-links-over.png'],
]) {
  await setSession(sess);
  await goto(SITE + '/links');
  results[key] = await ev(`(()=>{${VIS}const f=${FOOT};return f})()`);
  await shot(file);
}

/* ================= 发码页两行 + 清理 ================= */
for (const [key, sess, cnt, file] of [
  ['adminFree', 'tst_sess_rfree', 10, 'r2-admin-free.png'],
  ['adminPro', 'tst_sess_rpro', 10, 'r2-admin-pro.png'],
  ['adminGrace', 'tst_sess_rgrace', 10, 'r2-admin-grace.png'],
  ['adminNear', 'tst_sess_rfree', 82, 'r2-admin-near.png'],
  ['adminOver', 'tst_sess_rfree', 120, 'r2-admin-over.png'],
]) {
  await setSession(sess);
  await goto(SITE + '/admin');
  await ev(`(()=>{const it=[...document.querySelectorAll('.menu-item')].find(m=>m.dataset.section==='codes');if(it)it.click();})()`);
  await sleep(300);
  await ev(`(()=>{const c=document.getElementById('codeCount');c.value='${cnt}';c.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await sleep(200);
  results[key] = await ev(`(()=>{${VIS}const f=${FOOT};
    const sidebar=[...document.querySelectorAll('.sidebar .contact-item')].length;
    const subBar=document.getElementById('subBar');
    return {...f, sidebarContact:sidebar, subBarExists:!!subBar};})()`);
  await shot(file);
}

/* ================= 订阅页两列对比 ================= */
await send('Emulation.setDeviceMetricsOverride', { width: 1360, height: 1180, deviceScaleFactor: 1, mobile: false });
for (const [key, sess, file] of [
  ['subFree', 'tst_sess_rfree', 'r2-sub-free.png'],
  ['subPro', 'tst_sess_rpro', 'r2-sub-pro.png'],
  ['subGrace', 'tst_sess_rgrace', 'r2-sub-grace.png'],
  ['subDown', 'tst_sess_rdown', 'r2-sub-down.png'],
]) {
  await setSession(sess);
  await goto(SITE + '/admin?sub=1');
  results[key] = await ev(`(()=>{${VIS}
    const cmp=document.getElementById('subCompare');
    const cols=cmp?[...cmp.querySelectorAll('.sub-col')].map(c=>(c.innerText||'').replace(/\\s+/g,' ').trim()):[];
    const sec=document.getElementById('section-subscription');
    const txt=sec?(sec.innerText||''):'';
    return {
      compareVisible:vis(cmp),
      colCount:cmp?cmp.querySelectorAll('.sub-col').length:0,
      cols:cols,
      planCardExists:!!document.getElementById('subPlanCard'),
      subRightsExists:!!document.getElementById('subRightsList'),
      contactCount:txt.split('联系平台方').length-1,
      upgradeBtnVisible:!!(sec&&sec.querySelector('.sub-upgrade .btn')),
    };})()`);
  await shot(file);
}

/* ================= 主页右上角 ================= */
await send('Emulation.setDeviceMetricsOverride', { width: 1360, height: 900, deviceScaleFactor: 1, mobile: false });
for (const [key, sess, file] of [
  ['homeFree', 'tst_sess_rfree', 'r2-home-free.png'],
  ['homePro', 'tst_sess_rpro', 'r2-home-pro.png'],
]) {
  await setSession(sess);
  await goto(SITE + '/');
  results[key] = await ev(`(()=>{${VIS}const n=${NAV};return n})()`);
  await shot(file);
}

/* ================= 报价单右上角 ================= */
for (const [key, sess, file] of [
  ['quoteFree', 'tst_sess_rfree', 'r2-quote-free.png'],
  ['quotePro', 'tst_sess_rpro', 'r2-quote-pro.png'],
]) {
  await setSession(sess);
  await goto(SITE + '/quote');
  results[key] = await ev(`(()=>{${VIS}
    const u=document.getElementById('navUser');
    const acct=document.getElementById('navAcct');
    return {user:u?u.innerText.replace(/\\s+/g,' ').trim():null,acctVisible:vis(acct),hasBadge:!!(u&&u.querySelector('.badge')),loginBtnVisible:vis(document.getElementById('loginBtn'))};})()`);
  await shot(file);
}

results.pageExceptions = errs;
console.log(JSON.stringify(results, null, 2));
writeFileSync(OUT + 'rights2-result.json', JSON.stringify(results, null, 2));
ws.close(); child.kill();
