/**
 * 验证：报价单顶栏登录按钮 + 登录弹窗 是否与首页同款（真实浏览器断言）
 * 用法：node tools/cdp-verify-quote-auth.mjs
 */
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 9341;
const BASE = 'https://shademark.cn';
const OUT = 'docs/screenshots/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const child = spawn(EDGE, [
  `--remote-debugging-port=${PORT}`, '--headless=new', '--disable-gpu', '--hide-scrollbars',
  '--no-first-run', '--no-default-browser-check',
  `--user-data-dir=C:/temp/sdm-qa-${Date.now()}`, '--window-size=1000,880', 'about:blank',
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
const ev = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, userGesture: true })).result?.result?.value;
const shot = async (name) => { const s = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(OUT + name, Buffer.from(s.result.data, 'base64')); };

await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1000, height: 880, deviceScaleFactor: 1, mobile: false });

const results = [];
const check = (name, pass, info = '') => results.push({ name, pass, info });

async function goto(url) {
  await send('Page.navigate', { url });
  for (let i = 0; i < 120; i++) { await sleep(150); try { if (await ev('document.readyState') === 'complete') break; } catch {} }
  await sleep(1000);
}
const VIS = (id) => `(()=>{const b=document.getElementById('${id}');if(!b)return false;const r=b.getBoundingClientRect();return b.offsetParent!==null&&r.height>0})()`;
async function waitVisible(id, tries = 40) {
  for (let i = 0; i < tries; i++) { if (await ev(VIS(id))) return true; await sleep(250); }
  return false;
}
const METRICS = (id) => `(()=>{const b=document.getElementById('${id}');if(!b)return null;const c=getComputedStyle(b);const r=b.getBoundingClientRect();return{cls:b.className,bg:c.backgroundColor,color:c.color,radius:c.borderRadius,pad:c.padding,h:Math.round(r.height),w:Math.round(r.width),fw:c.fontWeight,fs:c.fontSize}})()`;

/* ---------- 1. 首页按钮基准 ---------- */
await goto(BASE + '/');
await waitVisible('navAuth');
const home = await ev(METRICS('navAuth'));
check('首页基准按钮 #navAuth 存在', !!home, JSON.stringify(home));

/* ---------- 2. 报价单按钮 ---------- */
await goto(BASE + '/quote');
const qVisible = await waitVisible('loginBtn');
check('报价单顶栏登录按钮可见（未登录态）', qVisible);
const quote = await ev(METRICS('loginBtn'));
check('报价单登录按钮属性存在', !!quote, JSON.stringify(quote));

if (home && quote) {
  const keys = ['bg', 'color', 'radius', 'pad', 'fw', 'fs'];
  const diff = keys.filter((k) => String(home[k]) !== String(quote[k]));
  check('按钮视觉规格与首页一致(底色/文字色/圆角/内边距/字重/字号)', diff.length === 0,
    diff.length ? diff.map((k) => `${k}: 首页=${home[k]} vs 报价单=${quote[k]}`).join(' | ') : `${keys.join(',')} 全同`);
  const hDiff = Math.abs(home.h - quote.h), wDiff = Math.abs(home.w - quote.w);
  check('按钮尺寸与首页完全相同（含 0px 容差）', hDiff === 0 && wDiff === 0,
    `首页 ${home.h}x${home.w} vs 报价单 ${quote.h}x${quote.w}（差 ${hDiff}x${wDiff}）`);
}

/* ---------- 3. 打开弹窗 ---------- */
await ev("document.getElementById('loginBtn').click()");
await sleep(700);
const maskOpen = await ev(`(()=>{const m=document.getElementById('authMask');const c=getComputedStyle(m);return{className:m.className,display:c.display,zIndex:c.zIndex,bg:c.backgroundColor}})()`);
check('弹窗打开（class=active, display=flex）', maskOpen.display === 'flex' && maskOpen.className.includes('active'), JSON.stringify(maskOpen));

const card = await ev(`(()=>{const c=document.querySelector('#authMask .modal-card');if(!c)return null;const s=getComputedStyle(c);const r=c.getBoundingClientRect();return{w:Math.round(r.width),bg:s.backgroundColor,radius:s.borderRadius,pad:s.padding,border:s.borderColor}})()`);
check('卡片为首页同款 .modal-card', !!card, JSON.stringify(card));

/* 首页弹窗卡片基准 */
await goto(BASE + '/');
await waitVisible('navAuth');
await ev("document.getElementById('navAuth').click()");
await sleep(600);
const homeCard = await ev(`(()=>{const c=document.querySelector('#authModal .modal-card');const s=getComputedStyle(c);const r=c.getBoundingClientRect();return{w:Math.round(r.width),bg:s.backgroundColor,radius:s.borderRadius,pad:s.padding,border:s.borderColor}})()`);
check('卡片属性与首页一致', JSON.stringify(card) === JSON.stringify(homeCard),
  `首页=${JSON.stringify(homeCard)} 报价单=${JSON.stringify(card)}`);

/* ---------- 4. 报价单弹窗内部结构 ---------- */
await goto(BASE + '/quote');
await waitVisible('loginBtn');
await ev("document.getElementById('loginBtn').click()");
await sleep(700);

const inner = await ev(`(()=>{
  const q=s=>document.querySelector('#authMask '+s);
  const card=document.querySelector('#authMask .modal-card');
  const submit=q('.auth-submit'), closeBtn=q('.modal-close'), forgot=document.getElementById('authForgot');
  const email=q('#authEmail'), tip=document.getElementById('authTip');
  const cr=card.getBoundingClientRect(), sr=submit.getBoundingClientRect();
  const cs=getComputedStyle(card);
  const contentW=card.clientWidth-parseFloat(cs.paddingLeft)-parseFloat(cs.paddingRight);
  const fw=getComputedStyle(forgot);
  return {
    hasCard:!!card, hasSubmit:!!submit, hasClose:!!closeBtn, hasTip:!!tip,
    hasOldCancel:!!document.querySelector('#authMask .sd-actions'),
    hasOldLabel:!!document.querySelector('#authMask .form-in'),
    submitFullWidth: Math.abs(sr.width-contentW)<1.5,
    submitBg:getComputedStyle(submit).backgroundColor,
    cardW:Math.round(cr.width), submitW:Math.round(sr.width),
    emailPlaceholder:email?email.placeholder:null,
    emailBg:email?getComputedStyle(email).backgroundColor:null,
    forgotVisible:fw.display!=='none' && forgot.getBoundingClientRect().height>0,
    forgotHref:forgot.querySelector('a').getAttribute('href'),
    tipText:tip?tip.textContent.trim():null,
    closeAria:closeBtn?closeBtn.getAttribute('aria-label'):null
  };
})()`);
check('结构：modal-card / 整宽 auth-submit / 右上 × 关闭', inner.hasCard && inner.hasSubmit && inner.hasClose);
check('主按钮整宽（与首页一致）', inner.submitFullWidth, `card=${inner.cardW} submit=${inner.submitW}`);
check('主按钮与首页同色 #7c6cf0', inner.submitBg === 'rgb(124, 108, 240)', inner.submitBg);
check('已移除旧的「取消」按钮与 label 布局', !inner.hasOldCancel && !inner.hasOldLabel);
check('输入框为 placeholder 形态且已 i18n 填充', inner.emailPlaceholder === '邮箱', `placeholder=${inner.emailPlaceholder} bg=${inner.emailBg}`);
check('「忘记密码？」在登录态可见 → /forgot', inner.forgotVisible && inner.forgotHref === '/forgot', `${inner.forgotHref}`);
check('底部提示行存在（首页同款）', !!inner.tipText, inner.tipText);
check('关闭按钮 aria-label 已 i18n', inner.closeAria === '关闭', inner.closeAria);

await shot('报价单登录弹窗-与首页同款.png');

/* ---------- 5. 切注册态 ---------- */
await ev("document.getElementById('tabReg').click()");
await sleep(500);
const reg = await ev(`(()=>{
  const forgot=document.getElementById('authForgot');
  return {
    forgotHidden:getComputedStyle(forgot).display==='none',
    nameWrap:document.getElementById('authNameWrap').style.display,
    contactWrap:document.getElementById('authContactWrap').style.display,
    submitText:document.getElementById('authSubmit').textContent.trim(),
    tip:document.getElementById('authTip').textContent.trim(),
    contactPh:document.getElementById('authContact').placeholder
  };
})()`);
check('注册态：忘记密码隐藏 / 昵称+联系方式出现 / 主按钮=注册',
  reg.forgotHidden && reg.nameWrap === 'block' && reg.contactWrap === 'block' && reg.submitText === '注册',
  JSON.stringify(reg));
await shot('报价单注册弹窗-与首页同款.png');

/* ---------- 6. 点「忘记密码」真跳转 ---------- */
await ev("document.getElementById('tabLogin').click()");
await sleep(300);
await ev("document.querySelector('#authForgot a').click()");
await sleep(1800);
const landed = await ev("location.pathname");
check('点击「忘记密码？」→ /forgot', landed === '/forgot', landed);

/* ---------- 7. 英文态 ---------- */
await ev("localStorage.setItem('shademark_quote_lang','en')");
await goto(BASE + '/quote');
await waitVisible('loginBtn');
await ev("setLang('en')");
await sleep(400);
await ev("document.getElementById('loginBtn').click()");
await sleep(700);
const en = await ev(`(()=>({
  ph:document.getElementById('authEmail').placeholder,
  forgot:document.querySelector('#authForgot a').textContent.trim(),
  tip:document.getElementById('authTip').textContent.trim(),
  submit:document.getElementById('authSubmit').textContent.trim(),
  closeAria:document.getElementById('authCloseBtn').getAttribute('aria-label')
}))()`);
check('英文态 i18n 生效', en.ph === 'Email' && en.forgot === 'Forgot password?' && en.submit === 'Login',
  JSON.stringify(en));
await shot('报价单登录弹窗-英文态.png');

/* ---------- 汇总 ---------- */
console.log('\n===== 报价单登录按钮/弹窗 对齐首页 验证 =====');
let pass = 0;
for (const r of results) { console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.info ? '  ' + r.info : ''}`); if (r.pass) pass++; }
console.log(`\n${pass}/${results.length} 通过`);

ws.close(); child.kill(); process.exit(pass === results.length ? 0 : 1);
