/**
 * 真实浏览器端到端验证（System Edge + CDP，Node 内置 WebSocket，无需 Playwright）
 *
 * 用法：T_U=普通用户邮箱 T_P=平台账号邮箱 node tools/cdp-e2e.mjs
 * 覆盖：
 *   A 首页登录弹窗有「忘记密码」且可点跳 /forgot
 *   B 报价单登录弹窗同上
 *   C 未登录访问 /platform → 跳到 /login?next=/platform
 *   D 在 /platform 触发的登录 → 登录后落回 /platform（不是 /admin）
 *   E 无 next 时：普通用户 → /admin
 *   F 无 next 时：平台方 → /platform
 *   G 普通用户访问 /platform → 被挡（没有平台管理权限）
 */
import { spawn } from 'node:child_process';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 9333;
const BASE = 'https://shademark.cn';
const PW = 'testpass123';
const U = process.env.T_U || '';
const P = process.env.T_P || '';
if (!U || !P) { console.log('缺少 T_U / T_P'); process.exit(2); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function check(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail ?? ''}`);
}

const child = spawn(EDGE, [
  `--remote-debugging-port=${PORT}`,
  '--headless=new',
  '--disable-gpu',
  '--no-first-run',
  '--no-default-browser-check',
  `--user-data-dir=C:/temp/sdm-cdp-${Date.now()}`,
  'about:blank',
], { stdio: 'ignore', detached: false });

let ver = null;
for (let i = 0; i < 80; i++) {
  try { const r = await fetch(`http://127.0.0.1:${PORT}/json/version`); if (r.ok) { ver = await r.json(); break; } } catch {}
  await sleep(250);
}
if (!ver) { console.log('Edge DevTools 未就绪'); process.exit(3); }

let target = null;
for (let i = 0; i < 40; i++) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    target = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
    if (target) break;
  } catch {}
  await sleep(250);
}
if (!target) { console.log('拿不到 page target'); process.exit(4); }

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let mid = 0; const pend = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
const send = (method, params = {}) => new Promise((res) => { const i = ++mid; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });

async function ev(expr, awaitPromise = false) {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise, returnByValue: true, userGesture: true });
  if (r.result && r.result.exceptionDetails) throw new Error('JS 异常: ' + JSON.stringify(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text));
  return r.result?.result?.value;
}
async function nav(url) {
  await send('Page.navigate', { url });
  for (let i = 0; i < 100; i++) { await sleep(150); try { if (await ev('document.readyState') === 'complete') break; } catch {} }
  await sleep(700);
}
async function clearCookies() { await send('Network.enable'); await send('Network.clearBrowserCookies'); }

try {
  await send('Page.enable');
  await send('Runtime.enable');

  /* ---------- A 首页弹窗 ---------- */
  await nav(BASE + '/');
  await ev(`document.getElementById('navAuth').click()`);
  await sleep(400);
  const a = JSON.parse(await ev(`(()=>{
    const a=document.querySelector('#authModal .auth-forgot a');
    const box=a?a.getBoundingClientRect():null;
    return JSON.stringify({href:a?a.getAttribute('href'):null,text:a?a.textContent.trim():null,
      visible:!!(a&&a.offsetParent!==null&&box.height>0),
      under:!!(a&&a.closest('#authModal'))});
  })()`));
  check('A1 首页弹窗出现「忘记密码」', a.visible && a.href === '/forgot' && /忘记密码/.test(a.text || ''), JSON.stringify(a));
  await ev(`document.querySelector('#authModal .auth-forgot a').click()`);
  await sleep(2500);
  check('A2 点击后跳 /forgot', (await ev('location.pathname')) === '/forgot', 'pathname=' + (await ev('location.pathname')));

  /* ---------- B 报价单弹窗 ---------- */
  await nav(BASE + '/quote');
  await ev(`document.getElementById('loginBtn').click()`);
  await sleep(400);
  const b = JSON.parse(await ev(`(()=>{
    const a=document.querySelector('#authForgot a');
    const box=a?a.getBoundingClientRect():null;
    return JSON.stringify({href:a?a.getAttribute('href'):null,text:a?a.textContent.trim():null,
      visible:!!(a&&a.offsetParent!==null&&box.height>0),
      maskShown:document.getElementById('authMask').classList.contains('show')});
  })()`));
  check('B1 报价单弹窗出现「忘记密码」', b.maskShown && b.visible && b.href === '/forgot' && /忘记密码/.test(b.text || ''), JSON.stringify(b));
  await ev(`document.querySelector('#authForgot a').click()`);
  await sleep(2500);
  check('B2 点击后跳 /forgot', (await ev('location.pathname')) === '/forgot', 'pathname=' + (await ev('location.pathname')));

  /* ---------- C/D 未登录访问 /platform → next → 登录后回 /platform ---------- */
  await clearCookies();
  await nav(BASE + '/platform');
  await sleep(2000);
  const c = await ev('location.pathname + location.search');
  check('C  /platform 未登录带 next 跳登录页', c === '/login?next=/platform', '实际=' + c);
  await ev(`(()=>{document.getElementById('loginEmail').value=${JSON.stringify(U)};
    document.getElementById('loginPassword').value=${JSON.stringify(PW)};doLogin();return 1})()`);
  await sleep(3000);
  const d = await ev('location.pathname + location.search');
  check('D  登录后落回 /platform（不再是 /admin）', d === '/platform', '实际=' + d);
  const g = await ev(`document.body.innerText.includes('没有平台管理权限')`);
  check('G  普通用户访问 /platform 被挡', g === true, '页面含无权限提示=' + g);

  /* ---------- E 无 next：普通用户 → /admin ---------- */
  await clearCookies();
  await nav(BASE + '/login');
  await ev(`(()=>{document.getElementById('loginEmail').value=${JSON.stringify(U)};
    document.getElementById('loginPassword').value=${JSON.stringify(PW)};doLogin();return 1})()`);
  await sleep(3000);
  const e = await ev('location.pathname');
  check('E  普通用户无 next 登录 → /admin', e === '/admin', '实际=' + e);

  /* ---------- F 无 next：平台方 → /platform ---------- */
  await clearCookies();
  await nav(BASE + '/login');
  await ev(`(()=>{document.getElementById('loginEmail').value=${JSON.stringify(P)};
    document.getElementById('loginPassword').value=${JSON.stringify(PW)};doLogin();return 1})()`);
  await sleep(3000);
  const f = await ev('location.pathname');
  check('F  平台方无 next 登录 → /platform', f === '/platform', '实际=' + f);

} catch (err) {
  console.log('ERROR: ' + err.message);
} finally {
  const bad = results.filter((r) => !r.ok).length;
  console.log(`\n=== 汇总：${results.length - bad}/${results.length} 通过 ===`);
  try { ws.close(); } catch {}
  try { child.kill(); } catch {}
  process.exit(bad ? 1 : 0);
}
