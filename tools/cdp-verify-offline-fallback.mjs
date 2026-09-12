/**
 * 验证：水印 / 压缩两页在「无后端」场景（本地 file:// 直接打开、离线）点击导航
 * 「发码 / 短链」时，不能因为新加的登录闸而卡住 —— 应保持原有「直接跳转」行为，
 * 且不弹登录框、不报 JS 错误。
 * 用法：node tools/cdp-verify-offline-fallback.mjs
 */
import { spawn } from 'node:child_process';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 9344;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PAGES = [
  ['watermark', 'file:///E:/Workbuddy/Shademark/public/watermark/index.html', '水印页'],
  ['compress', 'file:///E:/Workbuddy/Shademark/public/compress/index.html', '压缩页'],
];

const child = spawn(EDGE, [
  `--remote-debugging-port=${PORT}`, '--headless=new', '--disable-gpu', '--hide-scrollbars',
  '--no-first-run', '--no-default-browser-check', '--allow-file-access-from-files',
  `--user-data-dir=C:/temp/sdm-off-${Date.now()}`, '--window-size=1000,780', 'about:blank',
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
const pageErrors = [];
let lastNav = '';
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.method === 'Runtime.exceptionThrown') pageErrors.push(m.params?.exceptionDetails?.exception?.description || 'unknown');
  if (m.method === 'Network.requestWillBeSent' && m.params?.type === 'Document') lastNav = m.params.request.url;
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
};
const send = (method, params = {}) => new Promise((res) => { const i = ++mid; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, userGesture: true, awaitPromise: true })).result?.result?.value;

await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1000, height: 780, deviceScaleFactor: 1, mobile: false });

const results = [];
const check = (name, pass, info = '') => results.push({ name, pass, info });
async function goto(url) {
  await send('Page.navigate', { url });
  for (let i = 0; i < 120; i++) { await sleep(150); try { if (await ev('document.readyState') === 'complete') break; } catch {} }
  await sleep(1200);
}

for (const [, url, cn] of PAGES) {
  await goto(url);
  const gateCount = await ev(`document.querySelectorAll('.nav-tools a[data-gate]').length`);
  check(`${cn}（本地打开）导航闸已就位`, gateCount === 2, `data-gate 元素 ${gateCount} 个`);

  const before = await ev('location.href');
  lastNav = '';
  await ev(`document.querySelector('.nav-tools a[href="/admin"]').click()`);
  await sleep(1200);
  const after = await ev('location.href');
  const modalState = await ev(`(()=>{const m=document.getElementById('authModal');return m?m.className:'none'})()`);
  // 本地无后端时：fetch 失败 → 降级为「直接跳转」（原行为），不弹登录框
  check(`${cn}（本地打开）点「发码」→ 直接跳转、不弹框`,
    lastNav.indexOf('/admin') !== -1 && String(modalState).indexOf('active') === -1,
    `导航目标=${lastNav || '(无)'} modal=${modalState}`);
}

console.log('\n===== 离线/本地降级验证 =====');
let pass = 0;
for (const r of results) { console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.info ? '  ' + r.info : ''}`); if (r.pass) pass++; }
if (pageErrors.length) console.log('页面 JS 异常：', pageErrors.slice(0, 3).join(' | '));
else console.log('页面 JS 异常：无');
console.log(`\n${pass}/${results.length} 通过`);
ws.close(); child.kill();
process.exit(pass === results.length && pageErrors.length === 0 ? 0 : 1);
