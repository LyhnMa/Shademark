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
const DIST_ROOT = join(ROOT, 'dist');
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

/* ---------------- 2. 静态服务 ----------------
 * 设 E2E_BASE=https://shademark.cn 就直接打线上（验部署产物），否则本地起 dist 服务
 */
const LIVE = process.env.E2E_BASE || '';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png', '.ico': 'image/x-icon', '.css': 'text/css; charset=utf-8' };
/* 顶栏登录闸门用例用的假鉴权（只在本地模式生效；线上走真接口） */
let MOCK_SESSION = { authenticated: false };
const MOCK_LOGIN_OK = { success: true };
let MOCK_LOGIN = MOCK_LOGIN_OK;
const server = LIVE ? null : createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p === '/api/auth/session') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify(MOCK_SESSION));
    }
    if (p === '/api/auth/login' || p === '/api/auth/register') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify(MOCK_LOGIN));
    }
    if (p === '/excel' || p === '/excel/') p = '/excel/index.html';
    let file = join(DIST_ROOT, normalize(p).replace(/^([/\\])+/, ''));
    if (!existsSync(file)) return res.writeHead(404).end('404');
    if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch (e) { res.writeHead(500).end(String(e.message)); }
});
if (server) await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
const BASE = LIVE || `http://127.0.0.1:${PORT}`;

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
if (!ver) { console.log('Edge DevTools 未就绪'); if (server) server.close(); child.kill(); process.exit(3); }

let target = null;
for (let i = 0; i < 40; i++) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json();
    target = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
    if (target) break;
  } catch {}
  await sleep(250);
}
if (!target) { console.log('拿不到 page target'); if (server) server.close(); child.kill(); process.exit(4); }

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
  await send('Page.navigate', { url: BASE + '/excel' });
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

  /* ================= 第二组 · 合并拆分 ================= */
  console.log('\n--- 合并拆分 ---');

  async function makeMergeSrc() {
    const wb = new E.Workbook();
    const a = wb.addWorksheet('一表');
    a.addRow(['姓名', '部门', '金额']);
    a.addRow(['张三', '销售部', 100]);
    a.addRow(['李四', '技术部', 200]);
    a.addRow(['王五', '销售部', 300]);

    const b = wb.addWorksheet('二表');            // 列序不同 → 验对齐
    b.addRow(['部门', '姓名', '金额']);
    b.addRow(['财务部', '赵六', 400]);

    const c = wb.addWorksheet('三表');            // 多一列 → 验并集
    c.addRow(['部门', '姓名', '报销']);
    c.addRow(['人事部', '孙七', 50]);

    const d = wb.addWorksheet('大表');            // 25 行 → 验按行数拆
    d.addRow(['编号', '值']);
    for (let i = 1; i <= 25; i++) d.addRow(['N' + i, i * 10]);

    const e2 = wb.addWorksheet('拆分用');          // 4 组 → 验按列拆
    e2.addRow(['部门', '金额']);
    [['销售部', 1], ['技术部', 2], ['销售部', 3], ['财务部', 4], ['销售部', 5], ['技术部', 6]]
      .forEach((r) => e2.addRow(r));

    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  const upFile = async (buf, name) => {
    await ev(`(()=>{
      const bin = atob(${JSON.stringify(buf.toString('base64'))});
      const u8 = new Uint8Array(bin.length);
      for (let i=0;i<bin.length;i++) u8[i]=bin.charCodeAt(i);
      const f = new File([u8], ${JSON.stringify(name)}, {type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
      const dt = new DataTransfer(); dt.items.add(f);
      const inp = document.getElementById('fileInput');
      inp.files = dt.files; inp.dispatchEvent(new Event('change'));
      return true;
    })()`);
  };
  const clickSheet = async (name) => ev(`(()=>{
    const rows = [].slice.call(document.querySelectorAll('#fileList .sheet'));
    const row = rows.filter(function(r){ return r.querySelector('b').textContent === ${JSON.stringify(name)}; })[0];
    if (!row) return 'no-row';
    row.querySelector('input[type=checkbox]').click();
    return 'ok';
  })()`);
  const clickBtn = async (sel, text) => ev(`(()=>{
    const bs = [].slice.call(document.querySelectorAll(${JSON.stringify(sel)} + ' button'));
    const b = bs.filter(function(x){ return x.textContent.trim().indexOf(${JSON.stringify(text)}) === 0; })[0];
    if (!b) return 'none';
    if (b.disabled) return 'disabled';
    b.click(); return 'ok';
  })()`);
  const rowsOf = async (i) => JSON.parse(await ev(
    `JSON.stringify(App.mg.results[${i}].table.rows, function(k,v){ return v instanceof Date ? v.toISOString().slice(0,10) : v; })`));

  await ev('App.switchMode("merge")');
  await sleep(300);
  check('切到合并拆分：三块 + 输出区都在',
    (await ev('!!document.getElementById("mergeArea")')) === true &&
    (await ev('getComputedStyle(document.getElementById("mgSeg")).display')) !== 'none' &&
    (await ev('!!document.getElementById("mgOut")')) === true);
  check('操作区两个标签：合并 / 拆分',
    (await ev('App.mg.tab')) === 'merge' &&
    (await ev('[].slice.call(document.querySelectorAll("#mgSeg .seg-btn")).map(function(b){return b.textContent.trim();}).join(",")')) === '合并,拆分');

  await upFile(await makeMergeSrc(), '合并源.xlsx');
  const okSrc = await waitFor('App.files.length===2 && App.files[1].state!=="reading"', 40000);
  check('第二份文件读入（三组共用同一批文件）', okSrc,
    await ev('App.files.map(function(f){return f.name+":"+f.sheets.length;}).join(" | ")'));
  check('来源树列出所有 sheet', (await ev('document.querySelectorAll("#fileList .sheet").length')) === 6,
    await ev('document.querySelectorAll("#fileList .sheet").length'));
  check('sheet 带状态标签（原始）',
    (await ev('[].slice.call(document.querySelectorAll("#fileList .sheet .tag")).map(function(t){return t.textContent;}).join(",")'))
      === '原始,原始,原始,原始,原始,原始');
  check('有全局全选',
    (await ev('!!document.getElementById("treeAll")')) && (await ev('getComputedStyle(document.getElementById("treeTools")).display')) !== 'none');
  check('0 个勾选时按钮灰着 + 提示先勾选',
    (await ev('document.querySelector("#mgOps button").disabled')) === true &&
    /先勾选 sheet/.test(await ev('document.getElementById("mgOps").innerText')));

  /* ---- 合成一个表 ---- */
  check('勾选第 1 张表', (await clickSheet('一表')) === 'ok');
  await sleep(200);
  check('选 1 个：只亮「保留这一个」',
    (await ev('document.querySelectorAll("#mgOps button").length')) === 1 &&
    (await ev('document.querySelector("#mgOps button").textContent.trim()')) === '保留这一个' &&
    (await ev('document.querySelector("#mgOps button").disabled')) === false);
  check('勾选第 2、3 张表', (await clickSheet('二表')) === 'ok' && (await clickSheet('三表')) === 'ok');
  await sleep(250);
  check('选 ≥2 个：两个按钮都亮',
    (await ev('[].slice.call(document.querySelectorAll("#mgOps button")).map(function(b){return b.textContent.trim();}).join(",")')) === '合成一个表,各自保留');
  check('列出未选中的 sheet 数',
    /还有 3 个 sheet 未选中/.test(await ev('document.getElementById("mgOps").innerText')),
    await ev('document.getElementById("mgOps").innerText.replace(/\\s+/g," ")').then((s) => s.slice(0, 160)));

  check('点「合成一个表」', (await clickBtn('#mgOps', '合成一个表')) === 'ok');
  check('结果区出现 1 个结果', await waitFor('App.mg.results.length===1', 60000, 300));
  check('做完后勾选自动清空', (await ev('App.mg.sel.length')) === 0);
  const mHead = JSON.parse(await ev('JSON.stringify(App.mg.results[0].table.header)'));
  const mRows = await rowsOf(0);
  console.log('   合并表头 =', mHead.join(' │ '));
  mRows.forEach((r, i) => console.log('    ' + (i + 1) + ' | ' + r.join(' │ ')));
  check('并集列名（按首次出现排序）', JSON.stringify(mHead) === JSON.stringify(['姓名', '部门', '金额', '报销']), mHead.join(','));
  check('行向下接（3+1+1=5 行）', mRows.length === 5, mRows.length);
  check('列序不同也对齐', JSON.stringify(mRows[3]) === JSON.stringify(['赵六', '财务部', 400, null]), JSON.stringify(mRows[3]));
  check('独有列落位（报销）', JSON.stringify(mRows[4]) === JSON.stringify(['孙七', '人事部', null, 50]), JSON.stringify(mRows[4]));
  check('结果区显示 行×列 + 来源',
    /5 行 × 4 列/.test(await ev('document.getElementById("mgResList").innerText')) &&
    /来自 一表 \+ 二表 \+ 三表/.test(await ev('document.getElementById("mgResList").innerText')));
  check('结果可改名 / 排序 / 删除 / 拿去再用',
    (await ev('document.querySelectorAll("#mgResList .res-acts button").length')) === 5);

  await ev('App.mgRename(' + (await ev('App.mg.results[0].id')) + ', "销售汇总")');
  await sleep(200);
  check('改名生效', (await ev('App.mg.results[0].name')) === '销售汇总');

  /* ---- 输出：一个文件 ---- */
  const outA = JSON.parse(await ev(`App.mgOutputs().then(function(o){ return JSON.stringify(o.map(function(x){ return {name:x.name, size:x.size}; })); })`, true));
  console.log('   输出 A =', outA.map((o) => o.name + '(' + o.size + 'B)').join(', '));
  check('输出：多表合并 → 单独一个新文件（1 个）', outA.length === 1 && /\.xlsx$/.test(outA[0].name), outA.map((o) => o.name).join(','));
  const aB64 = await ev(`App.mgOutputs().then(function(o){
    const u8 = new Uint8Array(o[0].data);
    let s=''; const CH=0x8000;
    for (let i=0;i<u8.length;i+=CH) s += String.fromCharCode.apply(null, u8.subarray(i,i+CH));
    return btoa(s);
  })`, true);
  const wbA = new E.Workbook();
  await wbA.xlsx.load(Buffer.from(aB64, 'base64'));
  check('合并结果在新文件里、原表不掺进来', wbA.worksheets.length === 1 && wbA.getWorksheet('销售汇总') != null,
    wbA.worksheets.map((w) => w.name).join(','));
  const MA = mat(wbA.getWorksheet('销售汇总'));
  check('输出内容与结果一致', JSON.stringify(MA[0]) === JSON.stringify(['姓名', '部门', '金额', '报销']) && MA.length === 6, MA.length + ' 行');
  const wsm = wbA.getWorksheet('销售汇总');
  check('结果表头套上默认样式',
    wsm.getCell('A1').font?.bold === true && wsm.getCell('A1').fill?.fgColor?.argb === 'FFF2F2F2' &&
    wsm.getCell('A1').font?.color?.argb === 'FF2B2926' && wsm.getCell('A1').alignment?.horizontal === 'center' &&
    wsm.getCell('A1').border?.bottom?.style === 'thin' && wsm.views?.[0]?.state === 'frozen');
  check('结果列宽 ≤ 40', wsm.columns.every((c) => !c.width || c.width <= 40), wsm.columns.map((c) => c.width).join(','));

  /* ---- 结果送回来源树 ---- */
  const r0 = await ev('App.mg.results[0].id');
  await ev('App.mgUse(' + r0 + ')');
  await sleep(250);
  const treeTxt = await ev('document.getElementById("resTree").innerText.replace(/\\s+/g," ")');
  check('结果出现在来源树（↻ 结果N · 来自XX）', /销售汇总/.test(treeTxt) && /来自 一表/.test(treeTxt), treeTxt.slice(0, 80));
  check('结果区标 ↻ 已引用', /已引用/.test(await ev('document.getElementById("mgResList").innerText')));
  check('结果节点可勾选', (await ev('document.querySelectorAll("#resTree .tree-node input[type=checkbox]").length')) === 1);

  /* ---- 结果再处理（级联） ---- */
  await ev('document.querySelector("#resTree .tree-node input[type=checkbox]").click()');
  await sleep(300);
  check('勾来源树里的结果 → 亮「保留这一个」',
    (await ev('document.querySelector("#mgOps button").textContent.trim()')) === '保留这一个' &&
    (await ev('document.querySelector("#mgOps button").disabled')) === false);
  await ev('document.querySelector("#mgOps button").click()');
  check('结果能被再处理（级联）', await waitFor('App.mg.results.length===2', 60000, 300),
    await ev('App.mg.results.map(function(r){return r.name;}).join(",")'));
  check('新结果的来源是上一个结果', (await ev('App.mg.results[1].from[0]')) === '销售汇总');
  check('sheet 被引用后打 ↻ 已引用',
    (await ev('document.querySelectorAll("#fileList .sheet .tag-ref").length')) >= 3,
    await ev('document.querySelectorAll("#fileList .sheet .tag-ref").length'));

  /* ---- 按列拆 ---- */
  await ev('App.mgTab("split")');
  await sleep(200);
  check('切到拆分标签', (await ev('App.mg.tab')) === 'split');
  check('未勾选就提示只处理 1 张表', /拆分一次只处理 1 张表/.test(await ev('document.getElementById("mgOps").innerText')));

  check('勾选「拆分用」', (await clickSheet('拆分用')) === 'ok');
  check('拆分的列下拉读出来了', await waitFor('document.querySelectorAll("#mgOps select option").length===2', 40000, 300),
    await ev('[].slice.call(document.querySelectorAll("#mgOps select option")).map(function(o){return o.textContent;}).join(",")'));
  await ev(`(()=>{ const s=document.querySelector('#mgOps select'); s.value='0'; s.dispatchEvent(new Event('change')); return true; })()`);
  await sleep(300);
  const prevCol = await ev('document.querySelector("#mgOps .mg-preview").innerText.replace(/\\s+/g," ")');
  console.log('   按列拆预览 =', prevCol);
  check('按列拆预览：份数 + 各组行数', /拆成 3 份/.test(prevCol) && /销售部（3 行）/.test(prevCol) && /技术部（2 行）/.test(prevCol) && /财务部（1 行）/.test(prevCol), prevCol);
  check('点「按列拆」', (await clickBtn('#mgOps', '按列拆')) === 'ok');
  check('按列拆出 3 个结果', await waitFor('App.mg.results.length===5', 60000, 300),
    await ev('App.mg.results.map(function(r){return r.name;}).join(",")'));
  const names5 = await ev('App.mg.results.map(function(r){return r.name;}).join(",")');
  check('拆分结果按值命名', /拆分用_销售部/.test(names5) && /拆分用_技术部/.test(names5) && /拆分用_财务部/.test(names5), names5);
  check('拆出的行数对得上', (await rowsOf(2)).length === 3 && (await rowsOf(3)).length === 2 && (await rowsOf(4)).length === 1,
    [(await rowsOf(2)).length, (await rowsOf(3)).length, (await rowsOf(4)).length].join(','));
  check('拆出的表带表头', (await ev('JSON.stringify(App.mg.results[2].table.header)')) === JSON.stringify(['部门', '金额']),
    await ev('JSON.stringify(App.mg.results[2].table.header)'));

  /* ---- 按行数拆 ---- */
  check('勾选「大表」', (await clickSheet('大表')) === 'ok');
  await waitFor('App.mg.caret && App.mg.caret.table', 40000, 300);
  await ev(`(()=>{ const i=document.querySelector('#mgOps input[type=text]'); i.value='10'; i.dispatchEvent(new Event('change')); return true; })()`);
  await sleep(300);
  const prevRowTxt = await ev('[].slice.call(document.querySelectorAll("#mgOps .mg-preview")).map(function(e){return e.innerText.replace(/\\s+/g," ");}).join(" || ")');
  console.log('   按行数拆预览 =', prevRowTxt.slice(0, 200));
  check('按行数拆预览：共几行 / 拆几份', /每 10 行一份，共 25 行，拆成 3 份/.test(prevRowTxt), prevRowTxt.slice(0, 120));
  check('点「按行数拆」', (await clickBtn('#mgOps', '按行数拆')) === 'ok');
  check('按行数拆出 3 个结果', await waitFor('App.mg.results.length===8', 60000, 300),
    await ev('App.mg.results.length'));
  check('按行数拆的行数 10 / 10 / 5', (await rowsOf(5)).length === 10 && (await rowsOf(6)).length === 10 && (await rowsOf(7)).length === 5,
    [(await rowsOf(5)).length, (await rowsOf(6)).length, (await rowsOf(7)).length].join(','));

  /* ---- 输出：一个文件（同源单表操作 → 原表 + 结果同文件） ---- */
  await ev('App.mg.results = [App.mg.results[5]]; App.mg.out = "one"; App.renderMg();');
  await sleep(250);
  const hintOne = await ev('document.getElementById("mgOutHint").innerText.replace(/\\s+/g," ")');
  console.log('   输出提示 =', hintOne);
  check('输出提示写明 原表 + 结果', /5 张原表 \+ 1 张结果/.test(hintOne), hintOne);
  const a2B64 = await ev(`App.mgOutputs().then(function(o){
    const u8 = new Uint8Array(o[0].data);
    let s=''; const CH=0x8000;
    for (let i=0;i<u8.length;i+=CH) s += String.fromCharCode.apply(null, u8.subarray(i,i+CH));
    return btoa(s);
  })`, true);
  const wbA2 = new E.Workbook();
  await wbA2.xlsx.load(Buffer.from(a2B64, 'base64'));
  const nmA2 = wbA2.worksheets.map((w) => w.name);
  console.log('   同源输出 sheet =', nmA2.join(','));
  check('单表拆的结果留在原表所在文件（原表 5 张 + 结果 1 张）', nmA2.length === 6 && nmA2[0] === '一表', nmA2.join(','));
  check('原表数据没被改写', String(wbA2.getWorksheet('一表').getCell('A2').value) === '张三');
  check('结果 sheet 带默认样式', wbA2.getWorksheet('大表_1').getCell('A1').fill?.fgColor?.argb === 'FFF2F2F2');

  /* ---- 输出：每个结果一个文件（两个结果同名 → 文件名要去重，不能互相覆盖） ---- */
  await ev('App.mg.results = [App.mg.results[0], App.mg.results[0]]; App.mg.results[1].name = App.mg.results[0].name; App.mg.out = "each"; App.renderMg();');
  await sleep(250);
  const outB = JSON.parse(await ev(`App.mgOutputs().then(function(o){ return JSON.stringify(o.map(function(x){ return {n:x.name, size:x.size}; })); })`, true));
  console.log('   输出 B =', outB.map((o) => o.n).join(', '));
  check('输出：每个结果一个文件', outB.length === 2 && outB.every((o) => /^大表_1.*\.xlsx$/.test(o.n)), outB.map((o) => o.n).join(','));
  check('两个结果同名 → 文件名自动去重', outB[0].n !== outB[1].n && outB[1].n === '大表_1_2.xlsx', outB.map((o) => o.n).join(','));
  const bB64 = await ev(`App.mgOutputs().then(function(o){
    const u8 = new Uint8Array(o[0].data);
    let s=''; const CH=0x8000;
    for (let i=0;i<u8.length;i+=CH) s += String.fromCharCode.apply(null, u8.subarray(i,i+CH));
    return btoa(s);
  })`, true);
  const wbB = new E.Workbook();
  await wbB.xlsx.load(Buffer.from(bB64, 'base64'));
  check('每个文件里只有 1 张表', wbB.worksheets.length === 1, wbB.worksheets.map((w) => w.name).join(','));

  /* ---- 勾选顺序 = 列顺序 ---- */
  await ev('App.mg.results = []; App.mg.seq = 0; App.mg.added = {}; App.render();');
  await sleep(200);
  check('清理干净后重新勾选', (await clickSheet('二表')) === 'ok' && (await clickSheet('一表')) === 'ok');
  await sleep(250);
  await ev('App.mgDoMerge()');
  await waitFor('App.mg.results.length===1', 60000, 300);
  check('列顺序 = 勾选顺序（先勾二表 → 部门 在前）',
    (await ev('App.mg.results[0].table.header[0]')) === '部门', await ev('JSON.stringify(App.mg.results[0].table.header)'));

  /* ---- 各自保留 ---- */
  await ev('App.mg.results = []; App.mg.seq = 90; App.mg.added = {}; App.mg.sel = []; App.render();');
  await sleep(200);
  await ev('App.mgTab("merge")');   // 上一步切到了拆分标签，这里必须切回合并才有「各自保留」
  await sleep(200);
  check('切回合并标签', (await ev('App.mg.tab')) === 'merge');
  check('勾选两张表准备「各自保留」', (await clickSheet('大表')) === 'ok' && (await clickSheet('拆分用')) === 'ok');
  await sleep(250);
  const keepBtn = await clickBtn('#mgOps', '各自保留');
  check('点「各自保留」', keepBtn === 'ok', keepBtn);
  check('各自保留 → 2 个结果', await waitFor('App.mg.results.length===2', 60000, 300),
    await ev('App.mg.results.map(function(r){return r.op+":"+r.name;}).join(",")'));
  check('各自保留不动数据（行数一致）', (await rowsOf(0)).length === 25 && (await rowsOf(1)).length === 6,
    [(await rowsOf(0)).length, (await rowsOf(1)).length].join(','));

  /* ---- 空表 / 单表边界 ---- */
  await ev('App.mg.results = []; App.mg.sel = []; App.render();');
  await sleep(200);
  check('没有结果时下载按钮灰着', (await ev('document.getElementById("mgOut").querySelector("button").disabled')) === true);
  check('没有结果时输出提示不报错', /还没有结果/.test(await ev('document.getElementById("mgOutHint").innerText')));

  await ev('App.switchMode("clean")');
  await sleep(300);
  check('切回清洗：合并区收起，清洗区恢复',
    (await ev('getComputedStyle(document.getElementById("mergeArea")).display')) === 'none' &&
    ((await ev('getComputedStyle(document.getElementById("reportArea")).display')) !== 'none' ||
      (await ev('getComputedStyle(document.getElementById("summaryArea")).display')) !== 'none'));

  /* ============================================================
     第三组 · 匹配对比
     ============================================================ */
  console.log('\n--- 匹配对比 ---');
  async function makeMatchSrc() {
    const wb = new E.Workbook();
    const a = wb.addWorksheet('人员A');
    a.addRow(['工号', '姓名', '金额']);
    a.addRow(['A001', '张三', 100]);
    a.addRow([' A002 ', '李四', 200]);      // 首尾空格 → 键要能对上
    a.addRow(['Ａ００３', '王五', 300]);     // 全角 → 键要能对上
    a.addRow(['a004', '赵六', 400]);        // 小写 → 只在 A 有

    const b = wb.addWorksheet('人员B');
    b.addRow(['工号', '部门', '金额']);
    b.addRow(['A001', '销售部', 100]);       // 与 A 的 A001 金额相同 → 不该进「找差异」
    b.addRow(['A002', '技术部', 222]);
    b.addRow(['A003', '财务部', 333]);
    b.addRow(['A005', '人事部', 555]);       // 只在 B 有

    const d = wb.addWorksheet('明细');
    d.addRow(['产品', '月份', '数量']);
    [['甲', '1月', 10], ['甲', '2月', 20], ['甲', '1月', 5], ['乙', '1月', 7], ['乙', '2月', 3], ['丙', '2月', 1]]
      .forEach((r) => d.addRow(r));
    return Buffer.from(await wb.xlsx.writeBuffer());
  }
  const mtT = async (i) => JSON.parse(await ev(
    `JSON.stringify({h:App.mt.results[${i}].table.header,r:App.mt.results[${i}].table.rows,m:App.mt.results[${i}].name,info:App.mt.results[${i}].info})`));
  // 读预览文本：缺元素时给空串，免得级联失败变成一个看不懂的 TypeError
  const txt = async (sel) => await ev(`(document.querySelector(${JSON.stringify(sel)})||{innerText:""}).innerText.replace(/\\s+/g," ")`);
  const resetMt = "App.mt.results=[];App.mt.seq=0;App.mt.added={};App.mt.sel=[];App.mtSync();App.render();";

  await ev('App.switchMode("match")');
  await sleep(350);
  check('切到匹配对比：三块 + 输出区都在',
    (await ev('!!document.getElementById("matchArea")')) === true &&
    (await ev('getComputedStyle(document.getElementById("mtSeg")).display')) !== 'none' &&
    (await ev('!!document.getElementById("mtOut")')) === true);
  check('操作区四个入口：横拼 / 找差异 / 汇总 / 交叉汇总',
    (await ev('App.mt.tab')) === 'join' &&
    (await ev('[].slice.call(document.querySelectorAll("#mtSeg .seg-btn")).map(function(b){return b.textContent.trim();}).join(",")')) === '横拼,找差异,汇总,交叉汇总',
    await ev('[].slice.call(document.querySelectorAll("#mtSeg .seg-btn")).map(function(b){return b.textContent.trim();}).join(",")'));

  await upFile(await makeMatchSrc(), '匹配源.xlsx');
  const okM = await waitFor('App.files.length===3 && App.files[2].state!=="reading"', 40000);
  check('第三份文件读入（三组共用同一批文件）', okM,
    await ev('App.files.map(function(f){return f.name+":"+f.sheets.length;}).join(" | ")'));
  check('来源树列出 9 张 sheet', (await ev('document.querySelectorAll("#fileList .sheet").length')) === 9,
    await ev('document.querySelectorAll("#fileList .sheet").length'));

  /* ---- 按列横拼 ---- */
  check('勾选「人员A」', (await clickSheet('人员A')) === 'ok');
  check('勾选「人员B」', (await clickSheet('人员B')) === 'ok');
  check('两张表都读出表头了', await waitFor('Object.keys(App.mt.tables).length===2', 40000, 300),
    await ev('Object.keys(App.mt.tables).join(",")'));
  const KEYSEL = `App.mt.sel.map(function(r){var c=App.mt.cfg[r.key];return c?c.keys.map(function(i){return window.ShadeMarkExcelMatch.labelOf(App.mt.tables[r.key],i);}).join("+"):"?";}).join("|")`;
  check('键列自动猜出来（工号）', (await ev(KEYSEL)) === '工号|工号', await ev(KEYSEL));
  const pvJoin = await txt('#mtOps .mg-preview');
  console.log('   横拼预览 =', pvJoin);
  check('横拼预览：几个表 / 按键 / 共几列', /2 个表按 工号 对齐/.test(pvJoin) && /共 5 列/.test(pvJoin), pvJoin);
  check('键列 chip 高亮', (await ev('document.querySelectorAll("#mtOps .chip.on.key").length')) === 2,
    await ev('document.querySelectorAll("#mtOps .chip.on.key").length'));
  check('贴的列默认全贴（除键列）', (await ev('document.querySelectorAll("#mtOps .chip.on").length')) === 6,
    await ev('document.querySelectorAll("#mtOps .chip.on").length'));

  await clickBtn('#mtOps', '按列横拼');
  check('横拼出 1 个结果', await waitFor('App.mt.results.length===1', 60000, 300),
    await ev('App.mt.results.length'));
  const J1 = await mtT(0);
  console.log('   横拼表头 =', J1.h.join(' │ '));
  J1.r.forEach((r, i) => console.log('   ' + (i + 1) + ' | ' + r.map((v) => v === null ? '' : v).join(' │ ')));
  check('横拼：键列合并成一列（工号）', J1.h[0] === '工号', J1.h.join(','));
  check('横拼：重名列自动加表名前缀', J1.h.indexOf('人员A·金额') >= 0 && J1.h.indexOf('人员B·金额') >= 0, J1.h.join(','));
  check('横拼：空格 / 全角 / 大小写都算同一个键（5 行全留）', J1.r.length === 5, J1.r.length);
  check('横拼：A001 两侧都贴上', J1.r[0][0] === 'A001' && J1.r[0][1] === '张三' && J1.r[0][3] === '销售部', JSON.stringify(J1.r[0]));
  check('横拼：只在一边有的留空（A005 独有）',
    !!J1.r.find((r) => String(r[0]).indexOf('A005') >= 0 && r[1] === null && r[3] === '人事部'),
    JSON.stringify(J1.r));
  check('横拼：结果区带变更摘要（键 / 对齐数）', J1.info.length >= 1 && /工号/.test(J1.info[0]), JSON.stringify(J1.info));
  check('横拼后勾选自动清空', (await ev('App.mt.sel.length')) === 0);

  /* ---- 输出：多表操作 → 单独一个新文件 ---- */
  const om = JSON.parse(await ev(`App.mgOutputs().then(function(o){ return JSON.stringify(o.map(function(x){ return {n:x.name,size:x.size}; })); })`, true));
  console.log('   输出 =', om.map((o) => o.n + '(' + o.size + 'B)').join(', '));
  check('匹配对比结果单独一个文件', om.length === 1 && om[0].n === '匹配对比结果.xlsx', om.map((o) => o.n).join(','));
  const omB64 = await ev(`App.mgOutputs().then(function(o){
    const u8 = new Uint8Array(o[0].data); let s=''; const CH=0x8000;
    for (let i=0;i<u8.length;i+=CH) s += String.fromCharCode.apply(null, u8.subarray(i,i+CH));
    return btoa(s);
  })`, true);
  const wbM = new E.Workbook();
  await wbM.xlsx.load(Buffer.from(omB64, 'base64'));
  check('新文件里只有结果、原表不掺进来', wbM.worksheets.length === 1, wbM.worksheets.map((w) => w.name).join(','));
  const wsM = wbM.worksheets[0];
  check('结果表头套上默认样式',
    wsM.getCell('A1').font?.bold === true && wsM.getCell('A1').fill?.fgColor?.argb === 'FFF2F2F2' &&
    wsM.getCell('A1').font?.color?.argb === 'FF2B2926' && wsM.getCell('A1').border?.bottom?.style === 'thin' &&
    wsM.views?.[0]?.state === 'frozen');
  check('结果列宽 ≤ 40', wsM.columns.every((c) => !c.width || c.width <= 40), wsM.columns.map((c) => c.width).join(','));
  check('正文未加粗', wsM.getCell('A2').font?.bold !== true);

  /* ---- 结果送回来源树 ---- */
  await ev('App.mgUse(' + (await ev('App.mt.results[0].id')) + ')');
  await sleep(300);
  const treeTxtM = await ev('document.getElementById("resTree").innerText.replace(/\\s+/g," ")');
  check('匹配结果也能送回来源树', /横拼_2表/.test(treeTxtM) && /来自 人员A/.test(treeTxtM), treeTxtM.slice(0, 90));
  check('结果区标 ↻ 已引用', /已引用/.test(await ev('document.getElementById("mtResList").innerText')));

  /* ---- 结果再处理（级联）：对横拼结果做汇总 ---- */
  await ev('document.querySelector("#resTree .tree-node input[type=checkbox]").click()');
  await sleep(400);
  await ev('App.mtTab("sum")');
  await sleep(200);
  check('切到汇总：读到结果表', await waitFor('Object.keys(App.mt.tables).length===1', 40000, 300),
    await ev('Object.keys(App.mt.tables).join(",")'));
  await ev('App.mtSetSum("group",0); App.mtSetSum("value",2); App.mtSetSumAgg("sum");');
  await sleep(250);
  const pvSum = await txt('#mtOps .mg-preview');
  console.log('   汇总预览 =', pvSum);
  check('汇总预览：分组 / 聚合 / 出几行', /按 工号 分组/.test(pvSum) && /人员A·金额/.test(pvSum) && /出 5 行/.test(pvSum), pvSum);
  await clickBtn('#mtOps', '汇总');
  check('级联汇总出第 2 个结果', await waitFor('App.mt.results.length===2', 60000, 300),
    await ev('App.mt.results.map(function(r){return r.opLabel+"|"+r.name;}).join(",")'));
  const S1 = await mtT(1);
  console.log('   级联汇总 =', S1.h.join(' │ '), JSON.stringify(S1.r));
  check('级联结果来源是上一个结果', /横拼_2表/.test(S1.info[0] || '') || (await ev('App.mt.results[1].from[0]')).indexOf('横拼') >= 0,
    await ev('JSON.stringify(App.mt.results[1].from)'));
  check('级联汇总：5 组各 1 个数', S1.r.length === 5 && S1.h.length === 2, S1.r.length + ' 行');

  /* ---- 找差异 ---- */
  await ev(resetMt);
  await sleep(250);
  check('清干净后重新勾选', (await clickSheet('人员A')) === 'ok' && (await clickSheet('人员B')) === 'ok');
  await ev('App.mtTab("diff")');
  await sleep(300);
  await waitFor('Object.keys(App.mt.tables).length===2', 40000, 300);
  const pvDiff = await txt('#mtOps .mg-preview');
  console.log('   找差异预览 =', pvDiff);
  check('找差异预览：三类条数（A 独有 1 / B 独有 1 / 值不同 2）',
    /只在 A 有 1 行/.test(pvDiff) && /只在 B 有 1 行/.test(pvDiff) && /都有但值不同 2 行/.test(pvDiff), pvDiff);
  await clickBtn('#mtOps', '找差异');
  check('找差异出 1 个结果', await waitFor('App.mt.results.length===1', 60000, 300), await ev('App.mt.results.length'));
  const D1 = await mtT(0);
  console.log('   差异表头 =', D1.h.join(' │ '));
  D1.r.forEach((r, i) => console.log('   ' + (i + 1) + ' | ' + r.map((v) => v === null ? '' : v).join(' │ ')));
  check('找差异：一张带标记的表，不是三张', D1.h[D1.h.length - 1] === '差异类型' && D1.h.indexOf('人员A·金额') >= 0 && D1.h.indexOf('人员B·金额') >= 0, D1.h.join(','));
  check('找差异：三类都在', D1.r.filter((r) => r[r.length - 1] === '只在A有').length === 1 &&
    D1.r.filter((r) => r[r.length - 1] === '只在B有').length === 1 &&
    D1.r.filter((r) => r[r.length - 1] === '都有但值不同').length === 2,
    JSON.stringify(D1.r.map((r) => r[r.length - 1])));
  check('找差异：完全一致的行不进结果（A001 不在）', !D1.r.some((r) => String(r[0]) === 'A001'),
    JSON.stringify(D1.r.map((r) => r[0])));
  check('找差异：只在A有那条是 a004 且 B 侧留空',
    !!D1.r.find((r) => r[r.length - 1] === '只在A有' && String(r[0]) === 'a004' && r[4] === null),
    JSON.stringify(D1.r.find((r) => r[r.length - 1] === '只在A有')));

  /* ---- 简单汇总：三种算法 ---- */
  await ev(resetMt);
  await sleep(250);
  check('勾选「明细」', (await clickSheet('明细')) === 'ok');
  await ev('App.mtTab("sum")');
  await sleep(200);
  check('读到明细表', await waitFor('Object.keys(App.mt.tables).length===1', 40000, 300));
  await ev('App.mtSetSum("group",0); App.mtSetSum("value",2);');
  await sleep(200);
  const SUMCHK = { sum: [35, 10, 1], count: [3, 2, 1], avg: [11.666667, 5, 1] };
  for (const agg of ['sum', 'count', 'avg']) {
    await ev(`App.mtSetSumAgg("${agg}"); App.mtDoSum();`);
    await waitFor('App.mt.results.length===1', 60000, 300);
    const S = await mtT(0);
    const vals = S.r.map((r) => r[1]);
    console.log('   汇总 ' + agg + ' =', S.h.join(' │ '), JSON.stringify(S.r));
    check('汇总 ' + agg + '：甲/乙/丙 = ' + JSON.stringify(SUMCHK[agg]),
      JSON.stringify(vals) === JSON.stringify(SUMCHK[agg]), JSON.stringify(vals));
    check('汇总 ' + agg + '：表头写明算法', new RegExp(agg === 'sum' ? '求和' : agg === 'count' ? '计数' : '平均').test(S.h[1]), S.h[1]);
    await ev(resetMt);
    await sleep(150);
    await clickSheet('明细');
    await waitFor('App.mt.sel.length===1 && Object.keys(App.mt.tables).length===1', 40000, 300);
  }

  /* ---- 交叉汇总 ---- */
  await ev(resetMt);
  await sleep(250);
  await clickSheet('明细');
  await waitFor('App.mt.sel.length===1 && Object.keys(App.mt.tables).length===1', 40000, 300);
  await ev('App.mtTab("cross")');
  await sleep(250);
  check('交叉汇总：三个下拉读出来', await waitFor('document.querySelectorAll("#mtOps select").length===4', 40000, 300),
    await ev('document.querySelectorAll("#mtOps select").length'));
  await ev('App.mtSetCross("row",0); App.mtSetCross("col",1); App.mtSetCross("value",2); App.mtSetCrossAgg("sum"); App.mtSetCrossFlag("sub",true); App.mtSetCrossFlag("total",true);');
  await sleep(300);
  const pvX = await txt('#mtOps .mg-preview');
  console.log('   交叉预览 =', pvX);
  check('交叉预览：行 / 列 / 值 / 矩阵形状', /行 = 产品（3）/.test(pvX) && /列 = 月份（2）/.test(pvX) && /3×2/.test(pvX) && /带小计/.test(pvX) && /带总计/.test(pvX), pvX);
  await clickBtn('#mtOps', '生成矩阵');
  check('交叉汇总出 1 个结果', await waitFor('App.mt.results.length===1', 60000, 300), await ev('App.mt.results.length'));
  const X1 = await mtT(0);
  console.log('   交叉表头 =', X1.h.join(' │ '));
  X1.r.forEach((r, i) => console.log('   ' + (i + 1) + ' | ' + r.map((v) => v === null ? '' : v).join(' │ ')));
  check('交叉：表头 = 行＼列 + 两个列值 + 小计', X1.h[0].indexOf('产品') >= 0 && X1.h[0].indexOf('月份') >= 0 && X1.h[1] === '1月' && X1.h[2] === '2月' && X1.h[3] === '小计', X1.h.join('|'));
  check('交叉：甲 = 15 / 20 / 35', JSON.stringify(X1.r[0]) === JSON.stringify(['甲', 15, 20, 35]), JSON.stringify(X1.r[0]));
  check('交叉：丙只出现在 2月（1月留空）', X1.r[2][1] === null && X1.r[2][2] === 1, JSON.stringify(X1.r[2]));
  check('交叉：小计行 22 / 24 / 46', JSON.stringify(X1.r[3]) === JSON.stringify(['小计', 22, 24, 46]), JSON.stringify(X1.r[3]));
  check('交叉：总计行只补右下角 46', X1.r[4][0] === '总计' && X1.r[4][3] === 46 && X1.r[4][1] === null, JSON.stringify(X1.r[4]));

  /* ---- 交叉汇总的结果写到 Excel：行标题列也当表头 ---- */
  const xB64 = await ev(`App.mgOutputs().then(function(o){
    const u8 = new Uint8Array(o[0].data); let s=''; const CH=0x8000;
    for (let i=0;i<u8.length;i+=CH) s += String.fromCharCode.apply(null, u8.subarray(i,i+CH));
    return btoa(s);
  })`, true);
  const wbX = new E.Workbook();
  await wbX.xlsx.load(Buffer.from(xB64, 'base64'));
  const wsX = wbX.worksheets[0];
  check('交叉汇总：表头 + 行标题列都套了默认样式（加粗 + F2F2F2）',
    wsX.getCell('A1').fill?.fgColor?.argb === 'FFF2F2F2' && wsX.getCell('A1').font?.bold === true &&
    wsX.getCell('A2').fill?.fgColor?.argb === 'FFF2F2F2' && wsX.getCell('A2').font?.bold === true &&
    wsX.getCell('A2').font?.color?.argb === 'FF2B2926',
    JSON.stringify([wsX.getCell('A2').fill?.fgColor?.argb, wsX.getCell('A2').font?.bold]));
  check('交叉汇总：正文数字格没被套样式', wsX.getCell('B2').fill === undefined || wsX.getCell('B2').fill?.fgColor === undefined,
    JSON.stringify(wsX.getCell('B2').fill));
  check('交叉汇总：行标题列列宽自适应 ≤ 40', (wsX.getColumn(1).width || 0) <= 40, wsX.getColumn(1).width);

  /* ---- 边界 ---- */
  await ev(resetMt);
  await sleep(250);
  await ev('App.mtTab("join")');
  await sleep(200);
  await clickSheet('明细');
  await sleep(250);
  check('横拼只勾 1 张表 → 提示 + 不给按钮',
    /先勾至少 2 张表/.test(await ev('document.getElementById("mtOps").innerText')) &&
    (await ev('document.querySelectorAll("#mtOps button.btn").length')) === 0,
    await ev('document.getElementById("mtOps").innerText.replace(/\\s+/g," ").slice(0,60)'));
  await ev('App.mtTab("diff")');
  await sleep(250);
  check('找差异只勾 1 张 → 提示正好 2 张', /正好 2 张/.test(await ev('document.getElementById("mtOps").innerText')));
  await clickSheet('人员A');
  await sleep(200);
  await clickSheet('人员B');
  await sleep(250);
  check('找差异勾 3 张 → 明确说只支持 2 张', /只支持 2 张表/.test(await ev('document.getElementById("mtOps").innerText')),
    await ev('document.getElementById("mtOps").innerText.replace(/\\s+/g," ").slice(0,80)'));

  /* ---- 切回前两组，确认没被碰坏 ---- */
  await ev('App.switchMode("merge")');
  await sleep(400);
  check('切回合并拆分：第二组仍正常',
    (await ev('getComputedStyle(document.getElementById("mergeArea")).display')) !== 'none' &&
    (await ev('getComputedStyle(document.getElementById("matchArea")).display')) === 'none' &&
    (await ev('document.querySelectorAll("#mgSeg .seg-btn").length')) === 2);
  check('第二组结果区与第三组互不串（各自一份状态）',
    (await ev('App.mg.results !== App.mt.results && App.mg.sel !== App.mt.sel')) === true &&
    (await ev('App.mg.results.length')) === 0,
    'mg=' + (await ev('App.mg.results.length')) + ' / mt=' + (await ev('App.mt.results.length')));
  await ev('App.switchMode("clean")');
  await sleep(300);
  check('切回清洗：三块区域都收起',
    (await ev('getComputedStyle(document.getElementById("matchArea")).display')) === 'none' &&
    (await ev('getComputedStyle(document.getElementById("mergeArea")).display')) === 'none');

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

  /* ---- 顶栏登录闸门：发码 / 短链（必须与其他页面同一套弹窗，别另起一套） ---- */
  const cardSpec = `(()=>{const e=document.querySelector('#authModal .modal-card');if(!e)return 'none';const s=getComputedStyle(e);const im=e.querySelector('input[type=email]');const is=im?getComputedStyle(im):null;const tb=e.querySelector('.tab');const ts=tb?getComputedStyle(tb):null;return [s.maxWidth,s.paddingTop,s.borderRadius,s.backgroundColor,is?is.minHeight:'-',ts?ts.borderRadius:'-'].join('|');})()`;
  const authSig = `(()=>['modal-card','modal-head','tabs','tab','modal-close','auth-submit','auth-tip','auth-forgot'].filter(c=>document.querySelector('#authModal .'+c)).join(','))()`;
  async function goto(p, marker) {
    await send('Page.navigate', { url: BASE + p });
    await waitFor(`location.pathname===${JSON.stringify(p)} && document.readyState==='complete'`, 25000);
    if (marker) await waitFor(marker, 25000);
    await sleep(600);
  }

  await ev(`document.querySelector('.nav-tools a[href="/admin"]').click()`);
  await sleep(450);
  check('未登录点「发码」→ 弹全站统一登录框（不直接跳走）',
    (await ev('document.getElementById("authModal").classList.contains("active")')) === true,
    await ev('document.getElementById("authModal").className'));
  check('用的就是首页/报价单那套模板（modal-card + modal-head + tabs + ×）',
    (await ev('!!document.querySelector("#authModal .modal-card.auth .modal-head .tabs .tab#tabLogin")')) === true &&
    (await ev('!!document.querySelector("#authModal .modal-card.auth .modal-head #authCloseBtn")')) === true);
  const excelCard = await ev(cardSpec);
  check('登录卡片规格 = 380 / 24 / 12（与其他页同为 modal-card）',
    excelCard === '380px|24px|12px|rgb(23, 23, 27)|44px|8px', excelCard);
  check('默认登录态：注册字段收起 + 按钮「登录」',
    (await ev('document.getElementById("tabLogin").classList.contains("active")&&getComputedStyle(document.getElementById("authNameWrap")).display==="none"&&document.getElementById("authSubmitBtn").textContent==="登录"')) === true);
  await ev('document.getElementById("tabRegister").click()');
  await sleep(250);
  check('切「注册」：昵称/联系方式出现 + 按钮变「注册」',
    (await ev('getComputedStyle(document.getElementById("authNameWrap")).display!=="none"&&getComputedStyle(document.getElementById("authContactWrap")).display!=="none"&&document.getElementById("authSubmitBtn").textContent==="注册"')) === true);
  await ev('document.getElementById("authCloseBtn").click()');
  await sleep(250);
  check('右上角 × 能关掉', (await ev('document.getElementById("authModal").classList.contains("active")')) === false);

  await ev(`document.querySelector('.nav-tools a[href="/links"]').click()`);
  await sleep(350);
  check('未登录点「短链」→ 同样弹统一登录框', (await ev('document.getElementById("authModal").classList.contains("active")')) === true);
  await ev(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}))`);
  await sleep(250);
  check('Esc 能关掉', (await ev('document.getElementById("authModal").classList.contains("active")')) === false);

  /* 与「水印」页同一入口做真实对照 */
  await goto('/watermark', `!!document.querySelector('.nav-tools a[data-gate]')`);
  await ev(`document.querySelector('.nav-tools a[href="/admin"]').click()`);
  await sleep(450);
  const wmCard = await ev(cardSpec);
  check('水印页同一入口的卡片规格完全一致', wmCard === excelCard, wmCard + '  vs  ' + excelCard);
  const wmSig = await ev(authSig);
  check('两页弹窗 DOM 结构一致', wmSig === 'modal-card,modal-head,tabs,tab,modal-close,auth-submit,auth-tip,auth-forgot', wmSig);

  if (!LIVE) {
    /* 已登录 → 不弹窗直接进；未登录提交登录后跳回原目标 */
    MOCK_SESSION = { authenticated: true };
    await goto('/excel', `typeof window.App==="object" && !!document.getElementById("authModal")`);
    await ev(`document.querySelector('.nav-tools a[href="/admin"]').click()`);
    await sleep(800);
    check('已登录点「发码」→ 不弹窗，直接跳 /admin',
      (await ev('location.pathname')) === '/admin' && (await ev('!!document.getElementById("authModal")')) === false,
      await ev('location.pathname'));

    MOCK_SESSION = { authenticated: false };
    await goto('/excel', `typeof window.App==="object" && !!document.getElementById("authModal")`);
    await ev(`document.querySelector('.nav-tools a[href="/links"]').click()`);
    await sleep(350);
    /* 先验失败分支：接口报错要显示在弹窗里，且不跳走 */
    MOCK_LOGIN = { error: '邮箱或密码不正确' };
    await ev(`(()=>{document.getElementById('authEmail').value='e2e@example.com';document.getElementById('authPass').value='wrongpass';document.getElementById('authSubmitBtn').click();return true;})()`);
    await sleep(1200);
    check('登录失败：错误显示在弹窗内且不跳走',
      (await ev('document.getElementById("authError").textContent')) === '邮箱或密码不正确' &&
      (await ev('getComputedStyle(document.getElementById("authError")).display')) !== 'none' &&
      (await ev('document.getElementById("authModal").classList.contains("active")')) === true &&
      (await ev('location.pathname')) === '/excel',
      await ev('document.getElementById("authError").textContent'));
    /* 再验成功分支：跳回原目标 */
    MOCK_LOGIN = MOCK_LOGIN_OK;
    await ev(`document.getElementById('authSubmitBtn').click()`);
    await sleep(1800);
    check('登录提交成功后跳回原目标 /links', (await ev('location.pathname')) === '/links', await ev('location.pathname'));
  }

  check('全程无 JS 报错', errs.length === 0, errs.slice(0, 3).join(' | '));
} catch (e) {
  console.log('FATAL', e.message);
  failed++;
} finally {
  console.log(`\n=== ${failed === 0 ? '全部通过' : failed + ' 项失败'} / 共 ${results.length + (failed && !results.length ? 1 : 0)} 项 ===`);
  try { ws.close(); } catch {}
  try { child.kill(); } catch {}
  if (server) server.close();
  process.exit(failed === 0 ? 0 : 1);
}
