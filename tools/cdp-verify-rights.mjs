// 权益展示对齐验证（真实线上 + 真实测试会话 cookie）
//   短链页 /links  : Free / Pro / 超额 三态（角落那一行）
//   发码页 /admin  : Free / Pro / 接近上限 / 超额 四态（角落那一行）
//   订阅页 /admin?sub=1 : Free / Pro / 宽限 / 降级 四态（数字按实际生效窗口）
//   账号菜单入口
// 用法：node tools/cdp-verify-rights.mjs
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 9451;
const SITE = 'https://shademark.cn';
const OUT = 'E:/Workbuddy/Shademark/tools/shots/';
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const child = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-first-run', '--hide-scrollbars',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=C:/temp/cdp-rights-${Date.now()}`, 'about:blank'], { stdio: 'ignore' });

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
  await sleep(1600);
}
async function shot(name) {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(OUT + name, Buffer.from(r.data, 'base64'));
}
async function setSession(token) {
  await send('Network.setCookie', { name: 'session', value: token, domain: 'shademark.cn', path: '/', secure: true, httpOnly: true });
}
const VIS = `const vis=el=>{if(!el)return false;const cs=getComputedStyle(el);if(cs.display==='none'||cs.visibility==='hidden'||Number(cs.opacity)===0)return false;const r=el.getBoundingClientRect();return r.width>0&&r.height>0};`;
const FOOT = `(()=>{const el=document.getElementById('planFoot');return {text:el?(el.innerText||'').replace(/\\s+/g,' ').trim():null,cls:el?el.className:null,visible:el?vis(el):false}})()`;

async function viewport(w, h) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
}

await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
const results = {};

/* ================= 短链页三态 ================= */
await viewport(1360, 900);
for (const [key, sess, file] of [
  ['linksFree', 'tst_sess_free', 'rights-links-free.png'],
  ['linksPro', 'tst_sess_pro', 'rights-links-pro.png'],
  ['linksOver', 'tst_sess_over', 'rights-links-over.png'],
]) {
  await setSession(sess);
  await goto(SITE + '/links');
  results[key] = await ev(`(()=>{${VIS}
    const f=${FOOT};
    return {...f, csvBtnVisible:vis(document.getElementById('csvBtn')), tierBadge:!!document.getElementById('tierBadge'), usageCard:!!document.getElementById('usageText')};
  })()`);
  await shot(file);
}

/* ================= 发码页权益行四态 ================= */
for (const [key, sess, cnt, file] of [
  ['adminFree', 'tst_sess_free', 10, 'rights-admin-free.png'],
  ['adminPro', 'tst_sess_pro', 10, 'rights-admin-pro.png'],
  ['adminNear', 'tst_sess_free', 82, 'rights-admin-near.png'],
  ['adminOver', 'tst_sess_free', 120, 'rights-admin-over.png'],
]) {
  await setSession(sess);
  await goto(SITE + '/admin');
  await ev(`(()=>{const it=[...document.querySelectorAll('.menu-item')].find(m=>m.dataset.section==='codes');if(it)it.click();})()`);
  await sleep(300);
  await ev(`(()=>{const c=document.getElementById('codeCount');c.value='${cnt}';c.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await sleep(200);
  results[key] = await ev(`(()=>{${VIS}const f=${FOOT};return {...f,count:document.getElementById('codeCount').value,max:document.getElementById('codeCount').max}})()`);
  await shot(file);
}

/* ================= 订阅页四态 ================= */
await viewport(1360, 1180);
for (const [key, sess, file] of [
  ['subFree', 'tst_sess_free', 'rights-sub-free.png'],
  ['subPro', 'tst_sess_pro', 'rights-sub-pro.png'],
  ['subGrace', 'tst_sess_gra', 'rights-sub-grace.png'],
  ['subDown', 'tst_sess_down', 'rights-sub-down.png'],
]) {
  await setSession(sess);
  await goto(SITE + '/admin?sub=1');
  results[key] = await ev(`(()=>{${VIS}
    const g=[...document.querySelectorAll('#subRightsList .rights-group')].map(x=>(x.innerText||'').replace(/\\s+/g,' ').trim());
    return {
      plan:(document.getElementById('subPlanText')||{}).textContent||'',
      note:(document.getElementById('subPlanNote')||{}).textContent||'',
      noteCls:(document.getElementById('subPlanNote')||{}).className||'',
      rightsGroups:g,
      compareVisible:vis(document.getElementById('subCompare')),
      compareText:(document.getElementById('subCompare')||{}).innerText?document.getElementById('subCompare').innerText.replace(/\\s+/g,' ').trim():'',
      barText:(document.getElementById('subBar')||{}).innerText?document.getElementById('subBar').innerText.replace(/\\s+/g,' ').trim():'',
      contactCount:((document.getElementById('section-subscription')||{}).innerText||'').split('联系平台方').length-1
    };
  })()`);
  await shot(file);
}

/* ================= 从短链进来高亮短链栏 ================= */
await setSession('tst_sess_pro');
await goto(SITE + '/admin?sub=1&from=links');
results.subFromLinks = await ev(`(()=>{
  const hl=document.querySelector('#subRightsList .rights-group.hl');
  return {highlighted:hl?(hl.querySelector('.rg-name')||{}).textContent.trim():null,
          hlTool:hl?hl.className:null};
})()`);
await shot('rights-sub-from-links.png');

/* ================= 账号菜单入口 ================= */
await goto(SITE + '/admin');
await ev(`toggleAcct()`);
await sleep(300);
results.acctMenu = await ev(`(()=>{${VIS}
  const m=document.getElementById('acctMenu');
  return {visible:vis(m), items:m?[...m.querySelectorAll('a,button')].map(x=>x.textContent.trim()):[], expanded:document.getElementById('acctBtn').getAttribute('aria-expanded')};
})()`);
await shot('rights-acct-menu.png');

results.pageExceptions = errs;
console.log(JSON.stringify(results, null, 2));
writeFileSync(OUT + 'rights-result.json', JSON.stringify(results, null, 2));
ws.close(); child.kill();
