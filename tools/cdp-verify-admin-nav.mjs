// 验证：发码页(/admin)顶部导航与短链工具一致 + 左侧工具栏精简；
//       platform 页未登录登录弹窗与首页一致、去返回主页、退出按钮位置。
// 用法：node tools/cdp-verify-admin-nav.mjs
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 9444;
const BASE = 'file:///E:/Workbuddy/Shademark/src/pages/';
const OUT = 'E:/Workbuddy/Shademark/tools/shots/';
mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));

const child = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-first-run', '--hide-scrollbars',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=C:/temp/cdp-shd-${Date.now()}`,
  '--allow-file-access-from-files', 'about:blank'], { stdio: 'ignore' });

let ready = false;
for (let i = 0; i < 100; i++) {
  try { const r = await fetch(`http://127.0.0.1:${PORT}/json/version`); if (r.ok) { ready = true; break; } } catch (e) { }
  await sleep(200);
}
if (!ready) { child.kill(); throw new Error('DevTools 端口未就绪'); }

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const target = list.find(t => t.type === 'page');
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r));

let seq = 0; const pend = new Map(); const errs = [];
ws.onmessage = e => {
  const m = JSON.parse(e.data);
  if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails;
    errs.push(d.text + ' :: ' + ((d.exception && d.exception.description) || ''));
  }
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
};
const send = (method, params = {}) => new Promise((res, rej) => {
  const i = ++seq; pend.set(i, m => m.error ? rej(new Error(method + ': ' + m.error.message)) : res(m.result));
  ws.send(JSON.stringify({ id: i, method, params }));
});
async function ev(expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true });
  if (r.exceptionDetails) throw new Error('evaluate 异常: ' + ((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text));
  return r.result.value;
}
async function goto(url) {
  await send('Page.navigate', { url });
  for (let i = 0; i < 100; i++) { try { if (await ev('document.readyState') === 'complete') break; } catch (e) { } await sleep(150); }
  await sleep(500);
}
async function shot(name) {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(OUT + name, Buffer.from(r.data, 'base64'));
}

// 把 /api/** 全部打桩，页面以指定登录态渲染（file:// 下无后端）
const STUB = `(function(){
  const LOGGED={authenticated:true,user:{email:'mowl0311@163.com',display_name:'Mowl',role:'platform',subscription_tier:'pro'},subscription:{tier:'pro',expires_at:null,days_left:null,expired:false}};
  const ANON={authenticated:false};
  const canned={
    '/api/auth/session':function(){return location.hash==='#anon'?ANON:LOGGED},
    '/api/admin/products':function(){return {products:[]}},
    '/api/admin/codes':function(){return {codes:[]}},
    '/api/admin/orders':function(){return {orders:[]}},
    '/api/admin/settings':function(){return {apiKeys:[]}},
    '/api/platform/users':function(){return {users:[]}},
    '/api/platform/contacts':function(){return {contacts:[]}}
  };
  const orig=window.fetch;
  window.fetch=function(u,o){
    const url=(typeof u==='string')?u:((u&&u.url)||'');
    for(const k in canned){
      if(url.indexOf(k)!==-1){
        return Promise.resolve(new Response(JSON.stringify(canned[k]()),{status:200,headers:{'Content-Type':'application/json'}}));
      }
    }
    return orig.apply(this,arguments);
  };
})();`;

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await send('Page.addScriptToEvaluateOnNewDocument', { source: STUB });

const results = {};
// 注意：position:fixed 的元素 offsetParent 恒为 null，不能用 offsetParent 判可见
const VIS = `const vis=el=>{if(!el)return false;const cs=getComputedStyle(el);if(cs.display==='none'||cs.visibility==='hidden'||Number(cs.opacity)===0)return false;const r=el.getBoundingClientRect();return r.height>0&&r.width>0};`;

/* ---------- 1) 首页弹窗基准样式 ---------- */
await goto(BASE + 'index.html#anon');
await ev(`openAuth()`);
results.homeAuthStyle = await ev(`(()=>{${VIS}
  const mc=document.querySelector('#authModal .modal-card');
  const c=getComputedStyle(mc);
  const r=mc.getBoundingClientRect();
  return {modalVisible:vis(document.getElementById('authModal')),
    cardMaxW:c.maxWidth,cardPad:c.padding,cardBg:c.backgroundColor,cardRadius:c.borderRadius,
    cardW:Math.round(r.width),cardCenteredX:Math.round(r.left+r.width/2),
    submitBg:getComputedStyle(document.querySelector('#authModal .auth-submit')).backgroundColor,
    submitH:getComputedStyle(document.querySelector('#authModal .auth-submit')).minHeight,
    forgot:document.querySelector('#authForgot a').textContent.trim(),
    tabs:[...document.querySelectorAll('#authModal .tab')].map(t=>t.textContent.trim())};
})()`);
await shot('home-login-modal.png');

/* ---------- 2) 发码页（已登录）---------- */
await goto(BASE + 'admin.html');
results.admin = await ev(`(()=>{${VIS}
  const links=[...document.querySelectorAll('.nav-tools a')];
  const menu=[...document.querySelectorAll('.sidebar .menu-item')].map(m=>m.textContent.trim());
  return {
    navTexts:links.map(a=>a.textContent.trim()),
    navHrefs:links.map(a=>a.getAttribute('href')),
    brandText:(document.querySelector('.nav .brand span')||{}).textContent,
    navToolsVisible:vis(document.querySelector('.nav-tools')),
    navHeight:Math.round(document.querySelector('.nav').getBoundingClientRect().height),
    sidebar: {
      home:document.querySelectorAll('.sidebar .home').length,
      linkItem:document.querySelectorAll('.sidebar .link-item').length,
      logout:document.querySelectorAll('.sidebar .logout').length,
      menu:menu,
      contact:document.querySelectorAll('.sidebar .contact-item').length,
      logo:document.querySelectorAll('.sidebar .logo').length,
      sidebarImgs:document.querySelectorAll('.sidebar img').length,
      who:document.querySelectorAll('.sidebar .who').length,
      whoVisible:vis(document.getElementById('whoBox')),
      sidebarText:(document.querySelector('.sidebar').textContent||'').replace(/\s+/g,' ').trim()
    },
    navRight: {
      loginVis:vis(document.getElementById('navLogin')),
      userText:(document.getElementById('navUser').textContent||'').trim(),
      userVis:vis(document.getElementById('navUser')),
      contactVis:vis(document.getElementById('navContact')),
      logoutText:(document.getElementById('navLogout').textContent||'').trim(),
      logoutVis:vis(document.getElementById('navLogout'))
    },
    layout:{sidebarLeft:Math.round(document.querySelector('.sidebar').getBoundingClientRect().left),
      sidebarTop:Math.round(document.querySelector('.sidebar').getBoundingClientRect().top),
      mainTop:Math.round(document.querySelector('.main').getBoundingClientRect().top)}
  };
})()`);
await shot('admin-desktop.png');

/* ---------- 3) platform 未登录：登录弹窗 ---------- */
await goto(BASE + 'platform.html#anon');
results.platformAnon = await ev(`(()=>{${VIS}
  const acc=document.querySelector('.topbar .account');
  const mail=document.getElementById('curAccount');
  const out=document.querySelector('.logout-mini');
  const mc=document.querySelector('#authModal .modal-card');
  const c=getComputedStyle(mc);
  const r=mc.getBoundingClientRect();
  return {
    modalVisible:vis(document.getElementById('authModal')),
    cardMaxW:c.maxWidth,cardPad:c.padding,cardBg:c.backgroundColor,cardRadius:c.borderRadius,
    cardW:Math.round(r.width),cardCenteredX:Math.round(r.left+r.width/2),
    submitBg:getComputedStyle(document.querySelector('#authModal .auth-submit')).backgroundColor,
    submitH:getComputedStyle(document.querySelector('#authModal .auth-submit')).minHeight,
    forgot:document.querySelector('#authForgot a').textContent.trim(),
    forgotHref:document.querySelector('#authForgot a').getAttribute('href'),
    forgotVis:vis(document.querySelector('#authForgot a')),
    tabs:[...document.querySelectorAll('#authModal .tab')].map(t=>t.textContent.trim()),
    activeTab:document.querySelector('#authModal .tab.active').textContent.trim(),
    submitText:document.getElementById('authSubmitBtn').textContent.trim(),
    tip:document.getElementById('authTip').textContent.trim(),
    anonymousKeptOnPage:location.pathname.endsWith('platform.html'),
    sidebarHome:document.querySelectorAll('.sidebar .home').length,
    sidebarLogout:document.querySelectorAll('.sidebar .logout').length,
    sidebarMenu:[...document.querySelectorAll('.sidebar .menu-item')].map(m=>m.textContent.trim()),
    exitText:out?out.textContent.trim():null,
    exitVisible:out?vis(out):false,
    exitAfterMail:!!(out&&mail&&(mail.compareDocumentPosition(out)&Node.DOCUMENT_POSITION_FOLLOWING)>0),
    accountText:acc.textContent.replace(/\\s+/g,' ').trim(),
    curAccountText:mail.textContent.trim()
  };
})()`);
await shot('platform-anon-login.png');

/* ---------- 4) platform 弹窗切到注册 ---------- */
results.platformRegister = await ev(`(()=>{${VIS}
  document.getElementById('tabRegister').click();
  return {
    activeTab:document.querySelector('#authModal .tab.active').textContent.trim(),
    nameWrap:vis(document.getElementById('authNameWrap')),
    contactWrap:vis(document.getElementById('authContactWrap')),
    forgotVis:vis(document.querySelector('#authForgot a')),
    submitText:document.getElementById('authSubmitBtn').textContent.trim()
  };
})()`);

/* ---------- 5) platform 已登录 ---------- */
await goto(BASE + 'platform.html');
results.platformLogged = await ev(`(()=>{${VIS}
  const acc=document.querySelector('.topbar .account');
  const out=document.querySelector('.logout-mini');
  return {
    modalVisible:vis(document.getElementById('authModal')),
    curAccount:document.getElementById('curAccount').textContent.trim(),
    accountText:acc.textContent.replace(/\\s+/g,' ').trim(),
    exitText:out.textContent.trim(),
    exitVisible:vis(out),
    sidebarHome:document.querySelectorAll('.sidebar .home').length,
    sidebarLogout:document.querySelectorAll('.sidebar .logout').length
  };
})()`);
await shot('platform-logged.png');

/* ---------- 6) 窄屏 ---------- */
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 780, deviceScaleFactor: 1, mobile: true });
await goto(BASE + 'admin.html');
results.adminMobile = await ev(`(()=>{${VIS}
  const nv=document.querySelector('.nav').getBoundingClientRect();
  const sb=document.querySelector('.sidebar').getBoundingClientRect();
  return {
    navHeight:Math.round(nv.height),
    navToolsVisible:vis(document.querySelector('.nav-tools')),
    navRightVisible:vis(document.getElementById('navLogout')),
    sidebarWidth:Math.round(sb.width),
    sidebarTop:Math.round(sb.top),
    noHome:document.querySelectorAll('.sidebar .home').length===0,
    noLogout:document.querySelectorAll('.sidebar .logout').length===0
  };
})()`);
await shot('admin-mobile.png');

/* ---------- 7) 桌面窄屏（820x760）---------- */
await send('Emulation.setDeviceMetricsOverride', { width: 820, height: 760, deviceScaleFactor: 1, mobile: false });
await goto(BASE + 'admin.html');
results.admin820 = await ev(`(()=>{${VIS}
  const nv=document.querySelector('.nav').getBoundingClientRect();
  return {
    navHeight:Math.round(nv.height),
    navToolsVisible:vis(document.querySelector('.nav-tools')),
    navToolsScrollable:document.querySelector('.nav-tools').scrollWidth>document.querySelector('.nav-tools').clientWidth,
    sidebarIsRow:getComputedStyle(document.querySelector('.sidebar')).flexDirection,
    sidebarWidth:Math.round(document.querySelector('.sidebar').getBoundingClientRect().width)
  };
})()`);
await shot('admin-820.png');

results.pageExceptions = errs;

writeFileSync(OUT + 'result.json', JSON.stringify(results, null, 2), 'utf8');
console.log(JSON.stringify(results, null, 2));
ws.close(); child.kill();
