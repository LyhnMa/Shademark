/**
 * 无头截图（System Edge + CDP，Node 内置 WebSocket）
 * 用法：node tools/cdp-shot.mjs <url> <out.png> [打开弹窗的JS] [宽] [高]
 * 例：node tools/cdp-shot.mjs https://shademark.cn/ out.png "document.getElementById('navAuth').click()"
 */
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const [url, out, js = '', W = '900', H = '800'] = process.argv.slice(2);
if (!url || !out) { console.log('用法: node tools/cdp-shot.mjs <url> <out.png> [js] [w] [h]'); process.exit(2); }

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 9334;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const child = spawn(EDGE, [
  `--remote-debugging-port=${PORT}`, '--headless=new', '--disable-gpu', '--hide-scrollbars',
  '--no-first-run', '--no-default-browser-check',
  `--user-data-dir=C:/temp/sdm-shot-${Date.now()}`, `--window-size=${W},${H}`, 'about:blank',
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

await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: Number(W), height: Number(H), deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url });
for (let i = 0; i < 100; i++) { await sleep(150); try { if (await ev('document.readyState') === 'complete') break; } catch {} }
await sleep(800);
if (js) { await ev(js); await sleep(600); }
const shot = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(out, Buffer.from(shot.result.data, 'base64'));
console.log('已写入 ' + out);
ws.close(); child.kill(); process.exit(0);
