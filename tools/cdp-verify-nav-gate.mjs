/**
 * 验证：导航里「发码 / 短链」未登录时是否与其它登录入口一致（弹登录框而非跳整页登录）
 * 以及首页 CTA 按钮是否还有 UA 默认灰边
 * 用法：E2E_EMAIL=xx E2E_PASS=yy node tools/cdp-verify-nav-gate.mjs
 */
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 9342;
const BASE = 'https://shademark.cn';
const OUT = 'docs/screenshots/';
const EMAIL = process.env.E2E_EMAIL, PASS = process.env.E2E_PASS;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const child = spawn(EDGE, [
  `--remote-debugging-port=${PORT}`, '--headless=new', '--disable-gpu', '--hide-scrollbars',
  '--no-first-run', '--no-default-browser-check',
  `--user-data-dir=C:/temp/sdm-gate-${Date.now()}`, '--window-size=1000,780', 'about:blank',
], { stdio: 'ignore' });

let ok = false;
for (let i = 0; i < 80; i++) { try { if ((await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok) { ok = true; break; } } catch {} await sleep(250); }
if (!ok) { console.log('DevTools 未就绪'); process.exit(3); }
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
const shot = async (n) => { const s = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(OUT + n, Buffer.from(s.result.data, 'base64')); };

await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1000, height: 780, deviceScaleFactor: 1, mobile: false });

const results = [];
const check = (name, pass, info = '') => results.push({ name, pass, info });
async function goto(url) {
  await send('Page.navigate', { url });
  for (let i = 0; i < 120; i++) { await sleep(150); try { if (await ev('document.readyState') === 'complete') break; } catch {} }
  await sleep(1000);
}
const VIS = (id) => `(()=>{const b=document.getElementById('${id}');if(!b)return false;const r=b.getBoundingClientRect();return b.offsetParent!==null&&r.height>0})()`;
async function waitVis(id, tries = 40) { for (let i = 0; i < tries; i++) { if (await ev(VIS(id))) return true; await sleep(250); } return false; }
async function waitHidden(id, tries = 40) { for (let i = 0; i < tries; i++) { if (!(await ev(VIS(id)))) return true; await sleep(250); } return false; }
const modalOpen = (id) => `(()=>{const m=document.getElementById('${id}');return m?m.className+'|'+getComputedStyle(m).display:'none'})()`;

/* ---------- A. 首页 CTA 按钮边框 ---------- */
await goto(BASE + '/');
await waitVis('navAuth');
const cta = await ev(`(()=>{const b=document.getElementById('navAuth');const c=getComputedStyle(b);const r=b.getBoundingClientRect();return{bw:c.borderTopWidth+'/'+c.borderLeftWidth,bs:c.borderTopStyle,color:c.borderTopColor,h:Math.round(r.height),w:Math.round(r.width)}})()`);
check('首页 CTA 按钮无 UA 默认边框（上/左边框宽 0）', cta.bw === '0px/0px' && cta.bs === 'none', JSON.stringify(cta));

/* ---------- B. 首页导航「发码 / 短链」未登录 → 弹登录框 ---------- */
for (const [label, href] of [['发码', '/admin'], ['短链', '/links']]) {
  await goto(BASE + '/');
  await waitVis('navAuth');
  await ev(`document.querySelector('.nav-tools a[href="${href}"]').click()`);
  await sleep(600);
  const st = await ev(`location.pathname`);
  const mo = await ev(modalOpen('authModal'));
  check(`首页未登录点「${label}」→ 弹登录框且不跳转`, st === '/' && String(mo).includes('active') && String(mo).includes('flex'), `path=${st} modal=${mo}`);
  if (label === '发码') await shot('首页-未登录点发码-弹登录框.png');
}

/* ---------- C. 报价单导航「发码 / 短链」未登录 → 弹登录框 ---------- */
for (const [label, href] of [['发码', '/admin'], ['短链', '/links']]) {
  await goto(BASE + '/quote');
  await waitVis('loginBtn');
  await ev(`document.querySelector('.nav-tools a[href="${href}"]').click()`);
  await sleep(600);
  const st = await ev(`location.pathname`);
  const mo = await ev(modalOpen('authMask'));
  check(`报价单未登录点「${label}」→ 弹登录框且不跳转`, st === '/quote' && String(mo).includes('active') && String(mo).includes('flex'), `path=${st} modal=${mo}`);
  if (label === '发码') await shot('报价单-未登录点发码-弹登录框.png');
}

/* ---------- C2. 水印 / 压缩 导航「发码 / 短链」未登录 → 弹登录框 ---------- */
for (const [page, cn] of [['/watermark/', '水印页'], ['/compress/', '压缩页']]) {
  for (const [label, href] of [['发码', '/admin'], ['短链', '/links']]) {
    await goto(BASE + page);
    await sleep(800); // 等 checkAuth 完成
    await ev(`document.querySelector('.nav-tools a[href="${href}"]').click()`);
    await sleep(600);
    const st = await ev(`location.pathname`);
    const mo = await ev(modalOpen('authModal'));
    check(`${cn}未登录点「${label}」→ 弹登录框且不跳转`, st === page && String(mo).includes('active') && String(mo).includes('flex'), `path=${st} modal=${mo}`);
    if (label === '发码') await shot(`${cn}-未登录点发码-弹登录框.png`);
  }
}

/* ---------- C3. 水印/压缩弹窗视觉规格 vs 首页 ---------- */
const MSPEC = `(()=>{const c=document.querySelector('#authModal .modal-card');if(!c)return null;const s=getComputedStyle(c);const b=document.querySelector('#authModal .auth-submit');const bs=b?getComputedStyle(b):null;const f=document.querySelector('#authModal .auth-forgot');return{w:Math.round(c.getBoundingClientRect().width),bg:s.backgroundColor,radius:s.borderRadius,border:s.borderTopColor,pad:s.padding,btnBg:bs?bs.backgroundColor:null,btnRadius:bs?bs.borderRadius:null,forgotShown:!!f&&getComputedStyle(f).display!=='none'}})()`;
const SPEC_KEYS = ['w', 'bg', 'radius', 'border', 'pad', 'btnBg', 'btnRadius'];
{
  await goto(BASE + '/');
  await waitVis('navAuth');
  await ev(`document.getElementById('navAuth').click()`);
  await sleep(600);
  const home = await ev(MSPEC);
  check('首页弹窗基准可读', !!home, JSON.stringify(home));

  for (const [page, cn] of [['/watermark/', '水印页'], ['/compress/', '压缩页']]) {
    await goto(BASE + page);
    await sleep(800);
    await ev(`document.querySelector('.nav-tools a[href="/admin"]').click()`);
    await sleep(600);
    const m = await ev(MSPEC);
    if (!m) { check(`${cn}弹窗规格与首页一致`, false, '未取到弹窗'); continue; }
    const diff = SPEC_KEYS.filter((k) => String(home[k]) !== String(m[k]));
    check(`${cn}弹窗规格与首页一致（宽度/底色/圆角/边框/内距/按钮）`, diff.length === 0,
      diff.length ? diff.map((k) => `${k}: 首页=${home[k]} vs ${cn}=${m[k]}`).join(' | ') : SPEC_KEYS.join(',') + ' 全同');
    // 弹窗内「忘记密码」在登录模式可见
    await ev(`document.querySelector('#authModal #tabLogin').click()`);
    await sleep(300);
    const fsh = await ev(`(()=>{const f=document.getElementById('authForgot');if(!f)return 'none';const r=f.getBoundingClientRect();return getComputedStyle(f).display!=='none'&&f.offsetParent!==null&&r.height>0})()`);
    check(`${cn}弹窗登录模式下「忘记密码」可见`, fsh === true, String(fsh));
  }
}

/* ---------- D. 登录后点导航应直接进（不被拦） ---------- */
if (EMAIL && PASS) {
  await goto(BASE + '/');
  const login = await ev(`fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:${JSON.stringify(EMAIL)},password:${JSON.stringify(PASS)}})}).then(r=>r.json())`);
  check('临时账号登录成功', !!(login && login.success), JSON.stringify(login));
  await goto(BASE + '/');
  await waitHidden('navAuth');
  await ev(`document.querySelector('.nav-tools a[href="/admin"]').click()`);
  await sleep(1600);
  const p1 = await ev('location.pathname');
  check('登录后首页点「发码」→ 直接进 /admin（不再弹框）', p1 === '/admin', p1);

  await goto(BASE + '/quote');
  await waitVis('userChip');
  await ev(`document.querySelector('.nav-tools a[href="/links"]').click()`);
  await sleep(1600);
  const p2 = await ev('location.pathname');
  check('登录后报价单点「短链」→ 直接进 /links', p2 === '/links', p2);

  await goto(BASE + '/watermark/');
  await sleep(800);
  await ev(`document.querySelector('.nav-tools a[href="/admin"]').click()`);
  await sleep(1600);
  const p3 = await ev('location.pathname');
  check('登录后水印页点「发码」→ 直接进 /admin', p3 === '/admin', p3);

  await goto(BASE + '/compress/');
  await sleep(800);
  await ev(`document.querySelector('.nav-tools a[href="/links"]').click()`);
  await sleep(1600);
  const p4 = await ev('location.pathname');
  check('登录后压缩页点「短链」→ 直接进 /links', p4 === '/links', p4);
}

console.log('\n===== 导航登录闸 + CTA 边框 验证 =====');
let pass = 0;
for (const r of results) { console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.info ? '  ' + r.info : ''}`); if (r.pass) pass++; }
console.log(`\n${pass}/${results.length} 通过`);
ws.close(); child.kill(); process.exit(pass === results.length ? 0 : 1);
