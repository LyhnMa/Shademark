/**
 * /excel 页面真实浏览器端到端验证（System Edge + CDP，Node 内置 WebSocket）
 *
 * 做的事：本地起静态服务 → 造一个脏 xlsx → 在页面里走完
 *   上传 → 体检报告 → 勾选 → 处理 → 变更摘要 → 取回输出字节 → 用 exceljs 校验
 *
 * 用法：node tools/excel-e2e.mjs
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const E = require('C:/Users/87882/AppData/Local/Temp/exceljs-dl/exceljs.min.js');

const ROOT = 'E:/Workbuddy/Shademark';
const PUBLIC = join(ROOT, 'public');
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 8777;
const CDP = 9444;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
let failed = 0;
function check(name, ok, detail) {
  results.push(name);
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : '   → ' + detail}`);
}

/* ---------------- 1. 造脏文件 ----------------
 * 第 2 行与第 7 行完全一致（清洗后仍一致）→ 用来验重复行
 * 'Amounts' 被 F10 公式引用，'Unused' 没有 → 用来验命名范围只删未引用的
 */
async function makeDirty() {
  const wb = new E.Workbook();
  const ws = wb.addWorksheet('订单明细');
  ws.addRow(['订单号', '客户姓名', '手机号', '身份证号', '下单日期', '金额', '数量', '备注']);
  const dup = ['ORD-002', '李\u200B四', '13800138000', '110101199001011234', '2026/9/2', '345', '000111', '张三\n\n李四'];
  const rows = [
    ['\uFEFFORD-001', ' 张三\u00A0', '13800138000', '110101199001011234', '2026-09-01', '1234.50', '000678', '  正常  '],
    dup,
    ['ＯＲＤ－００３', '王五', '13800138000', '110101199001011234', '2026.09.03', '1,234.50', '000222', '多余的\u3000空格'],
    ['ORD-004', '赵六', '13800138000', '110101199001011234', '2026年9月4日', '456', '000333', ''],
    ['ORD-005', '孙七', '13800138000', '110101199001011234', '2026年第3季度', '789', '000444', '正常'],
    dup.slice(),
    ['ORD-007', '周八', '13800138000', '110101199001011234', '2026.9', '456', '000555', ''],
  ];
  rows.forEach((r) => ws.addRow(r));

  ws.getCell('H9').value = { text: '点我看详情', hyperlink: 'https://example.com/a' };
  ws.getCell('A10').value = '合计';
  ws.getCell('F10').value = { formula: 'SUM(Amounts)', result: 3000 };

  for (let i = 41; i <= 90; i++) ws.getRow(i);       // 范围外虚行
  for (let c = 11; c <= 20; c++) ws.getColumn(c);    // 范围外虚列
  ws.getRow(4).hidden = true;                        // 隐藏行（范围内）
  ws.getColumn(8).hidden = true;                     // 隐藏列（范围内）
  ws.getCell('B2').note = '这是一条批注';
  ws.getCell('H3').note = '另一条批注';
  wb.definedNames.add("'订单明细'!$F$2:$F$8", 'Amounts');
  wb.definedNames.add("'订单明细'!$A$2:$A$3", 'Unused');

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

/* ---------------- 2. 静态服务 ---------------- */
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png', '.ico': 'image/x-icon', '.css': 'text/css; charset=utf-8' };
const server = createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p === '/excel' || p === '/excel/') p = '/excel/index.html';
    let file = join(PUBLIC, normalize(p).replace(/^([/\\])+/, ''));
    if (!existsSync(file)) return res.writeHead(404).end('404');
    if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch (e) { res.writeHead(500).end(String(e.message)); }
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

/* ---------------- 3. 起 Edge + CDP ---------------- */
const child = spawn(EDGE, [
  `--remote-debugging-port=${CDP}`, '--headless=new', '--disable-gpu', '--no-first-run',
  '--no-default-browser-check', `--user-data-dir=C:/temp/sdm-excel-${Date.now()}`, 'about:blank',
], { stdio: 'ignore' });

let ver = null;
for (let i = 0; i < 80; i++) {
  try { const r = await fetch(`http://127.0.0.1:${CDP}/json/version`); if (r.ok) { ver = await r.json(); break; } } catch {}
  await sleep(250);
}
if (!ver) { console.log('Edge DevTools 未就绪'); server.close(); child.kill(); process.exit(3); }

let target = null;
for (let i = 0; i < 40; i++) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json();
    target = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
    if (target) break;
  } catch {}
  await sleep(250);
}
if (!target) { console.log('拿不到 page target'); server.close(); child.kill(); process.exit(4); }

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let mid = 0; const pend = new Map();
const errs = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); return; }
  if (m.method === 'Runtime.exceptionThrown') errs.push(m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text);
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errs.push(m.params.args.map((a) => a.value || a.description).join(' '));
};
const send = (method, params = {}) => new Promise((res) => { const i = ++mid; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
async function ev(expr, awaitPromise = false) {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise, returnByValue: true, userGesture: true });
  if (r.result && r.result.exceptionDetails) throw new Error('JS 异常: ' + (r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text));
  return r.result?.result?.value;
}
async function waitFor(expr, ms = 40000, step = 300) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { try { if (await ev(expr)) return true; } catch {} await sleep(step); }
  return false;
}

/* 把 worksheet 读成可断言的二维数组 */
function mat(ws) {
  const out = [];
  for (let r = 1; r <= ws.actualRowCount; r++) {
    const row = [];
    for (let c = 1; c <= Math.max(ws.actualColumnCount, 1); c++) {
      let v = ws.getCell(r, c).value;
      if (v && typeof v === 'object' && v.result !== undefined) v = v.result;
      if (v instanceof Date) {
        v = [v.getFullYear(), String(v.getMonth() + 1).padStart(2, '0'), String(v.getDate()).padStart(2, '0')].join('-');
      }
      row.push(v === null || v === undefined ? '' : v);
    }
    out.push(row);
  }
  return out;
}

try {
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/excel` });
  for (let i = 0; i < 120; i++) { await sleep(150); try { if (await ev('document.readyState') === 'complete') break; } catch {} }
  await waitFor('typeof window.App === "object" && typeof window.ExcelJS === "object" && typeof window.ShadeMarkExcelClean === "object"', 30000);
  check('页面加载 + exceljs / 引擎就位',
    await ev('typeof window.App==="object" && typeof window.ExcelJS==="object" && typeof window.ShadeMarkExcelClean==="object"'));
  check('引擎版本', true, await ev('window.ShadeMarkExcelClean.VERSION'));
  check('顶栏三项切换存在', (await ev('document.querySelectorAll(".mode-btn").length')) === 3);
  check('顶栏 Excel 高亮', await ev('!!document.querySelector(".nav-tools a.active[href=\'/excel\']")'));
  check('品牌名 16px 实色',
    (await ev(`(()=>{const e=document.querySelector('.brand-text');const s=getComputedStyle(e);return s.fontSize+'|'+s.color;})()`)) === '16px|rgb(232, 232, 234)',
    await ev(`(()=>{const s=getComputedStyle(document.querySelector('.brand-text'));return s.fontSize+'|'+s.color;})()`));

  /* ---- 上传 ---- */
  const dirty = await makeDirty();
  await ev(`(()=>{
    const bin = atob(${JSON.stringify(dirty.toString('base64'))});
    const u8 = new Uint8Array(bin.length);
    for (let i=0;i<bin.length;i++) u8[i]=bin.charCodeAt(i);
    const f = new File([u8], '订单明细.xlsx', {type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
    const dt = new DataTransfer(); dt.items.add(f);
    const inp = document.getElementById('fileInput');
    inp.files = dt.files; inp.dispatchEvent(new Event('change'));
    return true;
  })()`);
  const okReady = await waitFor('App.files.length===1 && App.files[0].state!=="reading"', 40000);
  check('文件读取完成', okReady, await ev('App.files[0] ? App.files[0].state + " " + (App.files[0].error||"") : "无文件"'));

  /* ---- 体检报告 ---- */
  const rep = JSON.parse(await ev(`(()=>{
    const items = [].map.call(document.querySelectorAll('#reportArea .item'), el => ({
      key: el.querySelector('input[type=checkbox]').id.replace('it_',''),
      on: el.querySelector('input[type=checkbox]').checked,
      txt: el.querySelector('.item-count').textContent.trim()
    }));
    return JSON.stringify({ n: items.length, items, groups: document.querySelectorAll('#reportArea .grp-name').length });
  })()`));
  console.log('   报告 =', rep.items.map((i) => `${i.key}:${i.txt}${i.on ? '' : '(不勾)'}`).join('  '));
  const cnt = (k) => rep.items.find((i) => i.key === k)?.txt || '';
  const isOn = (k) => rep.items.find((i) => i.key === k)?.on;
  check('报告三项分组', rep.groups === 3, rep.groups);
  check('报告 10 项', rep.n === 10, rep.n);
  check('不可见字符有数', cnt('invisible').startsWith('4'), cnt('invisible'));
  check('空格换行有数', /^\d+/.test(cnt('spaces')), cnt('spaces'));
  check('超链接 1 处', cnt('hyperlink').startsWith('1'), cnt('hyperlink'));
  check('全角有数', /^\d+/.test(cnt('fullwidth')), cnt('fullwidth'));
  check('文本型数字有数', /^\d+/.test(cnt('textnum')), cnt('textnum'));
  check('日期有数（默认不勾）', /^\d+/.test(cnt('date')) && isOn('date') === false, cnt('date'));
  check('重复行 1 行（默认不勾）', cnt('dupes').startsWith('1') && isOn('dupes') === false, cnt('dupes'));
  check('隐藏行列 2 处', cnt('hidden').startsWith('2'), cnt('hidden'));
  check('批注 2 处', cnt('notes').startsWith('2'), cnt('notes'));
  check('命名范围 2 个（默认不勾）', cnt('names').startsWith('2') && isOn('names') === false, cnt('names'));

  /* ---- 样本弹层 ---- */
  await ev(`document.querySelector('#reportArea .item-count.hot').click()`);
  await sleep(400);
  check('点数字能打开样本', await ev('document.getElementById("sampleModal").classList.contains("active")'));
  check('样本有内容', (await ev('document.querySelectorAll("#sampleBody .smp").length')) > 0,
    await ev('document.getElementById("sampleBody").innerText.slice(0,70).replace(/\\s+/g," ")'));
  await ev('App.closeSamples()');

  /* ---- 勾上确认项再处理 ---- */
  await ev('App.toggleItem("dupes", true); App.toggleItem("date", true); App.setPick("names", true);');
  await sleep(300);
  check('确认项展开出下拉', (await ev('document.querySelectorAll("#reportArea .item-ctl select").length')) >= 5,
    await ev('document.querySelectorAll("#reportArea .item-ctl select").length'));

  await ev('document.getElementById("btnRun").click()');
  const okDone = await waitFor('App.results !== null', 90000, 400);
  check('处理完成并进入变更摘要', okDone);
  const sumTxt = await ev('document.getElementById("summaryArea").innerText.replace(/\\s+/g," ")');
  console.log('   摘要 =', sumTxt.slice(0, 320));
  check('摘要给出输出文件名', /_清洗/.test(sumTxt));
  check('摘要能点看样本', (await ev('document.querySelectorAll("#summaryArea .linkish").length')) > 0);

  /* ---- 取回输出并校验 ---- */
  const outB64 = await ev(`(()=>{
    const o = App.results.outputs[0];
    const u8 = new Uint8Array(o.data);
    let s=''; const CH=0x8000;
    for (let i=0;i<u8.length;i+=CH) s += String.fromCharCode.apply(null, u8.subarray(i,i+CH));
    return btoa(s);
  })()`);
  check('输出是 xlsx 单文件', (await ev('App.results.outputs.length')) === 1, await ev('App.results.outputs.map(o=>o.name).join(",")'));
  const outBuf = Buffer.from(outB64, 'base64');
  console.log('   输出体积 =', outBuf.length, 'bytes（原文件', dirty.length, '）');

  const wb2 = new E.Workbook();
  await wb2.xlsx.load(outBuf);
  check('输出可被 exceljs 读回', true, wb2.worksheets.map((w) => w.name).join(','));
  const clean = wb2.getWorksheet('订单明细_清洗');
  check('存在「订单明细_清洗」', !!clean);
  const M = mat(clean);
  M.forEach((r, i) => console.log('    ' + (i + 1) + ' | ' + r.join(' │ ')));
  const flat = M.map((r) => r.join('|')).join('\n');

  check('表头 = 原表头', M[0][0] === '订单号' && M[0][7] === '备注');
  check('BOM 清除', M[1][0] === 'ORD-001', JSON.stringify(M[1][0]));
  check('首尾空格 + NBSP 清除', M[1][1] === '张三' && M[1][7] === '正常', JSON.stringify(M[1][1]) + '/' + JSON.stringify(M[1][7]));
  check('零宽字符清除', M[2][1] === '李四', JSON.stringify(M[2][1]));
  check('全角转半角', M[3][0] === 'ORD-003', JSON.stringify(M[3][0]));
  check('全角空格转普通空格', M[3][7] === '多余的 空格', JSON.stringify(M[3][7]));
  check('连续换行压一个', M[2][7] === '张三\n李四', JSON.stringify(M[2][7]));
  check('超链接只剩文字', M[7][7] === '点我看详情', JSON.stringify(M[7][7]));
  check('文本型数字→数字', typeof M[1][5] === 'number' && Math.abs(M[1][5] - 1234.5) < 1e-9, typeof M[1][5] + ':' + M[1][5]);
  check('千分位不转（非纯数字）', M[3][5] === '1,234.50', JSON.stringify(M[3][5]));
  check('前导零列跳过', M[1][6] === '000678', JSON.stringify(M[1][6]));
  check('手机号列跳过', String(M[1][2]) === '13800138000', JSON.stringify(M[1][2]));
  check('身份证列跳过', String(M[1][3]) === '110101199001011234', JSON.stringify(M[1][3]));
  check('日期 yyyy-mm-dd', M[1][4] === '2026-09-01', JSON.stringify(M[1][4]));
  check('日期 yyyy/m/d', M[2][4] === '2026-09-02', JSON.stringify(M[2][4]));
  check('日期 yyyy.mm.dd', M[3][4] === '2026-09-03', JSON.stringify(M[3][4]));
  check('日期 年月日', M[4][4] === '2026-09-04', JSON.stringify(M[4][4]));
  check('认不出的日期原样', M[5][4] === '2026年第3季度', JSON.stringify(M[5][4]));
  check('2026.9 被文本型数字先接管', M[6][4] === 2026.9 || M[6][4] === '2026.9', JSON.stringify(M[6][4]));
  check('公式输出为结果值', M[8][5] === 3000, JSON.stringify(M[8][5]));
  check('合计行保留', M[8][0] === '合计', JSON.stringify(M[8][0]));
  check('重复行已删（7 行数据 → 6 行）', flat.match(/ORD-002/g)?.length === 1, flat.match(/ORD-002/g)?.length);
  check('清洗表共 9 行', M.length === 9, M.length);
  check('没有残留不可见字符', !/[\u00A0\u200B\u200C\u200D\u2060\uFEFF]/.test(flat));
  check('没有残留全角数字字母', !/[０-９Ａ-Ｚａ-ｚ－]/.test(flat));

  check('表头加粗 + 墨色', clean.getCell('A1').font?.bold === true && clean.getCell('A1').font?.color?.argb === 'FF2B2926', JSON.stringify(clean.getCell('A1').font?.color));
  check('表头浅灰底 F2F2F2', clean.getCell('A1').fill?.fgColor?.argb === 'FFF2F2F2', JSON.stringify(clean.getCell('A1').fill?.fgColor));
  check('表头居中', clean.getCell('A1').alignment?.horizontal === 'center');
  check('表头下细线', clean.getCell('A1').border?.bottom?.style === 'thin');
  check('首行冻结', clean.views?.[0]?.state === 'frozen', JSON.stringify(clean.views?.[0]?.ySplit));
  check('正文未加粗', !clean.getCell('A2').font?.bold);
  check('列宽 ≤ 40', clean.columns.every((c) => !c.width || c.width <= 40), clean.columns.map((c) => c.width).join(','));

  const orig = wb2.getWorksheet('订单明细');
  check('原表数据未被改写', String(orig.getCell('A2').value).includes('ORD-001'), JSON.stringify(orig.getCell('A2').value));
  check('原表虚行已清', orig.actualRowCount === 10, orig.actualRowCount);
  check('原表隐藏行列已展开', orig.getRow(4).hidden !== true && orig.getColumn(8).hidden !== true);
  check('批注保持隐藏（默认不删）', !!orig.getCell('B2').note, JSON.stringify(orig.getCell('B2').note));
  check('命名范围只留被引用的',
    JSON.stringify((wb2.definedNames.model || []).map((n) => n.name)) === JSON.stringify(['Amounts']),
    JSON.stringify((wb2.definedNames.model || []).map((n) => n.name)));

  /* ---- 批注「常显」补丁 ---- */
  await ev('App.backToReport(); App.setPick("notes","show");');
  await sleep(200);
  await ev('document.getElementById("btnRun").click()');
  await waitFor('App.results !== null', 90000, 400);
  const noteB64 = await ev(`(()=>{
    const o = App.results.outputs[0];
    const u8 = new Uint8Array(o.data);
    let s=''; const CH=0x8000;
    for (let i=0;i<u8.length;i+=CH) s += String.fromCharCode.apply(null, u8.subarray(i,i+CH));
    return btoa(s);
  })()`);
  const noteBuf = Buffer.from(noteB64, 'base64');
  const JSZip = require('C:/Users/87882/AppData/Local/Temp/exceljs-dl/jszip.min.js');
  const zip = await JSZip.loadAsync(noteBuf);
  const vmlName = Object.keys(zip.files).find((x) => /vmlDrawing.*\.vml$/i.test(x));
  const vml = vmlName ? await zip.file(vmlName).async('string') : '';
  check('批注常显补丁生效', /visibility:visible/.test(vml) && /<x:Visible\/>/.test(vml));
  const wbN = new E.Workbook();
  await wbN.xlsx.load(noteBuf);
  check('补丁后文件仍可读', !!wbN.getWorksheet('订单明细'));

  /* ---- CSV 输出 ---- */
  await ev('App.backToReport(); document.getElementById("outFormat").value="csv"; document.getElementById("outFormat").dispatchEvent(new Event("change"));');
  await sleep(250);
  await ev('document.getElementById("btnRun").click()');
  const okCsv = await waitFor('App.results && App.results.outputs.length > 0', 90000, 400);
  check('CSV 输出模式跑通', okCsv);
  const csvName = await ev('App.results.outputs.map(o=>o.name).join(",")');
  check('输出是 .csv', /\.csv$/.test(csvName), csvName);
  const csvText = await ev('App.results.outputs[0].data');
  check('CSV 带 BOM + CRLF', csvText.charCodeAt(0) === 0xFEFF && /\r\n/.test(csvText));
  check('CSV 表头正确', csvText.split('\r\n')[0].replace('\uFEFF', '').split(',')[0] === '订单号');
  check('CSV 已清洗', !/[\u00A0\u200B\uFEFF]/.test(csvText.replace(/^\uFEFF/, '')) && /ORD-003/.test(csvText));

  /* ---- 超限文件不崩 ---- */
  await ev(`(()=>{
    const f = new File([new Uint8Array(90*1024*1024)], 'huge.xlsx', {type:'application/octet-stream'});
    App.addFiles([f]); return true;
  })()`);
  await sleep(700);
  const hugeState = await ev('App.files[App.files.length-1].state + "|" + App.files[App.files.length-1].error');
  check('超限文件只提示不崩', /^error\|/.test(hugeState), hugeState);
  check('超限后页面仍可交互', await ev('!!document.getElementById("outFormat")'));

  /* ---- 手机端 375 ---- */
  await send('Emulation.setDeviceMetricsOverride', { width: 375, height: 780, deviceScaleFactor: 1, mobile: true });
  await sleep(500);
  const m375 = JSON.parse(await ev(`(()=>{
    const h=document.querySelector('.app-header');
    const nav=getComputedStyle(document.querySelector('.nav-tools')).display;
    const t=document.querySelector('.content-title');
    return JSON.stringify({hh:h.getBoundingClientRect().height, nav, over:document.documentElement.scrollWidth>document.documentElement.clientWidth+1});
  })()`));
  check('375px 顶栏仍 60px 单行', Math.abs(m375.hh - 60) < 1.5, m375.hh);
  check('375px 隐藏工具导航', m375.nav === 'none', m375.nav);
  check('375px 无横向溢出', !m375.over);
  await send('Emulation.clearDeviceMetricsOverride');

  check('全程无 JS 报错', errs.length === 0, errs.slice(0, 3).join(' | '));
} catch (e) {
  console.log('FATAL', e.message);
  failed++;
} finally {
  console.log(`\n=== ${failed === 0 ? '全部通过' : failed + ' 项失败'} / 共 ${results.length + (failed && !results.length ? 1 : 0)} 项 ===`);
  try { ws.close(); } catch {}
  try { child.kill(); } catch {}
  server.close();
  process.exit(failed === 0 ? 0 : 1);
}
