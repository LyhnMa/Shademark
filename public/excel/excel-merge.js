/*!
 * ShadeMark Excel 合并拆分引擎（UMD）
 * ============================================================
 * 纯数据层：不碰 DOM、不知道页面长什么样。
 * 浏览器：window.ShadeMarkExcelMerge
 * Node  ：require('./excel-merge.js')  →  自动 require('./excel-clean.js')
 *
 * 复用 excel-clean.js 导出的 _helpers（取值口径 / 默认表头样式 / 表名清理），
 * 不重造第二套。
 *
 * 约定：
 *  - 表 = { header: [值...], rows: [[值...]...], nCols, nRows }
 *  - 表头 = 用到的第一行（不检测、不询问）
 *  - 合并：列名先机械清理（去首尾空格 + 全角转半角）再比对；一致即对齐，不一致按并集
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./excel-clean.js'));
  } else {
    root.ShadeMarkExcelMerge = factory(root.ShadeMarkExcelClean);
  }
})(typeof self !== 'undefined' ? self : this, function (CLEAN) {
  'use strict';

  var VERSION = '1.0.0';

  if (!CLEAN || !CLEAN._helpers) {
    throw new Error('excel-merge.js 需要先加载 excel-clean.js（缺 _helpers）');
  }
  var H = CLEAN._helpers;

  /* ====================== 取值 ====================== */

  // 单元格 → 纯值（日期留 Date，公式取计算结果，超链接取文字）
  function cellValue(cell, stats) {
    var info = H.readCell(cell);
    if (!info) return null;
    switch (info.kind) {
      case 'date': return info.date;
      case 'number': return info.num;
      case 'bool': return info.bool;
      case 'formula':
        if (stats) stats.formulas++;
        return (info.result === undefined || info.result === null) ? null : info.result;
      case 'link': return info.text !== '' ? info.text : (info.href || null);
      case 'error': return info.text;
      default: return info.text === '' ? null : info.text;
    }
  }

  // 值 → 用于分组 / 标签的显示文本
  function cellText(v) {
    if (v === null || v === undefined) return '';
    if (v instanceof Date) return H.fmtDate(v, 'yyyy-mm-dd');
    if (typeof v === 'object') return H.display(v);
    return String(v);
  }

  // 列名比对键：去首尾空格 + 全角转半角（只用于比对，不改原表）
  function headerKey(v) {
    if (v === null || v === undefined) return '';
    var s = v instanceof Date ? H.fmtDate(v, 'yyyy-mm-dd') : (typeof v === 'object' ? H.display(v) : String(v));
    s = s.replace(/[\u00A0\u3000]/g, ' ');
    s = H.toHalfwidth ? H.toHalfwidth(s) : s;
    return s.replace(/^\s+|\s+$/g, '');
  }

  /* ====================== 读表 ====================== */

  function readTable(ws) {
    var b = H.sheetBounds(ws);
    var stats = { formulas: 0, blanks: 0 };
    if (!b || !b.lastRow || !b.lastCol || b.lastRow < b.topRow) {
      return mkTable([], [], stats);
    }
    var nCols = b.lastCol - b.leftCol + 1;
    var header = [];
    var hr = ws.getRow(b.topRow);
    for (var c = b.leftCol; c <= b.lastCol; c++) header.push(cellValue(hr.getCell(c), stats));

    var rows = [];
    for (var r = b.topRow + 1; r <= b.lastRow; r++) {
      var row = ws.getRow(r);
      var line = [], allEmpty = true;
      for (var c2 = b.leftCol; c2 <= b.lastCol; c2++) {
        var v = cellValue(row.getCell(c2), stats);
        if (v !== null) allEmpty = false;
        line.push(v);
      }
      if (allEmpty) { stats.blanks++; continue; }   // 整行皆空：不搬进结果（条数记在 blanks）
      rows.push(line);
    }
    var t = mkTable(header, rows, stats);
    t.headerRow = b.topRow;
    t.leftCol = b.leftCol;
    return t;
  }

  function mkTable(header, rows, stats) {
    var nCols = header.length;
    for (var i = 0; i < rows.length; i++) if (rows[i].length > nCols) nCols = rows[i].length;
    return {
      header: header || [],
      rows: rows || [],
      nCols: nCols,
      nRows: (rows || []).length,
      formulas: (stats && stats.formulas) || 0,
      blanks: (stats && stats.blanks) || 0,
      empty: !(rows && rows.length) && !(header && header.length)
    };
  }

  /* ====================== 合并 ====================== */

  // items: [{ label, table }]（顺序 = 勾选顺序 = 列顺序）
  function mergeTables(items) {
    items = items || [];
    var cols = [];          // { key, label, from: [表序号] }
    var firstByKey = {};    // key → cols 下标（只有非空列名才参与对齐）
    var maps = [];
    var info = [];

    items.forEach(function (it, ti) {
      var t = it.table || { header: [], rows: [] };
      var seen = {};
      var map = [], matched = 0, added = 0;
      (t.header || []).forEach(function (hv, ci) {
        var k = headerKey(hv);
        var slot;
        if (k !== '' && firstByKey[k] !== undefined && !seen[k]) {
          slot = firstByKey[k]; matched++;                       // 清理后一致 → 对齐到已有列
        } else {
          slot = cols.length;                                    // 不一致 / 同名重复 → 各自成列
          cols.push({ key: k, label: hv, from: [] });
          if (k !== '') firstByKey[k] = slot;
          added++;
        }
        seen[k] = 1;
        cols[slot].from.push(ti);
        map.push(slot);
      });
      maps.push(map);
      info.push({
        label: it.label,
        cols: (t.header || []).length,
        matched: matched, added: added,
        rows: (t.rows || []).length,
        formulas: t.formulas || 0,
        blanks: t.blanks || 0
      });
    });

    var nCols = cols.length;
    var rows = [];
    items.forEach(function (it, ti) {
      var map = maps[ti];
      (it.table.rows || []).forEach(function (src) {
        var line = new Array(nCols);
        for (var i = 0; i < nCols; i++) line[i] = null;
        for (var j = 0; j < map.length; j++) {
          var v = src[j];
          if (v !== undefined && v !== null) line[map[j]] = v;
        }
        rows.push(line);
      });
    });

    var header = cols.map(function (c) { return (c.label === null || c.label === undefined) ? '' : c.label; });
    var t2 = mkTable(header, rows, null);
    t2.columns = cols;
    t2.tables = info;
    t2.alignedCols = cols.filter(function (c) { return c.from.length > 1; }).length;
    t2.onlyOnceCols = cols.filter(function (c) { return c.from.length === 1; }).length;
    t2.totalFormulas = info.reduce(function (a, x) { return a + x.formulas; }, 0);
    t2.totalBlanks = info.reduce(function (a, x) { return a + x.blanks; }, 0);
    return t2;
  }

  // 「合成一个表」的变更摘要文本
  function describeMerge(m) {
    var lines = [];
    (m.tables || []).forEach(function (t) {
      lines.push(t.label + '：' + t.cols + ' 列 / ' + t.rows + ' 行' +
        (t.matched ? '（' + t.matched + ' 列对齐）' : '') +
        (t.added && t.matched ? '，新增 ' + t.added + ' 列' : (t.added && !t.matched ? '（全部各自成列）' : '')));
    });
    lines.push('并集 ' + m.nCols + ' 列（' + m.alignedCols + ' 列被多张表共用，' + m.onlyOnceCols + ' 列只出现在一张表里）· 共 ' + m.nRows + ' 行');
    return lines;
  }

  /* ====================== 拆分 ====================== */

  function columnLabels(table) {
    return (table.header || []).map(function (v, i) {
      var s = cellText(v);
      if (s === '') s = '第 ' + (i + 1) + ' 列';
      return { index: i, label: s, raw: v };
    });
  }

  function splitByColumn(item, colIdx) {
    var t = item.table || { header: [], rows: [] };
    var groups = [], byKey = {};
    (t.rows || []).forEach(function (row) {
      var v = colIdx < row.length ? row[colIdx] : null;
      var text = cellText(v);
      var k = text === '' ? '\u0000' : text;
      var g = byKey[k];
      if (!g) {
        g = { key: k, label: (text === '' ? '（空白）' : text), rows: [] };
        byKey[k] = g;
        groups.push(g);
      }
      g.rows.push(row);
    });
    var labs = columnLabels(t);
    return {
      colIdx: colIdx,
      colLabel: (labs[colIdx] && labs[colIdx].label) || ('第 ' + (colIdx + 1) + ' 列'),
      total: (t.rows || []).length,
      groups: groups.map(function (g) {
        var tb = mkTable(t.header.slice(), g.rows, null);
        return { label: g.label, nRows: g.rows.length, table: tb };
      })
    };
  }

  function splitByRowCount(item, per) {
    var t = item.table || { header: [], rows: [] };
    var rows = t.rows || [];
    per = Math.floor(per);
    if (!(per > 0)) return { per: 0, total: rows.length, groups: [] };
    var groups = [];
    for (var i = 0; i < rows.length; i += per) {
      var chunk = rows.slice(i, i + per);
      groups.push({ label: '', index: groups.length + 1, nRows: chunk.length, table: mkTable(t.header.slice(), chunk, null) });
    }
    return { per: per, total: rows.length, groups: groups };
  }

  /* ====================== 写出 ====================== */

  function fitName(base, tailLen) {
    var b = String(base == null ? '' : base);
    var max = 31 - (tailLen || 0);
    if (max < 1) max = 1;
    return b.length > max ? b.slice(0, max) : b;
  }

  function uniqueSheetName(used, base) {
    var nm = H.cleanSheetName(fitName(base || '结果', 0)) || '结果';
    if (!used[nm]) { used[nm] = 1; return nm; }
    for (var i = 2; i < 9999; i++) {
      var tail = '_' + i;
      var cand = H.cleanSheetName(fitName(base || '结果', tail.length) + tail) || ('结果' + tail);
      if (!used[cand]) { used[cand] = 1; return cand; }
    }
    return nm;
  }

  function namePool(wb) {
    var used = {};
    (wb.worksheets || []).forEach(function (ws) { used[ws.name] = 1; });
    return used;
  }

  // 把一张表写进 ws（只写有值的格子，避免空气单元格把文件撑大）
  function writeInto(ws, table) {
    var header = (table && table.header) || [];
    var rows = (table && table.rows) || [];
    var nCols = header.length, i, j;
    for (i = 0; i < rows.length; i++) if (rows[i].length > nCols) nCols = rows[i].length;

    for (j = 0; j < header.length; j++) {
      var hv = header[j];
      if (hv === null || hv === undefined || hv === '') continue;
      ws.getCell(1, j + 1).value = hv;
    }
    for (i = 0; i < rows.length; i++) {
      var line = rows[i];
      for (j = 0; j < line.length; j++) {
        var v = line[j];
        if (v === null || v === undefined || v === '') continue;
        ws.getCell(i + 2, j + 1).value = v;
      }
    }
    H.applyHeaderStyle(ws, nCols || 1, rows.length + 1);
    return ws;
  }

  // 新增一个 sheet 并写入；名字自动去重（≤31 字符）
  function writeTable(wb, name, table) {
    var ws = wb.addWorksheet(uniqueSheetName(namePool(wb), name));
    return writeInto(ws, table);
  }

  // sheets: [{ name, table }]
  function writeAll(wb, sheets) {
    var used = namePool(wb);
    return (sheets || []).map(function (s) {
      var ws = wb.addWorksheet(uniqueSheetName(used, s.name));
      writeInto(ws, s.table);
      return ws;
    });
  }

  // 供 CSV 输出 / 测试断言用
  function matrixOf(table) {
    var out = [];
    if (table && table.header && table.header.length) out.push(table.header.slice());
    (table && table.rows ? table.rows : []).forEach(function (r) { out.push(r.slice()); });
    return out;
  }

  return {
    VERSION: VERSION,
    headerKey: headerKey,
    cellText: cellText,
    readTable: readTable,
    mergeTables: mergeTables,
    describeMerge: describeMerge,
    columnLabels: columnLabels,
    splitByColumn: splitByColumn,
    splitByRowCount: splitByRowCount,
    writeInto: writeInto,
    writeTable: writeTable,
    writeAll: writeAll,
    uniqueSheetName: uniqueSheetName,
    matrixOf: matrixOf,
    _internal: { cellValue: cellValue, fitName: fitName, mkTable: mkTable }
  };
});
