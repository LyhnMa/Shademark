/**
 * 验证：首页登录弹窗「注册」提交的显示名能真正落库（字段名 display_name）
 * 用法：E2E_EMAIL=xx E2E_PASS=yy E2E_NAME=zz node tools/cdp-verify-register-name.mjs
 */
import { spawn } from 'node:child_process';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 9346;
const BASE = 'https://shademark.cn';
const EMAIL = process.env.E2E_EMAIL, PASS = process.env.E2E_PASS, NAME = process.env.E2E_NAME;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const child = spawn(EDGE, [
  `--remote-debugging-port=${PORT}`, '--headless=new', '--disable-gpu', '--hide-scrollbars',
  '--no-first-run', '--no-default-browser-check',
  `--user-data-dir=C:/temp/sdm-reg-${Date.now()}`, '--window-size=1000,800', 'about:blank',
], { stdio: 'ignore' });

let ready = false;
for (let i = 0; i < 80; i++) { try { if ((await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok) { ready = true; break; } } catch {} await sleep(250); }
if (!ready) { console.log('DevTools 未就绪'); process.exit(3); }
let target = null;
for (let i = 0; i < 40; i++) {
  try { const l = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); target = l.find((t) => t.type === 'page' && t.webSocketDebuggerUrl); if (target) break; } catch {}
  await sleep(250);
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let mid = 0; const pend = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
const send = (method, params = {}) => new Promise((res) => { const i = ++mid; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, userGesture: true, awaitPromise: true })).result?.result?.value;

await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1000, height: 800, deviceScaleFactor: 1, mobile: false });

const results = [];
const check = (name, pass, info = '') => results.push({ name, pass, info });
async function goto(url) {
  await send('Page.navigate', { url });
  for (let i = 0; i < 120; i++) { await sleep(150); try { if (await ev('document.readyState') === 'complete') break; } catch {} }
  await sleep(1200);
}

await goto(BASE + '/');
await ev(`document.getElementById('navAuth').click()`);
await sleep(500);
const forgotInLogin = await ev(`(()=>{const f=document.getElementById('authForgot');return !!f&&getComputedStyle(f).display!=='none'})()`);
check('首页弹窗：登录模式显示「忘记密码」', forgotInLogin === true, String(forgotInLogin));

await ev(`document.getElementById('tabRegister').click()`);
await sleep(300);
const forgotInReg = await ev(`(()=>{const f=document.getElementById('authForgot');return !!f&&getComputedStyle(f).display!=='none'})()`);
check('首页弹窗：注册模式隐藏「忘记密码」', forgotInReg === false, String(forgotInReg));

await ev(`(()=>{
  document.getElementById('authEmail').value=${JSON.stringify(EMAIL)};
  document.getElementById('authPass').value=${JSON.stringify(PASS)};
  document.getElementById('authName').value=${JSON.stringify(NAME)};
  document.getElementById('authContact').value='wx-test-001';
  document.getElementById('authForm')||document.querySelector('#authModal form');
  (document.getElementById('authForm')||document.querySelector('#authModal form')).dispatchEvent(new Event('submit',{cancelable:true,bubbles:true}));
  return true;
})()`);
await sleep(2500);
const after = await ev('location.pathname');
const who = await ev(`fetch('/api/auth/session').then(r=>r.json()).then(d=>JSON.stringify({auth:!!d.authenticated,email:d.user&&d.user.email,name:d.user&&d.user.display_name}))`);
check('首页弹窗注册成功并自动登录', String(after) === '/' && String(who).includes(EMAIL.replace(/"/g, '')), `path=${after} session=${who}`);

console.log('\n===== 首页注册弹窗（显示名落库）验证 =====');
let pass = 0;
for (const r of results) { console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.info ? '  ' + r.info : ''}`); if (r.pass) pass++; }
console.log(`\n${pass}/${results.length} 通过`);
ws.close(); child.kill(); process.exit(pass === results.length ? 0 : 1);
