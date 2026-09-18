/**
 * /excel 页面截图（System Edge + CDP）：空态 → 体检报告 → 样本弹层 → 变更摘要
 * 顺带给首页拍一张（用来看新增的 Excel 产品卡）
 * 用法：node tools/excel-shot.mjs
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const E = require('C:/Users/87882/AppData/Local/Temp/exceljs-dl/exceljs.min.js');

const ROOT = 'E:/Workbuddy/Shademark';
const DIST = join(ROOT, 'dist');
const SHOTS = join(ROOT, 'tools/shots');
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 8788;
const CDP = 9455;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function makeDirty() {
  const wb = new E.Workbook();
  const ws = wb.addWorksheet('订单明细');
  ws.addRow(['订单号', '客户姓名', '手机号', '身份证号', '下单日期', '金额', '数量', '备注']);
  const dup = ['ORD-002', '李\u200B四', '13800138000', '110101199001011234', '2026/9/2', '345', '000111', '张三\n\n李四'];
  [
    ['\uFEFFORD-001', ' 张三\u00A0', '13800138000', '110101199001011234', '2026-09-01', '1234.50', '000678', '  正常  '],
    dup,
    ['ＯＲＤ－００３', '王五', '13800138000', '110101199001011234', '2026.09.03', '1,234.50', '000222', '多余的\u3000空格'],
    ['ORD-004', '赵六', '13800138000', '110101199001011234', '2026年9月4日', '456', '000333', ''],
    ['ORD-005', '孙七', '13800138000', '110101199001011234', '2026年第3季度', '789', '000444', '正常'],
    dup.slice(),
    ['ORD-007', '周八', '13800138000', '110101199001011234', '2026.9', '456', '000555', ''],
  ].forEach((r) => ws.addRow(r));
  ws.getCell('H9').value = { text: '点我看详情', hyperlink: 'https://example.com/a' };
  ws.getCell('A10').value = '合计';
  ws.getCell('F10').value = { formula: 'SUM(Amounts)', result: 3000 };
  for (let i = 41; i <= 90; i++) ws.getRow(i);
  for (let c = 11; c <= 20; c++) ws.getColumn(c);
  ws.getRow(4).hidden = true;
  ws.getColumn(8).hidden = true;
  ws.getCell('B2').note = '这是一条批注';
  ws.getCell('H3').note = '另一条批注';
  wb.definedNames.add("'订单明细'!$F$2:$F$8", 'Amounts');
  wb.definedNames.add("'订单明细'!$A$2:$A$3", 'Unused');
  return Buffer.from(await wb.xlsx.writeBuffer());
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png', '.ico': 'image/x-icon', '.xml': 'application/xml', '.txt': 'text/plain' };
const server = createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p === '/excel' || p === '/excel/') p = '/excel/index.html';
    if (p === '/') p = '/index.html';
    let f = join(DIST, normalize(p).replace(/^([/\\])+/, ''));
    if (!f.endsWith('.html') && existsSync(f + '.html')) f += '.html';
    if (!existsSync(f)) return res.writeHead(404).end('404');
    res.writeHead(200, { 'content-type': MIME[extname(f)] || 'application/octet-stream' });
    res.end(await readFile(f));
  } catch (e) { res.writeHead(500).end(String(e.message)); }
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

const child = spawn(EDGE, [
  `--remote-debugging-port=${CDP}`, '--headless=new', '--disable-gpu', '--hide-scrollbars',
  '--no-first-run', '--no-default-browser-check', `--user-data-dir=C:/temp/sdm-xshot-${Date.now()}`, '--window-size=1440,900', 'about:blank',
], { stdio: 'ignore' });

for (let i = 0; i < 80; i++) { try { if ((await fetch(`http://127.0.0.1:${CDP}/json/version`)).ok) break; } catch {} await sleep(250); }
let target = null;
for (let i = 0; i < 40; i++) {
  try { const l = await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json(); target = l.find((t) => t.type === 'page' && t.webSocketDebuggerUrl); if (target) break; } catch {}
  await sleep(250);
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let mid = 0; const pend = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
const send = (m, p = {}) => new Promise((res) => { const i = ++mid; pend.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
async function ev(expr, awaitPromise = false) {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise, returnByValue: true, userGesture: true });
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text);
  return r.result?.result?.value;
}
async function nav(url) {
  await send('Page.navigate', { url });
  for (let i = 0; i < 120; i++) { await sleep(150); try { if (await ev('document.readyState') === 'complete') break; } catch {} }
  await sleep(900);
}
async function shot(name, w = 1440, h = 900) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 700 });
  await sleep(500);
  const r = await send('Page.captureScreenshot', { format: 'png' });
  await writeFile(join(SHOTS, name), Buffer.from(r.result.data, 'base64'));
  await send('Emulation.clearDeviceMetricsOverride');
  await sleep(200);
  console.log('  写出', name);
}

await mkdir(SHOTS, { recursive: true });
await send('Page.enable'); await send('Runtime.enable');
try {
  await nav(`http://127.0.0.1:${PORT}/excel`);
  await shot('excel-1-empty.png');
  await shot('excel-1b-empty-375.png', 375, 780);

  const dirty = await makeDirty();
  await ev(`(()=>{
    const bin=atob(${JSON.stringify(dirty.toString('base64'))});
    const u8=new Uint8Array(bin.length); for(let i=0;i<bin.length;i++) u8[i]=bin.charCodeAt(i);
    const f=new File([u8],'订单明细.xlsx',{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
    const dt=new DataTransfer(); dt.items.add(f);
    const inp=document.getElementById('fileInput'); inp.files=dt.files; inp.dispatchEvent(new Event('change'));
    return 1;})()`);
  for (let i = 0; i < 80; i++) { await sleep(300); if (await ev('App.files[0] && App.files[0].state!=="reading"')) break; }
  await sleep(600);
  await shot('excel-2-report.png');
  await shot('excel-2b-report-375.png', 375, 900);

  await ev(`document.querySelector('#reportArea .item-count.hot').click()`);
  await sleep(600);
  await shot('excel-3-samples.png');
  await ev('App.closeSamples()');

  await ev('App.toggleItem("dupes", true); App.toggleItem("date", true); App.setPick("names", true); document.getElementById("btnRun").click();');
  for (let i = 0; i < 200; i++) { await sleep(300); if (await ev('App.results !== null')) break; }
  await sleep(700);
  await shot('excel-4-summary.png');

  await nav(`http://127.0.0.1:${PORT}/`);
  await shot('home-with-excel.png', 1440, 1000);
} catch (e) {
  console.log('FATAL', e.message);
} finally {
  try { ws.close(); } catch {}
  try { child.kill(); } catch {}
  server.close();
  process.exit(0);
}
