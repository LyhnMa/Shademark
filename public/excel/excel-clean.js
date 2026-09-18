/*!
 * ShadeMark · Excel 清洗引擎
 * ------------------------------------------------------------------
 * 纯数据处理层，不碰 DOM。既能在浏览器里用（window.ShadeMarkExcelClean），
 * 也能在 Node 里 require 做回归测试。
 *
 * 输入：已由 exceljs 载入的 workbook / worksheet（原对象不被改写）
 * 输出：新增清洗结果 sheet + 对文件做瘦身 + 一份统计/样本
 *
 * 顺序定死：不可见字符 → 全角转半角 → 空格换行 → 超链接 → 文本型数字
 *          → 日期 → 去重 → 瘦身
 * （规格里的顺序表少了「不可见字符」，但它在报告里是第一项，故排在最前。）
 */
(function (root, factory) {
  if (typeof module === 'object' && typeof module.exports === 'object') module.exports = factory();
  else root.ShadeMarkExcelClean = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var VERSION = '1.0.0';

  /* ============================ 常量 ============================ */

  var MAX_SAMPLES = 200;          // 每项最多保留多少条样本（计数仍为真实值）
  var SAMPLE_TEXT_MAX = 60;       // 样本里单个值的显示长度上限
  var COL_WIDTH_CAP = 40;         // 列宽上限
  var COL_WIDTH_MIN = 6;
  var MAX_COL_SCAN = 1024;        // 隐藏列扫描上限

  // 只删真垃圾：CHAR(160) 不换行空格、零宽字符、BOM
  var INVISIBLE_RE = /[\u00A0\u180E\u200B\u200C\u200D\u2060\uFEFF]/g;

  // 空白 = 空格类 | 换行类。显式列举，不用 \s（JS 的 \s 含 \uFEFF，语义会串）
  var WS_CLS = '[\\u0009\\u0020\\u2000-\\u200A\\u202F\\u205F\\u3000]';
  var NL_CLS = '[\\u000A\\u000D\\u000B\\u000C]';
  var RUN_RE = new RegExp('(?:' + WS_CLS + '|' + NL_CLS + ')+', 'g');
  var EDGE_RE = new RegExp('^(?:' + WS_CLS + '|' + NL_CLS + ')+|(?:' + WS_CLS + '|' + NL_CLS + ')+$', 'g');
  var HAS_NL_RE = /[\u000A\u000B\u000C]/;

  // 全角转半角时排除的中文标点（同一码位，不能转）
  var FW_EXCLUDE = { 0xFF01: 1, 0xFF08: 1, 0xFF09: 1, 0xFF0C: 1, 0xFF1A: 1, 0xFF1B: 1, 0xFF1F: 1, 0xFF5E: 1 };

  var DEFAULT_KEYWORDS = [
    '身份证', '证件号', '手机', '电话', '联系方式', '订单号', '单号',
    '银行卡', '卡号', '账号', '编号', '工号', '邮编'
  ];

  var NUM_RE = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/;
  var YMD_RE = /^(\d{4})[-\/.年](\d{1,2})[-\/.月](\d{1,2})日?$/;
  var AMB_RE = /^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})$/;

  var DATE_FORMATS = [
    { key: 'ymd-dash', numFmt: 'yyyy-mm-dd', label: '2026-09-17' },
    { key: 'ymd-slash', numFmt: 'yyyy/mm/dd', label: '2026/09/17' },
    { key: 'ymd-cn', numFmt: 'yyyy"年"mm"月"dd"日"', label: '2026年09月17日' }
  ];

  // 报告项定义（顺序即显示顺序）
  var ITEMS = [
    { group: 'clean', key: 'invisible', label: '看不见的字符', unit: '处', def: true },
    { group: 'clean', key: 'spaces', label: '多余的空格和换行', unit: '处', def: true },
    { group: 'clean', key: 'hyperlink', label: '文字里夹带的超链接', unit: '处', def: true },
    { group: 'clean', key: 'dupes', label: '重复的行', unit: '行', def: false, confirm: true },
    { group: 'unify', key: 'fullwidth', label: '全角符号', unit: '处', def: true },
    { group: 'unify', key: 'textnum', label: '文本型数字', unit: '处', def: true },
    { group: 'unify', key: 'date', label: '日期格式不一', unit: '处', def: false, confirm: true },
    { group: 'slim', key: 'names', label: '命名范围', unit: '个', def: false },
    { group: 'slim', key: 'hidden', label: '隐藏行列', unit: '', def: true, option: true },
    { group: 'slim', key: 'notes', label: '批注', unit: '处', def: true, option: true }
  ];

  var GROUP_LABEL = {
    clean: ['清理内容', '把单元格里不该有的东西清掉'],
    unify: ['统一格式', '把同一类东西的不同写法归到一起'],
    slim: ['文件瘦身', '让文件变小']
  };

  /* ========================== 小工具 ========================== */

  function newStats() {
    var c = {};
    ITEMS.forEach(function (it) { c[it.key] = 0; });
    c.outRows = 0;   // 范围外行列：自动清，不进报告
    c.outCols = 0;
    return c;
  }

  function newSamples() {
    var s = {};
    ITEMS.forEach(function (it) { s[it.key] = []; });
    return s;
  }

  function push(samples, key, rec) {
    var a = samples[key];
    if (a && a.length < MAX_SAMPLES) a.push(rec);
  }

  // 样本是给人看的：看不见的字符必须显形，否则「BOM 清除」在界面上看起来毫无变化。
  // 同时把行首/行尾空格、连续 2 个以上空格显形——HTML 里连续空格会被折叠，不显形就看不到差异。
  var VIS_MAP = {
    '\u00A0': '⟨NBSP⟩', '\u200B': '⟨ZWSP⟩', '\u200C': '⟨ZWNJ⟩', '\u200D': '⟨ZWJ⟩',
    '\u2060': '⟨WJ⟩', '\uFEFF': '⟨BOM⟩', '\u180E': '⟨MVS⟩', '\u3000': '⟨全角空格⟩'
  };

  function vis(s) {
    s = String(s == null ? '' : s);
    s = s.replace(/[\u00A0\u180E\u200B\u200C\u200D\u2060\uFEFF\u3000]/g, function (c) { return VIS_MAP[c] || c; });
    s = s.replace(/\u0009/g, '⇥')
         .replace(/[\u000A\u000B\u000C]/g, '⏎')
         .replace(/\u000D/g, '');
    s = s.replace(/ {2,}/g, function (m) { return m.replace(/ /g, '␣'); });
    s = s.replace(/^ /, '␣').replace(/ $/, '␣');
    return s;
  }

  function clip(s) {
    s = vis(s);
    return s.length > SAMPLE_TEXT_MAX ? s.slice(0, SAMPLE_TEXT_MAX) + '…' : s;
  }

  function display(v) {
    if (v === null || v === undefined) return '';
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    if (typeof v === 'object') {
      if (v.richText) return v.richText.map(function (r) { return r.text; }).join('');
      if (v.text !== undefined) return String(v.text);
      if (v.formula) return '=' + v.formula;
      if (v.error) return String(v.error);
      try { return JSON.stringify(v); } catch (e) { return String(v); }
    }
    return String(v);
  }

  /* ====================== 文本清洗原语 ====================== */

  // 全角 → 半角（只动数字、字母、英文标点；中文标点原样）
  function toHalfwidth(s) {
    var out = '';
    var hit = false;
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c >= 0xFF01 && c <= 0xFF5E && !FW_EXCLUDE[c]) { out += String.fromCharCode(c - 0xFEE0); hit = true; }
      else out += s.charAt(i);
    }
    return hit ? out : s;
  }

  // 首尾去、中间连续 2 个及以上压成 1 个；空格与换行同一套逻辑
  // （一整段空白里只要含换行，就压成一个换行；纯空格类压成一个空格）
  function normalizeSpace(s) {
    var t = s.replace(/\u000D\u000A?/g, '\n');
    t = t.replace(RUN_RE, function (m) { return HAS_NL_RE.test(m) ? '\n' : ' '; });
    t = t.replace(EDGE_RE, '');
    return t;
  }

  function stripInvisible(s) {
    INVISIBLE_RE.lastIndex = 0;
    return s.replace(INVISIBLE_RE, '');
  }

  /* ====================== 单元格取值 ====================== */

  // 返回 {kind, text|num|bool|date, raw}
  function readCell(cell) {
    var v = cell.value;
    if (v === null || v === undefined) return null;
    if (v instanceof Date) return { kind: 'date', date: v, raw: v };
    if (typeof v === 'string') return { kind: 'string', text: v, raw: v };
    if (typeof v === 'number') return { kind: 'number', num: v, raw: v };
    if (typeof v === 'boolean') return { kind: 'bool', bool: v, raw: v };
    if (typeof v === 'object') {
      if (v.richText) {
        var t = '';
        for (var i = 0; i < v.richText.length; i++) t += v.richText[i].text || '';
        return { kind: 'string', text: t, raw: v };
      }
      if (v.formula !== undefined || v.sharedFormula !== undefined) {
        var r = (v.result !== undefined && v.result !== null) ? v.result : null;
        return { kind: 'formula', raw: v, result: r };
      }
      if (v.hyperlink !== undefined) return { kind: 'link', text: v.text == null ? '' : String(v.text), href: v.hyperlink, raw: v };
      if (v.error !== undefined) return { kind: 'error', text: String(v.error), raw: v };
      if (v.text !== undefined) return { kind: 'string', text: String(v.text), raw: v };
    }
    return { kind: 'string', text: String(cell.text == null ? '' : cell.text), raw: v };
  }

  /* ====================== 范围探测 ====================== */

  function sheetBounds(ws) {
    var lastRow = 0, lastCol = 0, topRow = 0, leftCol = 0;
    ws.eachRow({ includeEmpty: false }, function (row, rowNumber) {
      row.eachCell({ includeEmpty: false }, function (cell, colNumber) {
        if (cell.type === 0 || cell.value === null || cell.value === undefined) return;
        if (!topRow) topRow = rowNumber;
        if (!leftCol || colNumber < leftCol) leftCol = colNumber;
        if (rowNumber > lastRow) lastRow = rowNumber;
        if (colNumber > lastCol) lastCol = colNumber;
      });
    });
    // 合并单元格按延伸到的那一行/列算，不砍断
    var merges = (ws.model && ws.model.merges) || [];
    merges.forEach(function (ref) {
      var m = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(ref);
      if (!m) return;
      var r2 = parseInt(m[4], 10), c2 = colToNum(m[3]);
      if (r2 > lastRow) lastRow = r2;
      if (c2 > lastCol) lastCol = c2;
    });
    if (!topRow) { topRow = 1; }
    if (!leftCol) { leftCol = 1; }
    if (!lastRow) { lastRow = 0; }
    return { topRow: topRow, leftCol: leftCol, lastRow: lastRow, lastCol: lastCol };
  }

  function colToNum(letters) {
    var n = 0;
    for (var i = 0; i < letters.length; i++) n = n * 26 + (letters.charCodeAt(i) - 64);
    return n;
  }

  function numToCol(n) {
    var s = '';
    while (n > 0) {
      var r = (n - 1) % 26;
      s = String.fromCharCode(65 + r) + s;
      n = (n - 1 - r) / 26;
    }
    return s;
  }

  function addr(row, col) { return numToCol(col) + row; }

  /* ====================== 文本型数字判定 ====================== */

  function leadingZero(s) {
    var t = s.replace(/^[+-]/, '');
    return t.length > 1 && t.charAt(0) === '0' && t.charAt(1) !== '.';
  }

  function digitCount(s) {
    var m = s.match(/\d/g);
    return m ? m.length : 0;
  }

  // 列级排除：标题含关键词 / 整列都是 15 位以上纯数字 / 该列有前导零
  function columnSkipTextNum(headerText, values, keywords) {
    var h = String(headerText == null ? '' : headerText);
    for (var i = 0; i < keywords.length; i++) {
      var k = keywords[i];
      if (k && h.indexOf(k) >= 0) return '标题含「' + k + '」';
    }
    var allLong = values.length > 0;
    for (var j = 0; j < values.length; j++) {
      var v = values[j];
      if (!/^\d+$/.test(v) || v.length < 15) { allLong = false; break; }
    }
    if (allLong) return '整列都是 15 位以上纯数字';
    for (var k2 = 0; k2 < values.length; k2++) {
      if (leadingZero(values[k2])) return '该列存在前导零';
    }
    return null;
  }

  /* ====================== 日期识别 ====================== */

  function pad2(n) { return n < 10 ? '0' + n : '' + n; }

  function validYMD(y, m, d) {
    if (y < 1900 || y > 2999) return false;
    if (m < 1 || m > 12) return false;
    if (d < 1 || d > 31) return false;
    var dt = new Date(y, m - 1, d);
    return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
  }

  // 返回 Date 或 null。认不出的不猜。
  function parseDateText(s, order) {
    var m = YMD_RE.exec(s);
    if (m) {
      var y = +m[1], mo = +m[2], d = +m[3];
      return validYMD(y, mo, d) ? new Date(y, mo - 1, d) : null;
    }
    m = AMB_RE.exec(s);
    if (m) {
      var a = +m[1], b = +m[2], yy = +m[3];
      var mm, dd;
      if (a > 12 && b <= 12) { dd = a; mm = b; }
      else if (b > 12 && a <= 12) { mm = a; dd = b; }
      else if (order === 'dmy') { dd = a; mm = b; }
      else if (order === 'mdy') { mm = a; dd = b; }
      else { mm = a; dd = b; }   // 年/月/日 顺序下遇到两位年份在前，按 月/日 处理
      return validYMD(yy, mm, dd) ? new Date(yy, mm - 1, dd) : null;
    }
    return null;
  }

  function fmtDate(d, numFmt) {
    if (!numFmt || numFmt === 'yyyy-mm-dd') return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
    if (numFmt === 'yyyy/mm/dd') return d.getFullYear() + '/' + pad2(d.getMonth() + 1) + '/' + pad2(d.getDate());
    return d.getFullYear() + '年' + pad2(d.getMonth() + 1) + '月' + pad2(d.getDate()) + '日';
  }

  /* ====================== 命名范围引用探测 ====================== */

  function collectFormulas(ws) {
    var out = [];
    ws.eachRow({ includeEmpty: false }, function (row) {
      row.eachCell({ includeEmpty: false }, function (cell) {
        var v = cell.value;
        if (v && typeof v === 'object' && (v.formula !== undefined || v.sharedFormula !== undefined)) {
          out.push(v.formula || v.sharedFormula || '');
        }
        if (cell.dataValidation && cell.dataValidation.formulae) {
          cell.dataValidation.formulae.forEach(function (f) { out.push(String(f)); });
        }
      });
    });
    return out;
  }

  // 判断不了就返回 null（调用方据此「全删」）
  function nameIsReferenced(name, formulaTexts) {
    var re;
    try { re = new RegExp('(^|[^A-Za-z0-9_.])' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '([^A-Za-z0-9_.]|$)', 'i'); }
    catch (e) { return null; }
    for (var i = 0; i < formulaTexts.length; i++) {
      if (re.test(formulaTexts[i])) return true;
    }
    return false;
  }

  /* ====================== 单表处理主流程 ====================== */

  // cfg: items / dupes / date / keywords
  // write: 可选的写出回调，签名 write(cells) → 一行一调（dry-run 传 null）
  function processSheet(ws, cfg, samples, write) {
    var items = cfg.items;
    var stats = newStats();
    var bounds = sheetBounds(ws);
    var topRow = bounds.topRow, leftCol = bounds.leftCol, lastRow = bounds.lastRow, lastCol = bounds.lastCol;
    if (!lastRow || !lastCol) return { stats: stats, bounds: bounds };

    var nCols = lastCol - leftCol + 1;

    // ---- 预读：表头 + 每列字符串值（供文本型数字的列级排除）----
    var headerCells = [];
    var colStrings = [];
    for (var c = 0; c < nCols; c++) { colStrings.push([]); }
    {
      var topRowObj = ws.getRow(topRow);
      for (var ci = 0; ci < nCols; ci++) {
        var info0 = readCell(topRowObj.getCell(leftCol + ci));
        headerCells.push(info0 ? display(info0.raw) : '');
      }
    }
    if (items.textnum) {
      ws.eachRow({ includeEmpty: false }, function (row, rowNumber) {
        if (rowNumber <= topRow || rowNumber > lastRow) return;
        row.eachCell({ includeEmpty: false }, function (cell, colNumber) {
          if (colNumber < leftCol || colNumber > lastCol) return;
          var v = cell.value;
          if (typeof v === 'string' && v) colStrings[colNumber - leftCol].push(v);
        });
      });
    }
    var skipReason = [];
    for (var cs = 0; cs < nCols; cs++) {
      skipReason.push(items.textnum ? columnSkipTextNum(headerCells[cs], colStrings[cs], cfg.keywords) : '列未启用');
    }

    // ---- 逐行处理 ----
    var seen = {};             // 去重 key → 行号数组
    var dupKeepSet = null;     // 需要保留的行号（按列/整行去重时先收集）
    var dupInfo = {};          // 行号 → 被删原因
    var pendingRows = [];      // 去重需要第二遍才能定夺的行
    var wroteRow = 0;

    var rowBuf = [];
    ws.eachRow({ includeEmpty: false }, function (row, rowNumber) {
      if (rowNumber < topRow || rowNumber > lastRow) return;

      var cells = new Array(nCols);
      var fmts = new Array(nCols);
      var rowEmpty = true;

      for (var k = 0; k < nCols; k++) {
        var col = leftCol + k;
        var cell = row.getCell(col);
        var info = readCell(cell);
        var out = null;
        var outFmt = null;
        var fmtSrc = cell.numFmt || null;

        if (!info) { cells[k] = null; fmts[k] = null; continue; }
        rowEmpty = false;

        if (info.kind === 'formula') {
          // 公式一律输出为计算结果（原表不动，结果表要的是数据）
          cells[k] = info.result;
          fmts[k] = fmtSrc;
          continue;
        }
        if (info.kind === 'number' || info.kind === 'bool' || info.kind === 'error') {
          cells[k] = info.raw;
          fmts[k] = fmtSrc;
          continue;
        }
        if (info.kind === 'date') {
          out = info.date;
          outFmt = fmtSrc;
          if (items.date && rowNumber > topRow) {
            var target = cfg.date.numFmt;
            outFmt = target;
            if (!(fmtSrc && isSameDateFmt(fmtSrc, target))) {
              stats.date++;
              push(samples, 'date', { sheet: ws.name, cell: addr(rowNumber, col), before: fmtDate(info.date, fmtSrc), after: fmtDate(info.date, target) });
            }
          }
          cells[k] = out; fmts[k] = outFmt;
          continue;
        }
        if (info.kind === 'link') {
          if (items.hyperlink && rowNumber > topRow) {
            stats.hyperlink++;
            push(samples, 'hyperlink', { sheet: ws.name, cell: addr(rowNumber, col), before: info.text + '  →  ' + info.href, after: info.text });
          }
          cells[k] = info.text; fmts[k] = fmtSrc;
          continue;
        }

        // kind === 'string'
        var s = info.text;
        var orig = s;

        if (items.invisible && rowNumber > topRow) {
          var s2 = stripInvisible(s);
          if (s2 !== s) { stats.invisible++; push(samples, 'invisible', { sheet: ws.name, cell: addr(rowNumber, col), before: clip(orig), after: clip(s2) }); s = s2; }
        }
        if (items.fullwidth && rowNumber > topRow) {
          var s3 = toHalfwidth(s);
          if (s3 !== s) { stats.fullwidth++; push(samples, 'fullwidth', { sheet: ws.name, cell: addr(rowNumber, col), before: clip(s), after: clip(s3) }); s = s3; }
        }
        if (items.spaces && rowNumber > topRow) {
          var s4 = normalizeSpace(s);
          if (s4 !== s) { stats.spaces++; push(samples, 'spaces', { sheet: ws.name, cell: addr(rowNumber, col), before: clip(s), after: clip(s4) }); s = s4; }
        }

        // 文本型数字
        if (items.textnum && rowNumber > topRow && skipReason[k] === null && NUM_RE.test(s)) {
          var digits = digitCount(s);
          if (digits <= 15 && !leadingZero(s)) {
            var num = Number(s);
            if (isFinite(num)) {
              stats.textnum++;
              push(samples, 'textnum', { sheet: ws.name, cell: addr(rowNumber, col), before: clip(s), after: clip(String(num)) });
              cells[k] = num; fmts[k] = 'General';
              continue;
            }
          }
        }

        // 日期（文本型）
        if (items.date && rowNumber > topRow) {
          var d = parseDateText(s, cfg.date.order);
          if (d) {
            stats.date++;
            push(samples, 'date', { sheet: ws.name, cell: addr(rowNumber, col), before: clip(s), after: fmtDate(d, cfg.date.numFmt) });
            cells[k] = d; fmts[k] = cfg.date.numFmt;
            continue;
          }
        }

        cells[k] = s; fmts[k] = fmtSrc;
      }

      // ---- 去重登记 ----
      var isData = rowNumber > topRow;
      if (items.dupes && rowEmpty === false && (isData || rowNumber === topRow)) {
        var key = dedupeKey(cells, cfg.dupes);
        if (key !== null) {
          if (!seen[key]) seen[key] = [];
          seen[key].push({ rowNumber: rowNumber, cells: cells });
        }
      }

      rowBuf.push({ rowNumber: rowNumber, cells: cells, fmts: fmts, isEmpty: rowEmpty });
    });

    // ---- 定夺去重 ----
    var drop = {};
    if (items.dupes) {
      Object.keys(seen).forEach(function (key) {
        var arr = seen[key];
        if (arr.length < 2) return;
        var keepIdx = cfg.dupes.keep === 'last' ? arr.length - 1 : 0;
        for (var i = 0; i < arr.length; i++) {
          if (i === keepIdx) continue;
          drop[arr[i].rowNumber] = arr[keepIdx].rowNumber;
        }
      });
      stats.dupes = Object.keys(drop).length;
      rowBuf.forEach(function (r) {
        if (!drop[r.rowNumber]) return;
        push(samples, 'dupes', {
          sheet: ws.name,
          cell: '第 ' + r.rowNumber + ' 行',
          before: clip(r.cells.map(display).join(' | ')),
          after: '删除（与第 ' + drop[r.rowNumber] + ' 行重复，保留' + (cfg.dupes.keep === 'last' ? '末条' : '首条') + '）'
        });
      });
    }

    // ---- 写出 ----
    for (var ri = 0; ri < rowBuf.length; ri++) {
      var r = rowBuf[ri];
      if (drop[r.rowNumber]) continue;
      wroteRow++;
      if (write) write(r.cells, r.fmts, r.rowNumber);
    }
    stats._outRowCount = wroteRow;
    stats._bounds = bounds;
    return { stats: stats, bounds: bounds, outRows: wroteRow };
  }

  function dedupeKey(cells, dupCfg) {
    if (dupCfg.by === 'row' || dupCfg.by === null || dupCfg.by === undefined) {
      var parts = [];
      for (var i = 0; i < cells.length; i++) parts.push(keyOf(cells[i]));
      return parts.join('\u0001');
    }
    var col = dupCfg.by | 0;
    if (col < 0 || col >= cells.length) return null;
    var v = cells[col];
    if (v === null || v === undefined || v === '') return null;   // 该列为空 → 不参与去重
    return 'C' + col + ':' + keyOf(v);
  }

  function keyOf(v) {
    if (v === null || v === undefined) return '\u0000';
    if (v instanceof Date) return 'D' + v.getTime();
    if (typeof v === 'object') { try { return 'O' + JSON.stringify(v); } catch (e) { return 'O?'; } }
    return typeof v + ':' + v;
  }

  function isSameDateFmt(src, target) {
    var norm = function (f) { return String(f || '').toLowerCase().replace(/\\/g, '').replace(/"/g, ''); };
    var s = norm(src), t = norm(target);
    if (s === t) return true;
    // 常见等价写法
    var pairs = { 'yyyy-mm-dd': ['yyyy-mm-dd', 'yyyy-m-d', 'yyyymmdd'], 'yyyy/mm/dd': ['yyyy/mm/dd', 'yyyy/m/d'] };
    if (pairs[t] && pairs[t].indexOf(s) >= 0) return true;
    return false;
  }

  /* ====================== 默认表头样式 ====================== */

  function applyHeaderStyle(ws, nCols, nRows) {
    var HEAD_BG = 'FFF2F2F2';
    var INK = 'FF2B2926';
    var head = ws.getRow(1);
    for (var c = 1; c <= nCols; c++) {
      var cell = head.getCell(c);
      cell.font = { bold: true, color: { argb: INK } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEAD_BG } };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.border = { bottom: { style: 'thin', color: { argb: INK } } };
    }
    head.height = 22;

    // 列宽自适应（上限 40）
    for (var i = 1; i <= nCols; i++) {
      var max = 0;
      for (var r = 1; r <= nRows; r++) {
        var w = dispWidth(ws.getRow(r).getCell(i).value);
        if (w > max) max = w;
      }
      var width = Math.max(COL_WIDTH_MIN, Math.min(COL_WIDTH_CAP, max + 2));
      ws.getColumn(i).width = width;
    }
    ws.views = [{ state: 'frozen', ySplit: 1 }];
  }

  function dispWidth(v) {
    if (v === null || v === undefined) return 0;
    var s = v instanceof Date ? '2026-09-17' : (typeof v === 'object' ? display(v) : String(v));
    var w = 0;
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      w += (c > 0x2E80 && c < 0xFE00) || (c >= 0xFF01 && c <= 0xFF60) || (c >= 0x3000 && c <= 0x303F) ? 2 : 1;
    }
    return w;
  }

  /* ====================== 瘦身 ====================== */
  /* 下面几段绕开了 exceljs 两个坑（4.4.0 实测）：
   *   1. ws.spliceRows 删尾行完全无效；删中间行会把合并单元格内容整行复制过去，数据会串。
   *      → 自实现行压缩 deleteRowsManual()
   *   2. ws._rows / ws._columns 都是 0 基：_rows[n-1] 是第 n 行，_columns[n-1] 是第 n 列。
   */

  function truncateRows(ws, keepRows) {
    var arr = ws._rows;
    if (!arr) return 0;
    var removed = 0;
    for (var i = keepRows; i < arr.length; i++) { if (arr[i]) removed++; arr[i] = null; }
    Object.keys(arr).forEach(function (k) { if (+k < 0) delete arr[k]; });
    if (arr.length > keepRows) arr.length = keepRows;
    return removed;
  }

  // 只清 ws._columns 不够：序列化走的是每行的 _cells，行里多出来的格子照样会被写出去。
  function truncateCols(ws, keepCols) {
    var arr = ws._columns;
    var removed = 0;
    var fromCols = false;
    if (arr && arr.length) {
      fromCols = true;
      for (var i = keepCols; i < arr.length; i++) { if (arr[i]) removed++; arr[i] = null; }
      if (arr.length > keepCols) arr.length = keepCols;
    }
    var rows = ws._rows || [];
    var maxExtra = 0;
    for (var r = 0; r < rows.length; r++) {
      var row = rows[r];
      if (!row || !row._cells) continue;
      var cs = row._cells;
      var extra = 0;
      for (var c = keepCols; c < cs.length; c++) {
        if (cs[c]) { extra++; try { clearCell(cs[c]); } catch (e) { } cs[c] = null; }
      }
      if (extra > maxExtra) maxExtra = extra;
      if (cs.length > keepCols) cs.length = keepCols;
    }
    return fromCols ? removed : maxExtra;
  }

  function hiddenRows(ws) {
    var out = [];
    var arr = ws._rows || [];
    for (var i = 0; i < arr.length; i++) if (arr[i] && arr[i].hidden) out.push(i + 1);
    return out;
  }

  function hiddenCols(ws) {
    var out = [];
    var arr = ws._columns || [];
    var lim = Math.min(arr.length, MAX_COL_SCAN);
    for (var i = 0; i < lim; i++) if (arr[i] && arr[i].hidden) out.push(i + 1);
    return out;
  }

  // 自实现行删除：exceljs spliceRows 会串数据，不能用于删行
  function deleteRowsManual(ws, delRows) {
    delRows = delRows.slice().sort(function (a, b) { return a - b; });
    var del = {};
    delRows.forEach(function (r) { del[r] = 1; });
    var total = (ws._rows && ws._rows.length) || 0;
    var first = delRows[0];
    if (!first || first > total) return 0;

    function snapshot(r) {
      var row = ws._rows[r - 1];
      if (!row) return { cells: [], hidden: false, height: undefined };
      var out = [];
      var cs = row._cells || [];
      for (var c = 0; c < cs.length; c++) {
        var cell = cs[c];
        if (!cell) continue;
        var v = cell.value;
        out.push({ c: c + 1, value: (v === undefined ? null : v), style: cell.style || {}, comment: cell._comment || null });
      }
      return { cells: out, hidden: !!row.hidden, height: row.height };
    }

    var seg = [];
    for (var r = first; r <= total; r++) if (!del[r]) seg.push(snapshot(r));
    var removed = (total - first + 1) - seg.length;

    // 先把这一段全部清空，再写回，避免读写互相覆盖
    for (var q = first; q <= total; q++) {
      var row = ws._rows[q - 1];
      if (!row) continue;
      var cs = row._cells || [];
      for (var k = 0; k < cs.length; k++) {
        var cell = cs[k];
        if (!cell) continue;
        clearCell(cell);
      }
      row.hidden = false;
      row.height = undefined;
    }
    for (var i = 0; i < seg.length; i++) {
      var to = first + i;
      var s = seg[i];
      var dst = ws.getRow(to);
      dst.hidden = s.hidden;
      if (s.height !== undefined && s.height !== null) dst.height = s.height;
      for (var j = 0; j < s.cells.length; j++) {
        var it = s.cells[j];
        var c2 = dst.getCell(it.c);
        c2.value = it.value;
        c2.style = it.style;
        if (it.comment) c2._comment = it.comment;
      }
    }
    truncateRows(ws, first + seg.length - 1);
    return removed;
  }

  // 自实现列删除。不能用 ws.spliceColumns：它和合并单元格一起用时会把合并主体的值弄丢，
  // 且对稀疏的 row._cells 处理不干净（残留格子会被序列化出去）。
  function deleteColsManual(ws, delCols) {
    delCols = delCols.slice().sort(function (a, b) { return a - b; });
    var del = {};
    delCols.forEach(function (c) { del[c] = 1; });
    var rows = ws._rows || [];
    var total = 0;
    for (var i = 0; i < rows.length; i++) {
      if (rows[i] && rows[i]._cells) total = Math.max(total, rows[i]._cells.length);
    }
    if (!total) return 0;
    var inRange = delCols.filter(function (c) { return c <= total; });
    if (!inRange.length) return 0;

    // keep = 保留下来的原列号；dest = 该列删完之后落在第几列
    // 列号 < 首个被删列的不动；>= 的按「前面删了几列」左移。
    var keep = [], dest = [];
    for (var c = 1; c <= total; c++) {
      if (del[c]) continue;
      var sh = 0;
      delCols.forEach(function (d) { if (d < c) sh++; });
      keep.push(c);
      dest.push(c - sh);
    }
    var newTotal = total - inRange.length;

    for (var r = 0; r < rows.length; r++) {
      var row = rows[r];
      if (!row || !row._cells) continue;
      var cs = row._cells;
      var snapshot = [];
      for (var k = 0; k < keep.length; k++) {
        var src = cs[keep[k] - 1] || null;
        snapshot.push(src ? { value: src.value, style: src.style, comment: src._comment || null } : null);
      }
      for (var d2 = 0; d2 < cs.length; d2++) {
        if (cs[d2]) { clearCell(cs[d2]); cs[d2] = null; }
      }
      for (var w = 0; w < snapshot.length; w++) {
        var it = snapshot[w];
        if (!it || (it.value === null && !it.comment)) continue;
        var cell = row.getCell(dest[w]);
        cell.value = it.value;
        if (it.style) cell.style = it.style;
        if (it.comment) cell._comment = it.comment;
      }
    }
    truncateCols(ws, newTotal);
    return inRange.length;
  }


  // exceljs 里批注同时存在两处：cell._comment 与 cell._value.model.comment。
  // 只清 _comment 不够，重写一次 value 才会把 _value 里的那份丢掉。
  function clearCell(cell) {
    try {
      if (cell._comment) {
        var v = cell.value;
        cell.value = v;
        cell._comment = null;
      }
    } catch (e) { try { cell._comment = null; } catch (e2) {} }
    try { cell.style = {}; } catch (e) { }
    try { cell.value = null; } catch (e) { }
  }

  // 合并范围随删除重排（Excel 同款语义）：
  //   · 行：范围内有被删行 → 整个合并丢弃；否则上下边界一起上移
  //   · 列：范围内被删的列全部覆盖整个合并 → 丢弃；否则收缩到剩下的列（塌成一格即不合并）
  // exceljs 没有可用的合并编辑 API（_merges.model 无 setter，unMergeCells 传字符串会抛
  // 「intersects is not a function」），只能用内部的 _unMergeMaster + 公开的 mergeCells 重建。
  function planMerges(ws, delRows, delCols) {
    var refs = (ws.model && ws.model.merges) || [];
    delRows = delRows || [];
    delCols = delCols || [];
    var delR = {}, delC = {};
    delRows.forEach(function (r) { delR[r] = 1; });
    delCols.forEach(function (c) { delC[c] = 1; });
    var next = [], dropped = 0;
    refs.forEach(function (ref) {
      var m = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(ref);
      if (!m) return;
      var c1 = colToNum(m[1]), c2 = colToNum(m[3]);
      var t = +m[2], b = +m[4];

      for (var r = t; r <= b; r++) if (delR[r]) { dropped++; return; }

      var surv = [];
      for (var c = c1; c <= c2; c++) if (!delC[c]) surv.push(c);
      if (!surv.length) { dropped++; return; }
      var cL = surv[0], cR = surv[surv.length - 1];
      var shL = 0, shR = 0;
      delCols.forEach(function (c) { if (c < cL) shL++; if (c < cR) shR++; });
      var nc1 = cL - shL, nc2 = cR - shR;
      if (nc1 === nc2) { dropped++; return; }

      var shr = 0;
      delRows.forEach(function (r) { if (r < t) shr++; });
      next.push(numToCol(nc1) + (t - shr) + ':' + numToCol(nc2) + (b - shr));
    });
    return { next: next, dropped: dropped, total: refs.length };
  }

  function unmergeAll(ws) {
    var keys = Object.keys(ws._merges || {});
    keys.forEach(function (k) {
      try { ws._unMergeMaster(ws.getCell(k)); } catch (e) { /* 忽略 */ }
    });
    return keys.length;
  }

  function remerge(ws, refs) {
    var ok = 0;
    refs.forEach(function (ref) { try { ws.mergeCells(ref); ok++; } catch (e) { /* 忽略 */ } });
    return ok;
  }

  function slimSheet(ws, cfg, stats, samples, extras) {
    var items = cfg.items;
    var bounds = sheetBounds(ws);

    // 范围外行列（自动，不单列、不进报告）
    if (bounds.lastRow) {
      var curRows = (ws._rows && ws._rows.length) || 0;
      if (curRows > bounds.lastRow) stats.outRows += truncateRows(ws, bounds.lastRow);
    }
    if (bounds.lastCol) {
      var curCols = (ws._columns && ws._columns.length) || 0;
      if (curCols > bounds.lastCol) stats.outCols += truncateCols(ws, bounds.lastCol);
    }

    // 隐藏行列
    if (items.hidden) {
      var hR = hiddenRows(ws), hC = hiddenCols(ws);
      stats.hiddenRows = hR.length;
      stats.hiddenCols = hC.length;

      if (items.hidden === 'delete') {
        // 顺序要紧：先算好合并的新范围并全部拆开，再删列删行，最后重新合并。
        // 带合并状态去删列/删行会把合并主体的值弄丢。
        var plan = (hR.length || hC.length) ? planMerges(ws, hR, hC) : { next: [], dropped: 0, total: 0 };
        if (plan.total) unmergeAll(ws);
        if (hC.length) deleteColsManual(ws, hC);
        if (hR.length) deleteRowsManual(ws, hR);
        if (plan.next.length) remerge(ws, plan.next);
        if (plan.dropped) extras.push('隐藏行列：删除时丢弃了 ' + plan.dropped + ' 处相交的合并单元格');
      } else if (items.hidden === 'show') {
        hR.forEach(function (r) { if (ws._rows && ws._rows[r - 1]) ws._rows[r - 1].hidden = false; });
        hC.forEach(function (c) { if (ws._columns && ws._columns[c - 1]) ws._columns[c - 1].hidden = false; });
      }
      if (hR.length || hC.length) {
        extras.push('隐藏行列：' + (hR.length ? hR.length + ' 行' : '') + (hR.length && hC.length ? ' / ' : '') + (hC.length ? hC.length + ' 列' : '') + ' — ' +
          (items.hidden === 'delete' ? '已删除' : items.hidden === 'show' ? '已展开显示' : '保持隐藏'));
      }
    }

    // 批注
    if (items.notes) {
      var noteCells = collectNoteCells(ws);
      stats.notes = noteCells.length;
      if (items.notes === 'delete') {
        var cleared = 0;
        noteCells.forEach(function (c) { try { clearCellNote(c); cleared++; } catch (e) {} });
        if (cleared) extras.push('批注：' + cleared + ' 处已删除');
      } else if (items.notes === 'show') {
        if (noteCells.length) extras.push('批注：' + noteCells.length + ' 处设为常显');
      }
    }
  }

  function collectNoteCells(ws) {
    var out = [];
    ws.eachRow({ includeEmpty: false }, function (row) {
      var n = row.cellCount || 0;
      for (var k = 1; k <= n; k++) {
        var cell = row.getCell(k);
        if (cell.note) out.push(cell);
      }
    });
    return out;
  }

  function clearCellNote(cell) {
    var v = cell.value;
    cell.value = v;          // 重建 _value，丢掉 _value.model 里那份 comment
    cell._comment = null;
    return true;
  }

  function slimNames(wb, cfg, stats, samples, extras) {
    if (!cfg.items.names) return;
    var model = (wb.definedNames && wb.definedNames.model) || [];
    if (!model.length) { stats.names = 0; return; }
    var formulas = [];
    wb.worksheets.forEach(function (ws) {
      try { formulas = formulas.concat(collectFormulas(ws)); } catch (e) {}
    });
    var keep = [], drop = [], undecidable = [];
    model.forEach(function (n) {
      var ref = nameIsReferenced(n.name, formulas);
      if (ref === null) undecidable.push(n); else if (ref) keep.push(n); else drop.push(n);
    });
    var removeAll = undecidable.length > 0;
    var removed = removeAll ? model : drop;
    stats.names = removed.length;
    removed.forEach(function (n) {
      push(samples, 'names', { sheet: '(整个文件)', cell: n.name, before: (n.ranges || []).join(', '), after: '删除（未被任何公式引用）' });
    });
    try { wb.definedNames.model = removeAll ? [] : keep; } catch (e) {}
    if (removed.length) extras.push('命名范围：删除 ' + removed.length + ' 个' + (removeAll ? '（有无法判断引用的，按规则全删）' : '（未被引用）'));
  }

  /* ====================== 对外 API ====================== */

  function normCfg(cfg) {
    cfg = cfg || {};
    var it = cfg.items || {};
    return {
      items: {
        invisible: it.invisible !== false,
        spaces: it.spaces !== false,
        hyperlink: it.hyperlink !== false,
        dupes: !!it.dupes,
        fullwidth: it.fullwidth !== false,
        textnum: it.textnum !== false,
        date: !!it.date,
        names: !!it.names,
        hidden: it.hidden || 'show',
        notes: it.notes || 'hide'
      },
      dupes: { by: (cfg.dupes && cfg.dupes.by !== undefined) ? cfg.dupes.by : 'row', keep: (cfg.dupes && cfg.dupes.keep) || 'first' },
      date: { order: (cfg.date && cfg.date.order) || 'ymd', numFmt: (cfg.date && cfg.date.numFmt) || 'yyyy-mm-dd' },
      keywords: (cfg.keywords && cfg.keywords.length ? cfg.keywords : DEFAULT_KEYWORDS).slice()
    };
  }

  // 体检报告（只读）：不写任何东西
  function scan(ws, cfgRaw) {
    var cfg = normCfg(cfgRaw);
    var samples = newSamples();
    var res = processSheet(ws, cfg, samples, null);
    var st = res.stats;
    var counts = {};
    ITEMS.forEach(function (it) {
      if (it.key === 'hidden') counts[it.key] = (st.hiddenRows || 0) + (st.hiddenCols || 0);
      else counts[it.key] = st[it.key] || 0;
    });
    return { counts: counts, samples: samples, bounds: res.bounds, stats: st };
  }

  // 隐藏行列与批注在 scan 里没有（它们不属于逐行处理），单独扫
  function scanSheetExtras(ws) {
    return {
      hiddenRows: hiddenRows(ws).length,
      hiddenCols: hiddenCols(ws).length,
      notes: collectNoteCells(ws).length
    };
  }

  /* 执行清洗：在传入的 wb 上新增 sheet + 瘦身。返回汇总。
   * sheets: [{ ws, name, selected }]
   */
  function run(wb, sheetList, cfgRaw, options) {
    var cfg = normCfg(cfgRaw);
    options = options || {};
    var samples = newSamples();
    var statsAll = newStats();
    var extras = [];
    var created = [];
    var perSheet = [];

    var wantNewSheet = cfg.items.invisible || cfg.items.spaces || cfg.items.hyperlink || cfg.items.dupes ||
      cfg.items.fullwidth || cfg.items.textnum || cfg.items.date;

    var usedNames = {};
    wb.worksheets.forEach(function (w) { usedNames[w.name] = 1; });

    sheetList.forEach(function (entry) {
      if (!entry.selected) return;
      var ws = entry.ws;
      var one = { name: ws.name, outName: null, rows: 0, cols: 0, counts: {} };

      if (wantNewSheet) {
        var target = uniqueName(usedNames, cleanSheetName(ws.name + '_清洗'));
        var newWs = wb.addWorksheet(target);
        created.push(newWs);
        var rowNo = 0;
        var res = processSheet(ws, cfg, samples, function (cells, fmts) {
          rowNo++;
          var row = newWs.getRow(rowNo);
          for (var i = 0; i < cells.length; i++) {
            var v = cells[i];
            if (v === null || v === undefined || v === '') continue;   // 空气单元格不建，防文件虚大
            row.getCell(i + 1).value = v;
          }
          for (var j = 0; j < fmts.length; j++) {
            if (fmts[j] && cells[j] !== null && cells[j] !== undefined && cells[j] !== '') {
              row.getCell(j + 1).numFmt = fmts[j];
            }
          }
        });
        ITEMS.forEach(function (it) { if (it.key !== 'hidden' && it.key !== 'notes' && it.key !== 'names') statsAll[it.key] += res.stats[it.key] || 0; });
        var nCols = res.bounds.lastCol - res.bounds.leftCol + 1;
        applyHeaderStyle(newWs, nCols, Math.max(rowNo, 1));
        one.outName = target;
        one.rows = rowNo;
        one.cols = nCols;
      }

      var ext = scanSheetExtras(ws);
      perSheet.push({ name: ws.name, hiddenRows: ext.hiddenRows, hiddenCols: ext.hiddenCols, notes: ext.notes });
    });

    // 瘦身逐表
    sheetList.forEach(function (entry) {
      if (!entry.selected) return;
      slimSheet(entry.ws, cfg, statsAll, samples, extras);
    });
    slimNames(wb, cfg, statsAll, samples, extras);

    // 瘦身项不进报告，只进摘要
    var counts = {};
    ITEMS.forEach(function (it) {
      if (it.key === 'hidden') counts[it.key] = (statsAll.hiddenRows || 0) + (statsAll.hiddenCols || 0);
      else counts[it.key] = statsAll[it.key] || 0;
    });

    return {
      counts: counts,
      samples: samples,
      extras: extras,
      created: created,
      perSheet: perSheet,
      wantNewSheet: wantNewSheet,
      stats: statsAll
    };
  }

  function cleanSheetName(n) {
    return String(n).replace(/[\[\]\*\?\/\\:]/g, '_').slice(0, 31);
  }

  function uniqueName(used, base) {
    if (!used[base]) { used[base] = 1; return base; }
    for (var i = 2; i < 999; i++) {
      var cand = cleanSheetName(base.replace(/_清洗(_\d+)?$/, '') + '_清洗_' + i);
      if (!used[cand]) { used[cand] = 1; return cand; }
    }
    return base + '_' + Date.now();
  }

  /* ====================== CSV ====================== */

  // RFC4180 解析：支持引号、引号内逗号/换行/双引号转义
  function parseCSV(text) {
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    var rows = [];
    var row = [];
    var field = '';
    var i = 0;
    var inQ = false;
    var n = text.length;
    while (i < n) {
      var ch = text.charAt(i);
      if (inQ) {
        if (ch === '"') {
          if (text.charAt(i + 1) === '"') { field += '"'; i += 2; continue; }
          inQ = false; i++; continue;
        }
        field += ch; i++; continue;
      }
      if (ch === '"') { inQ = true; i++; continue; }
      if (ch === ',') { row.push(field); field = ''; i++; continue; }
      if (ch === '\r') { if (text.charAt(i + 1) === '\n') i++; row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
      if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
      field += ch; i++;
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    // 去掉末尾整行皆空的
    while (rows.length && rows[rows.length - 1].every(function (x) { return x === ''; })) rows.pop();
    return rows;
  }

  function serializeCSV(matrix) {
    var lines = [];
    for (var i = 0; i < matrix.length; i++) {
      var cells = matrix[i];
      var out = [];
      for (var j = 0; j < cells.length; j++) {
        var v = cells[j];
        var s = v === null || v === undefined ? '' : (v instanceof Date ? fmtDate(v, 'yyyy-mm-dd') : (typeof v === 'object' ? display(v) : String(v)));
        if (/[",\r\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
        out.push(s);
      }
      lines.push(out.join(','));
    }
    return '\uFEFF' + lines.join('\r\n');
  }

  // 从 worksheet 抽出矩阵（用于 CSV 输出）
  function sheetToMatrix(ws) {
    var b = sheetBounds(ws);
    var m = [];
    if (!b.lastRow) return m;
    for (var r = b.topRow; r <= b.lastRow; r++) {
      var row = ws.getRow(r);
      var line = [];
      for (var c = b.leftCol; c <= b.lastCol; c++) line.push(row.getCell(c).value);
      m.push(line);
    }
    return m;
  }

  /* ====================== 批注可见性后处理 ====================== */

  // exceljs 写不出「批注常显」（VML 里是 visibility:hidden）。
  // 这里在生成的 xlsx 上把 VML 补丁一下。JSZip 由调用方注入。
  function makeNotesVisible(buf, JSZipLib) {
    if (!JSZipLib) return Promise.resolve(null);
    return JSZipLib.loadAsync(buf).then(function (zip) {
      var targets = Object.keys(zip.files).filter(function (n) { return /vmlDrawing.*\.vml$/i.test(n); });
      if (!targets.length) return null;
      return Promise.all(targets.map(function (n) {
        return zip.file(n).async('string').then(function (vml) {
          var patched = vml
            .replace(/visibility:hidden/g, 'visibility:visible')
            .replace(/<x:ClientData ObjectType="Note">/g, '<x:ClientData ObjectType="Note"><x:Visible/>');
          zip.file(n, patched);
        });
      })).then(function () {
        return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
      });
    });
  }

  /* ====================== 导出 ====================== */

  return {
    VERSION: VERSION,
    ITEMS: ITEMS,
    GROUPS: GROUP_LABEL,
    DEFAULT_KEYWORDS: DEFAULT_KEYWORDS,
    DATE_FORMATS: DATE_FORMATS,
    COL_WIDTH_CAP: COL_WIDTH_CAP,
    normCfg: normCfg,
    scan: scan,
    scanSheetExtras: scanSheetExtras,
    run: run,
    parseCSV: parseCSV,
    serializeCSV: serializeCSV,
    sheetToMatrix: sheetToMatrix,
    makeNotesVisible: makeNotesVisible,
    sheetBounds: sheetBounds,
    addr: addr,
    // 给 excel-merge.js 复用（同一套取值/样式/命名口径，别各写一份）
    _helpers: {
      sheetBounds: sheetBounds,
      readCell: readCell,
      applyHeaderStyle: applyHeaderStyle,
      dispWidth: dispWidth,
      numToCol: numToCol,
      colToNum: colToNum,
      cleanSheetName: cleanSheetName,
      toHalfwidth: toHalfwidth,
      display: display,
      fmtDate: fmtDate
    },
    // 供单测直接调用
    _internal: {
      toHalfwidth: toHalfwidth,
      normalizeSpace: normalizeSpace,
      stripInvisible: stripInvisible,
      parseDateText: parseDateText,
      leadingZero: leadingZero,
      isSameDateFmt: isSameDateFmt,
      columnSkipTextNum: columnSkipTextNum,
      nameIsReferenced: nameIsReferenced,
      dispWidth: dispWidth
    }
  };
});
