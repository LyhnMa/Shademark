/*!
 * ShadeMark Excel 匹配对比引擎（UMD）
 * ============================================================
 * 纯数据层：不碰 DOM、不知道页面长什么样。
 * 浏览器：window.ShadeMarkExcelMatch
 * Node  ：require('./excel-match.js')  →  自动 require 前两个引擎
 *
 * 复用：
 *  - excel-clean.js 的 _helpers（取值口径 / 默认表头样式 / 表名清理 / 全角转半角）
 *  - excel-merge.js 的 readTable / writeInto / writeAll / columnLabels / cellText
 * 不重造第二套。
 *
 * 四个能力：
 *  1. crossJoin  按列横拼（多表按键对齐，外连接，全留）
 *  2. findDiff   找差异（只在 A / 只在 B / 都有但值不同）
 *  3. summarize  简单汇总（一列分组 + 一列聚合）
 *  4. crossTab   交叉汇总（行 × 列矩阵 + 小计 / 总计）
 *
 * 约定：
 *  - 表 = { header: [值...], rows: [[值...]...], nCols, nRows }
 *  - 表头 = 用到的第一行（不检测、不询问）
 *  - 键 = 该表若干列 → 每行算一个键串；组内 AND（所有键列都相等才算同一个键）
 *  - 键比对前机械清理（去首尾空格 + 全角转半角 + 统一小写），只用于比对，不改原表
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./excel-clean.js'), require('./excel-merge.js'));
  } else {
    root.ShadeMarkExcelMatch = factory(root.ShadeMarkExcelClean, root.ShadeMarkExcelMerge);
  }
})(typeof self !== 'undefined' ? self : this, function (CLEAN, MERGE) {
  'use strict';

  var VERSION = '1.0.0';

  if (!CLEAN || !CLEAN._helpers) throw new Error('excel-match.js 需要先加载 excel-clean.js（缺 _helpers）');
  if (!MERGE) throw new Error('excel-match.js 需要先加载 excel-merge.js');
  var H = CLEAN._helpers;

  var SEP = '\u0001';          // 多列键内部拼接符（不会出现在正常单元格文本里）
  var BLANK = '\u0000';        // 空值占位

  /* ====================== 键 ====================== */

  // 值 → 比对用文本：去首尾空格 + 全角转半角 + 统一小写
  function cleanKey(v) {
    if (v === null || v === undefined) return '';
    var s = v instanceof Date ? H.fmtDate(v, 'yyyy-mm-dd') : (typeof v === 'object' ? H.display(v) : String(v));
    s = s.replace(/[\u00A0\u3000]/g, ' ');            // NBSP / 全角空格当普通空格
    if (H.toHalfwidth) s = H.toHalfwidth(s);          // 全角 → 半角
    s = s.replace(/^\s+|\s+$/g, '');                  // 去首尾空格
    return s.toLowerCase();                           // 统一大小写
  }

  // 值 → 比对用文本（宽松版：只去首尾空格 + NBSP 归空格，大小写敏感）
  // 用于「值不同」的判断：不该把 A 和 a 判成相同
  function cleanValue(v) {
    if (v === null || v === undefined) return '';
    var s = v instanceof Date ? H.fmtDate(v, 'yyyy-mm-dd') : (typeof v === 'object' ? H.display(v) : String(v));
    return s.replace(/[\u00A0\u3000]/g, ' ').replace(/^\s+|\s+$/g, '');
  }

  // 一行 → 键串；keys=[] → 空（调用方负责拦）
  function rowKey(row, keys) {
    if (!keys || !keys.length) return BLANK;
    var parts = [];
    for (var i = 0; i < keys.length; i++) {
      var v = keys[i] < row.length ? row[keys[i]] : null;
      var s = cleanKey(v);
      parts.push(s === '' ? BLANK : s);
    }
    return parts.join(SEP);
  }

  // 键串 → 给人看的标签（用原值，不显示清理后的）
  function keyLabel(row, keys) {
    var parts = [];
    for (var i = 0; i < keys.length; i++) {
      var v = keys[i] < row.length ? row[keys[i]] : null;
      var s = MERGE.cellText(v);
      parts.push(s === '' ? '（空白）' : s);
    }
    return parts.join(' + ');
  }

  var KEY_HINTS = [
    ['工号', 10], ['员工号', 10], ['编号', 9], ['单号', 9], ['订单号', 9], ['订单编号', 9],
    ['身份证', 10], ['证件号', 10], ['身份证号', 10], ['手机号', 10], ['手机', 9], ['电话', 8],
    ['编码', 8], ['号码', 8], ['账号', 8], ['卡号', 8], ['学号', 8], ['客户号', 8], ['商品号', 8],
    ['邮箱', 7], ['名称', 5], ['姓名', 5], ['客户', 5], ['编号', 7],
    ['id', 9], ['code', 8], ['no', 6], ['sn', 7], ['key', 6], ['email', 7], ['sku', 9], ['uid', 9]
  ];

  // 猜键列：列名命中关键词 → 越靠前分数越高。返回 [{index,label,hit}]
  function guessKeys(table) {
    var labs = MERGE.columnLabels(table);
    var out = [];
    labs.forEach(function (l) {
      var k = cleanKey(l.raw);
      if (k === '') return;
      var score = 0;
      for (var i = 0; i < KEY_HINTS.length; i++) {
        var h = KEY_HINTS[i];
        if (k.indexOf(h[0]) >= 0) score = Math.max(score, h[1]);
      }
      if (score > 0) out.push({ index: l.index, label: l.label, hit: score });
    });
    out.sort(function (a, b) { return b.hit - a.hit || a.index - b.index; });
    return out;
  }

  /* ====================== 公共：把选中列算成输出列 ====================== */

  // items: [{ label, table, keys:[idx], picks:[idx] }]
  function normalizeItems(items) {
    return (items || []).map(function (it) {
      var t = it.table || { header: [], rows: [], nCols: 0 };
      var keys = (it.keys || []).map(Number).filter(function (i) { return i >= 0 && i < (t.header || []).length; });
      var pick = (it.picks || []).map(Number).filter(function (i) { return i >= 0 && i < (t.header || []).length; });
      return { label: it.label, table: t, keys: keys, picks: pick };
    });
  }

  // 默认：键列猜第一命中；贴的列 = 除键列外全部
  function defaultConfig(items) {
    return normalizeItems(items).map(function (it) {
      var g = guessKeys(it.table);
      var keys = g.length ? [g[0].index] : [];
      var picks = [];
      (it.table.header || []).forEach(function (_, i) { if (keys.indexOf(i) < 0) picks.push(i); });
      return { label: it.label, table: it.table, keys: keys, picks: picks, guess: g };
    });
  }

  function labelOf(table, i) {
    var labs = MERGE.columnLabels(table);
    return (labs[i] && labs[i].label) || ('第 ' + (i + 1) + ' 列');
  }

  /* ====================== 1. 按列横拼 ====================== */

  /*
   * 外连接：键值并起来全留。不做「多出来的怎么办」的选择。
   * 同一个键在同一张表里有多行时：按位置 zip（不炸笛卡尔积），并在 info.dupKeys 里报重复键个数。
   */
  function crossJoin(items) {
    var its = normalizeItems(items);
    if (its.length < 2) return emptyResult('至少勾 2 张表');

    var keySlots = [];            // { label, byTable: {表序号: 列下标} }
    var keyByLabel = {};
    var pickSlots = [];           // { label, base, tableIdx, colIdx }
    var baseCount = {};

    // 1) 键列：跨表按「清理后的列名」合并成一列
    its.forEach(function (it, ti) {
      it.keys.forEach(function (ci) {
        var k = cleanKey(it.table.header[ci]);
        var slot;
        if (k !== '' && keyByLabel[k] !== undefined) {
          slot = keyByLabel[k];
        } else {
          slot = keySlots.length;
          keySlots.push({ label: labelOf(it.table, ci), byTable: {} });
          if (k !== '') keyByLabel[k] = slot;
        }
        if (keySlots[slot].byTable[ti] === undefined) keySlots[slot].byTable[ti] = ci;
      });
    });

    // 2) 贴的列
    its.forEach(function (it, ti) {
      it.picks.forEach(function (ci) {
        var base = labelOf(it.table, ci);
        pickSlots.push({ base: base, tableIdx: ti, colIdx: ci });
        baseCount[base] = (baseCount[base] || 0) + 1;
      });
    });
    keySlots.forEach(function (s) { baseCount[s.label] = (baseCount[s.label] || 0) + 1; });

    // 3) 重名才加表名前缀（对称：同名的都加）
    pickSlots.forEach(function (s) {
      s.label = baseCount[s.base] > 1 ? (its[s.tableIdx].label + '·' + s.base) : s.base;
    });

    // 4) 行：键首次出现顺序
    var order = [], byKey = {};
    its.forEach(function (it, ti) {
      var rows = it.table.rows || [];
      for (var r = 0; r < rows.length; r++) {
        var k = rowKey(rows[r], it.keys);
        var e = byKey[k];
        if (!e) { e = byKey[k] = { key: k, rows: [], first: rows[r], firstTable: ti }; order.push(e); }
        e.rows[ti] = e.rows[ti] || [];
        e.rows[ti].push(r);
      }
    });

    var outHeader = keySlots.map(function (s) { return s.label; })
      .concat(pickSlots.map(function (s) { return s.label; }));
    var nKey = keySlots.length;
    var outRows = [];
    var dupKeys = 0, onlyOne = 0;

    order.forEach(function (e) {
      var counts = [];
      its.forEach(function (_, ti) { counts.push((e.rows[ti] || []).length); });
      var mult = Math.max.apply(null, counts.concat([0]));
      var maxSide = Math.max.apply(null, counts.concat([0]));
      if (maxSide > 1) dupKeys++;
      if (counts.filter(function (c) { return c > 0; }).length === 1) onlyOne++;

      for (var m = 0; m < mult; m++) {
        var line = new Array(outHeader.length);
        for (var z = 0; z < outHeader.length; z++) line[z] = null;

        // 键列：谁有值就用谁的原值（第一张有值的表）
        keySlots.forEach(function (s, si) {
          for (var ti = 0; ti < its.length; ti++) {
            var ci = s.byTable[ti];
            if (ci === undefined) continue;
            var ridx = (e.rows[ti] || [])[m];          // 该表这一位置上没有行 → 留空，不重复上一行
            if (ridx === undefined) continue;
            var v = ridx < its[ti].table.rows.length ? its[ti].table.rows[ridx][ci] : null;
            if (v !== null && v !== undefined && v !== '') { line[si] = v; break; }
          }
        });
        // 贴的列
        pickSlots.forEach(function (s, si) {
          var ridx = (e.rows[s.tableIdx] || [])[m];
          if (ridx === undefined) return;
          var row = its[s.tableIdx].table.rows[ridx] || [];
          var v = s.colIdx < row.length ? row[s.colIdx] : null;
          line[nKey + si] = (v === undefined) ? null : v;
        });
        outRows.push(line);
      }
    });

    var t = MERGE._internal.mkTable(outHeader, outRows, null);
    t.keySlots = keySlots;
    t.pickSlots = pickSlots;
    t.items = its;
    t.stats = {
      tables: its.length,
      keys: nKey,
      cols: outHeader.length,
      rows: outRows.length,
      joinedKeys: order.length,
      dupKeys: dupKeys,
      singleSideKeys: onlyOne
    };
    return t;
  }

  function emptyResult(msg) {
    var t = MERGE._internal.mkTable([], [], null);
    t.error = msg || '参数不足';
    t.stats = { tables: 0, keys: 0, cols: 0, rows: 0, joinedKeys: 0, dupKeys: 0, singleSideKeys: 0 };
    return t;
  }

  // 横拼预览（便宜：只看表头 + 行数，不做整表连接）
  function describeJoin(items) {
    var its = normalizeItems(items);
    var cols = 0, rows = 0, seen = {}, seenKeys = {};
    var keyLabels = [];
    its.forEach(function (it) {
      rows += (it.table.rows || []).length;
      it.picks.forEach(function (ci) {
        var base = labelOf(it.table, ci);
        if (seen[base] === undefined) { seen[base] = 0; }
        seen[base]++;
        cols++;
      });
      it.keys.forEach(function (ci) {
        var raw = labelOf(it.table, ci);
        var k = cleanKey(it.table.header[ci]);
        if (k === '') k = '\u0000' + ci + '|' + it.label;
        if (seenKeys[k] === undefined) { seenKeys[k] = 1; cols++; keyLabels.push(raw); }
      });
    });
    return { tables: its.length, cols: cols, inRows: rows, keyLabels: keyLabels };
  }

  /* ====================== 2. 找差异 ====================== */

  /*
   * 两类都用：只处理 2 张表（「只在 A 有 / 只在 B 有」本身就是两方）。
   * 输出一张带「差异类型」标记的表，不是三张。
   */
  function findDiff(items) {
    var its = normalizeItems(items);
    if (its.length !== 2) return emptyResult('找差异需要正好 2 张表');

    var A = its[0], B = its[1];
    var keySlots = [], keyByLabel = {};
    [A, B].forEach(function (it, ti) {
      it.keys.forEach(function (ci) {
        var k = cleanKey(it.table.header[ci]);
        var slot;
        if (k !== '' && keyByLabel[k] !== undefined) slot = keyByLabel[k];
        else {
          slot = keySlots.length;
          keySlots.push({ label: labelOf(it.table, ci), byTable: {} });
          if (k !== '') keyByLabel[k] = slot;
        }
        if (keySlots[slot].byTable[ti] === undefined) keySlots[slot].byTable[ti] = ci;
      });
    });

    // 两边的贴列：同名（base label）的成对比较
    function pickList(it, ti) {
      return it.picks.map(function (ci) {
        return { base: labelOf(it.table, ci), tableIdx: ti, colIdx: ci };
      });
    }
    var pkA = pickList(A, 0), pkB = pickList(B, 1);
    var cntA = {}, cntB = {};
    pkA.forEach(function (p) { cntA[p.base] = 1; });
    pkB.forEach(function (p) { cntB[p.base] = 1; });

    var baseCount = {};
    pkA.concat(pkB).forEach(function (p) { baseCount[p.base] = (baseCount[p.base] || 0) + 1; });
    keySlots.forEach(function (s) { baseCount[s.label] = (baseCount[s.label] || 0) + 1; });
    var commonBases = [];
    pkA.forEach(function (p) { if (cntB[p.base] && commonBases.indexOf(p.base) < 0) commonBases.push(p.base); });

    var slots = [];
    keySlots.forEach(function (s) { slots.push({ kind: 'key', label: s.label, byTable: s.byTable }); });
    pkA.forEach(function (p) { slots.push({ kind: 'pick', side: 0, label: baseCount[p.base] > 1 ? (A.label + '·' + p.base) : p.base, colIdx: p.colIdx }); });
    pkB.forEach(function (p) { slots.push({ kind: 'pick', side: 1, label: baseCount[p.base] > 1 ? (B.label + '·' + p.base) : p.base, colIdx: p.colIdx }); });

    var diffCol = slots.length;            // 差异类型列的下标
    var header = slots.map(function (s) { return s.label; }).concat(['差异类型']);
    var rows = [];

    // 用数组记顺序，不用 Object.keys（纯数字键会被数值重排，行序就乱了）
    var mapA = {}, mapB = {}, orderA = [], orderB = [];
    (A.table.rows || []).forEach(function (r, i) {
      var k = rowKey(r, A.keys);
      if (!mapA[k]) { mapA[k] = []; orderA.push(k); }
      mapA[k].push(i);
    });
    (B.table.rows || []).forEach(function (r, i) {
      var k = rowKey(r, B.keys);
      if (!mapB[k]) { mapB[k] = []; orderB.push(k); }
      mapB[k].push(i);
    });

    var out = [];
    orderA.forEach(function (k) { out.push({ k: k }); });
    orderB.forEach(function (k) { if (mapA[k] === undefined) out.push({ k: k }); });

    var count = { onlyA: 0, onlyB: 0, diff: 0 };

    out.forEach(function (o) {
      var listA = mapA[o.k] || [], listB = mapB[o.k] || [];
      var mult = Math.max(listA.length, listB.length, 1);
      for (var m = 0; m < mult; m++) {
        var ia = listA[m], ib = listB[m];
        var ra = ia === undefined ? null : A.table.rows[ia];
        var rb = ib === undefined ? null : B.table.rows[ib];
        var type;
        if (!rb) type = '只在A有';
        else if (!ra) type = '只在B有';
        else {
          var changed = false;
          for (var i = 0; i < commonBases.length; i++) {
            var b = commonBases[i];
            var pa = null, pb = null;
            pkA.forEach(function (p) { if (p.base === b) pa = p; });
            pkB.forEach(function (p) { if (p.base === b) pb = p; });
            if (!pa || !pb) continue;
            var va = ra[pa.colIdx], vb = rb[pb.colIdx];
            if (cleanValue(va) !== cleanValue(vb)) { changed = true; break; }
          }
          if (!changed) continue;              // 完全一样 → 不进结果
          type = '都有但值不同';
        }
        if (type === '只在A有') count.onlyA++;
        else if (type === '只在B有') count.onlyB++;
        else count.diff++;

        var line = new Array(header.length);
        for (var z = 0; z < header.length; z++) line[z] = null;
        slots.forEach(function (s, si) {
          if (s.kind === 'key') {
            var primary = (type === '只在B有') ? 1 : 0;
            var other = 1 - primary;
            var v = null;
            var ci = s.byTable[primary];
            var prow = primary === 0 ? ra : rb;
            if (ci !== undefined && prow) v = ci < prow.length ? prow[ci] : null;
            if (v === null || v === undefined || v === '') {
              var ci2 = s.byTable[other];
              var orow = other === 0 ? ra : rb;
              if (ci2 !== undefined && orow) v = ci2 < orow.length ? orow[ci2] : null;
            }
            line[si] = (v === undefined) ? null : v;
            return;
          }
          var side = s.side === 0 ? ra : rb;
          if (!side) { line[si] = null; return; }
          var vv = s.colIdx < side.length ? side[s.colIdx] : null;
          line[si] = (vv === undefined) ? null : vv;
        });
        line[diffCol] = type;
        rows.push(line);
      }
    });

    var t = MERGE._internal.mkTable(header, rows, null);
    t.slots = slots;
    t.counts = count;
    t.stats = {
      tables: 2, cols: header.length, rows: rows.length,
      onlyA: count.onlyA, onlyB: count.onlyB, diff: count.diff,
      keysA: (A.table.rows || []).length, keysB: (B.table.rows || []).length
    };
    return t;
  }

  /* ====================== 3. 简单汇总 ====================== */

  function isNum(v) { return typeof v === 'number' && isFinite(v); }

  function aggregate(values, agg) {
    var nums = [], nonEmpty = 0;
    values.forEach(function (v) {
      if (v === null || v === undefined || v === '') return;
      nonEmpty++;
      if (isNum(v)) nums.push(v);
      else if (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v.trim())) nums.push(parseFloat(v));
    });
    if (agg === 'count') return nonEmpty;
    if (agg === 'avg') {
      if (!nums.length) return null;
      return round6(nums.reduce(function (a, b) { return a + b; }, 0) / nums.length);
    }
    return round6(nums.reduce(function (a, b) { return a + b; }, 0));
  }

  function round6(x) { return Math.round(x * 1e6) / 1e6; }

  var AGG_LABEL = { sum: '求和', count: '计数', avg: '平均' };

  function summarize(item, groupIdx, valueIdx, agg) {
    var it = normalizeItems([item])[0];
    if (!it) return emptyResult('没有表');
    var t = it.table;
    var rows = t.rows || [];
    var groups = [], byKey = {};
    rows.forEach(function (r) {
      var raw = groupIdx < r.length ? r[groupIdx] : null;
      var k = cleanValue(raw);
      var e = byKey[k];
      if (!e) { e = byKey[k] = { label: k === '' ? '（空白）' : raw, values: [], n: 0 }; groups.push(e); }
      e.n++;
      e.values.push(valueIdx < r.length ? r[valueIdx] : null);
    });

    var outHeader = [labelOf(t, groupIdx), labelOf(t, valueIdx) + '（' + (AGG_LABEL[agg] || '求和') + '）'];
    var outRows = groups.map(function (g) { return [g.label, aggregate(g.values, agg)]; });

    var out = [];
    for (var i = 0; i < outRows.length; i++) out.push(outRows[i]);

    var res = MERGE._internal.mkTable(outHeader, out, null);
    res.stats = { groups: groups.length, rows: out.length, groupIdx: groupIdx, valueIdx: valueIdx, agg: agg };
    return res;
  }

  /* ====================== 4. 交叉汇总 ====================== */

  /*
   * 单行维度 + 单列维度 → 矩阵。不做嵌套。
   * opts.subtotal：加「小计」行 + 「小计」列（右下角即总和）
   * opts.total   ：再加一行「总计」；若已开小计，只在小计列填总和（避免重复一堆数）
   */
  function crossTab(item, rowIdx, colIdx, valueIdx, agg, opts) {
    opts = opts || {};
    var it = normalizeItems([item])[0];
    if (!it) return emptyResult('没有表');
    var t = it.table;
    var rows = t.rows || [];

    var rowOrder = [], rowBy = {}, colOrder = [], colBy = {};
    var cell = {};                       // "ri|ci" → [值...]
    rows.forEach(function (r) {
      var rv = rowIdx < r.length ? r[rowIdx] : null;
      var cv = colIdx < r.length ? r[colIdx] : null;
      var rk = cleanValue(rv), ck = cleanValue(cv);
      var rl = rk === '' ? '（空白）' : rv;
      var cl = ck === '' ? '（空白）' : cv;
      if (rowBy[rk] === undefined) { rowBy[rk] = rowOrder.length; rowOrder.push({ key: rk, label: rl }); }
      if (colBy[ck] === undefined) { colBy[ck] = colOrder.length; colOrder.push({ key: ck, label: cl }); }
      var kk = rowBy[rk] + '|' + colBy[ck];
      (cell[kk] = cell[kk] || []).push(valueIdx < r.length ? r[valueIdx] : null);
    });

    var nR = rowOrder.length, nC = colOrder.length;
    var head = [labelOf(t, rowIdx) + ' ＼ ' + labelOf(t, colIdx)];
    colOrder.forEach(function (c) { head.push(c.label); });
    if (opts.subtotal) head.push('小计');

    var grid = [];
    for (var i = 0; i < nR; i++) {
      var line = [rowOrder[i].label];
      var rowTotal = [];
      for (var j = 0; j < nC; j++) {
        var vals = cell[i + '|' + j];
        line.push(vals ? aggregate(vals, agg) : null);
        if (vals) rowTotal = rowTotal.concat(vals);
      }
      if (opts.subtotal) line.push(aggregate(rowTotal, agg));
      grid.push(line);
    }

    if (opts.subtotal) {
      var sub = ['小计'];
      var all = [];
      for (var j2 = 0; j2 < nC; j2++) {
        var colVals = [];
        for (var i2 = 0; i2 < nR; i2++) {
          var v2 = cell[i2 + '|' + j2];
          if (v2) colVals = colVals.concat(v2);
        }
        sub.push(colVals.length ? aggregate(colVals, agg) : null);
        all = all.concat(colVals);
      }
      sub.push(all.length ? aggregate(all, agg) : null);
      grid.push(sub);
    }

    if (opts.total) {
      var tot = ['总计'];
      var allVals = [];
      Object.keys(cell).forEach(function (k) { allVals = allVals.concat(cell[k]); });
      var grand = allVals.length ? aggregate(allVals, agg) : null;
      if (opts.subtotal) {
        for (var j3 = 0; j3 < nC; j3++) tot.push(null);     // 小计行已给过列合计 → 总计只补右下角
        tot.push(grand);
      } else {
        for (var j4 = 0; j4 < nC; j4++) {
          var cv = [];
          for (var i4 = 0; i4 < nR; i4++) { var v4 = cell[i4 + '|' + j4]; if (v4) cv = cv.concat(v4); }
          tot.push(cv.length ? aggregate(cv, agg) : null);
        }
        tot.push(grand);
      }
      grid.push(tot);
    }

    var res = MERGE._internal.mkTable(head, grid, null);
    res.matrix = { nR: nR, nC: nC, subtotal: !!opts.subtotal, total: !!opts.total };
    res.stats = {
      rows: grid.length, cols: head.length, nR: nR, nC: nC,
      rowIdx: rowIdx, colIdx: colIdx, valueIdx: valueIdx, agg: agg,
      subtotal: !!opts.subtotal, total: !!opts.total
    };
    return res;
  }

  /* ====================== 写出：行标题列也当表头 ====================== */

  // 把第 1 列的数据格也套上表头样式（交叉汇总的行标题列）
  function styleHeadCol(ws, nRows) {
    if (!ws || !(nRows > 1)) return ws;
    var HEAD_BG = 'FFF2F2F2', INK = 'FF2B2926';
    for (var r = 2; r <= nRows; r++) {
      var c = ws.getRow(r).getCell(1);
      c.font = { bold: true, color: { argb: INK } };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEAD_BG } };
      c.border = { bottom: { style: 'thin', color: { argb: INK } } };
    }
    return ws;
  }

  // 写一张表并套样式；opts.headCol → 行标题列也当表头
  function writeMatrix(wb, name, table, opts) {
    opts = opts || {};
    var ws = MERGE.writeTable(wb, name, table);
    if (opts.headCol) styleHeadCol(ws, (table.rows || []).length + 1);
    return ws;
  }

  return {
    VERSION: VERSION,
    cleanKey: cleanKey,
    cleanValue: cleanValue,
    rowKey: rowKey,
    keyLabel: keyLabel,
    guessKeys: guessKeys,
    defaultConfig: defaultConfig,
    labelOf: labelOf,
    normalizeItems: normalizeItems,
    describeJoin: describeJoin,
    crossJoin: crossJoin,
    findDiff: findDiff,
    summarize: summarize,
    aggregate: aggregate,
    crossTab: crossTab,
    styleHeadCol: styleHeadCol,
    writeMatrix: writeMatrix,
    AGG_LABEL: AGG_LABEL,
    _internal: { SEP: SEP, BLANK: BLANK, isNum: isNum, round6: round6 }
  };
});
