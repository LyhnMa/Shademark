import { newId, now } from './db';
import {
  loadTier, quoteRetentionDays,
} from './subscription';

/**
 * 报价单工具（/quote）— 全免费引流工具
 * ------------------------------------------------------------------
 * - 无额度限制：任何状态（未登录 / free / pro）均可导出报价单。
 * - 纯前端计算 + 打印；登录后每次「导出」自动落库为 quote_records（=历史记录）。
 * - 编号：QYYYYMMDD-XXX，XXX 为当日序号（001 起递增）。登录用户由服务端分配，
 *   保证同账号同日不重复、刷新不重复；未登录由前端 localStorage 计数（仅展示用）。
 * - 模板：登录用户可保存到 D1（quote_templates），并自动载入「上次使用的模板」。
 * - 历史保留：free 30 天 / pro 90 天（在 cleanup 中按等级清理，与平台政策一致）。
 */

// 一页最大条目数（前端同），防滥用
const MAX_ITEMS = 200;

export interface QuoteItem {
  name?: string;
  price?: number;
  qty?: number;
  note?: string;
}

export interface QuotePayload {
  buyer_name?: string;
  buyer_contact?: string;
  seller_name?: string;
  seller_contact?: string;
  seller_note?: string;
  validity_days?: number;
  tax_enabled?: boolean;
  tax_rate?: number;
  items?: QuoteItem[];
  note?: string;
  // 服务端根据服务端逻辑重新计算金额，不信任前端总额
}

export interface ComputedQuote {
  items: { name: string; price: number; qty: number; note: string; amount: number }[];
  total: number;
  tax_rate: number;
  tax_amount: number;
  grand_total: number;
  validity_days: number;
  tax_enabled: boolean;
}

/** 日期键 YYYYMMDD（本地时区，与前端一致地按浏览器本地日编号） */
function dateKey(ts = Date.now()): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
}

function r2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** 清洗并计算报价条目与金额（服务端权威计算，避免信任前端总额） */
export function computeQuote(p: QuotePayload): ComputedQuote {
  const validity = Math.max(1, Math.min(3650, Math.round(Number(p.validity_days) || 30)));
  const taxEnabled = !!p.tax_enabled;
  // 税率 0–100%（允许小数，如 6 或 6.5）
  let taxRate = Math.min(100, Math.max(0, Number(p.tax_rate) || 0));
  taxRate = r2(taxRate);

  const raw = Array.isArray(p.items) ? p.items.slice(0, MAX_ITEMS) : [];
  const items = raw.map(it => {
    const price = r2(Math.max(0, Number(it?.price) || 0));
    const qty = Math.max(0, Math.floor(Number(it?.qty) || 0));
    const amount = r2(price * qty);
    return {
      name: String(it?.name || '').trim().slice(0, 200),
      price,
      qty,
      note: String(it?.note || '').trim().slice(0, 300),
      amount,
    };
  }).filter(it => it.name || it.price > 0 || it.qty > 0);

  const total = r2(items.reduce((s, it) => s + it.amount, 0));
  const taxAmount = taxEnabled && taxRate > 0 ? r2(total * taxRate / 100) : 0;
  const grandTotal = r2(total + taxAmount);
  return { items, total, tax_rate: taxRate, tax_amount: taxAmount, grand_total: grandTotal, validity_days: validity, tax_enabled: taxEnabled };
}

/** 生成今日报价单编号（服务端分配，同账号同日递增，防重复） */
export async function nextQuoteNo(db: D1Database, userId: string, ts = now()): Promise<string> {
  const dk = dateKey(ts * 1000);
  // quote_no = QYYYYMMDD-XXX（固定 13 位，字典序 = 数值序）
  const prefix = `Q${dk}-`;
  const lo = `${prefix}000`;   // Q20260909-000
  const hi = `${prefix}999`;   // Q20260909-999
  // 用范围匹配避免 LIKE/GLOB（D1 对复杂 LIKE/GLOB 模式报 "pattern too complex"）
  const row = await db.prepare(
    `SELECT quote_no FROM quote_records
     WHERE user_id = ? AND quote_no >= ? AND quote_no <= ?
     ORDER BY quote_no DESC LIMIT 1`
  ).bind(userId, lo, hi).first<any>();
  const lastSeq = row?.quote_no ? parseInt((String(row.quote_no).match(/-(\d+)$/) || [])[1], 10) : 0;
  const seq = (Number.isFinite(lastSeq) ? lastSeq : 0) + 1;
  return `${prefix}${String(seq).padStart(3, '0')}`;
}

export interface GenerateResult {
  ok: boolean;
  error?: string;
  code?: 'invalid' | 'db';
  record?: any;
  retention_days?: number;
}

/** 导出即生成并保存（登录用户）。返回 record（含服务端分配的编号）。 */
export async function generateQuote(
  db: D1Database,
  userId: string,
  payload: QuotePayload
): Promise<GenerateResult> {
  const retention = quoteRetentionDays(await loadTier(db, userId));
  const c = computeQuote(payload);
  if (!c.items.length) {
    return { ok: false, code: 'invalid', error: '请至少填写一个报价条目' };
  }

  const quoteNo = await nextQuoteNo(db, userId);
  const id = newId();
  const ts = now();
  const str = (s?: string) => String(s || '').trim().slice(0, 500);
  try {
    await db.prepare(
      `INSERT INTO quote_records
        (id, user_id, quote_no, buyer_name, buyer_contact, seller_name, seller_contact,
         seller_note, validity_days, tax_enabled, tax_rate, items, note,
         total, tax_amount, grand_total, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      id, userId, quoteNo,
      str(payload.buyer_name), str(payload.buyer_contact),
      str(payload.seller_name), str(payload.seller_contact), str(payload.seller_note),
      c.validity_days, c.tax_enabled ? 1 : 0, c.tax_rate,
      JSON.stringify(c.items), str(payload.note),
      c.total, c.tax_amount, c.grand_total, ts
    ).run();
  } catch (e: any) {
    console.error('[quote] insert failed', e);
    return { ok: false, code: 'db', error: '保存失败，请重试' };
  }

  const record = {
    id, quote_no: quoteNo, buyer_name: str(payload.buyer_name),
    buyer_contact: str(payload.buyer_contact), seller_name: str(payload.seller_name),
    seller_contact: str(payload.seller_contact), seller_note: str(payload.seller_note),
    validity_days: c.validity_days, tax_enabled: c.tax_enabled, tax_rate: c.tax_rate,
    items: c.items, note: str(payload.note), total: c.total,
    tax_amount: c.tax_amount, grand_total: c.grand_total, created_at: ts,
  };
  return { ok: true, record, retention_days: retention };
}

export async function listQuoteHistory(
  db: D1Database,
  userId: string,
  limit = 100
): Promise<any[]> {
  const r = await db.prepare(
    `SELECT id, quote_no, buyer_name, grand_total, created_at
     FROM quote_records WHERE user_id = ?
     ORDER BY created_at DESC LIMIT ?`
  ).bind(userId, Math.max(1, Math.min(500, limit))).all<any>();
  return r.results || [];
}

export async function getQuote(db: D1Database, userId: string, id: string): Promise<any | null> {
  return db.prepare(
    `SELECT * FROM quote_records WHERE id = ? AND user_id = ?`
  ).bind(id, userId).first<any>();
}

export async function deleteQuote(db: D1Database, userId: string, id: string): Promise<boolean> {
  const q = await getQuote(db, userId, id);
  if (!q) return false;
  await db.prepare(`DELETE FROM quote_records WHERE id = ? AND user_id = ?`).bind(id, userId).run();
  return true;
}

/* ==================== 模板（D1，账号绑定） ==================== */

/** 单账号模板数量上限（防滥用） */
const MAX_TEMPLATES = 100;

export interface QuoteTemplate {
  id: string;
  name: string;
  /** 与前端 buildSheetData 一致的快照 */
  data: any;
  is_last: boolean;
  updated_at: number;
}

/** 列出该账号模板（按更新时间倒序，未登录返回 []） */
export async function listQuoteTemplates(
  db: D1Database,
  userId: string,
  limit = 100
): Promise<any[]> {
  const r = await db.prepare(
    `SELECT id, name, is_last, updated_at FROM quote_templates
     WHERE user_id = ?
     ORDER BY is_last DESC, updated_at DESC LIMIT ?`
  ).bind(userId, Math.max(1, Math.min(500, limit))).all<any>();
  return r.results || [];
}

/** 把模板行里的 data（可能为 JSON 字符串）解析为对象 */
function parseTemplate(row: any): any {
  if (!row) return null;
  if (typeof row.data === 'string') {
    try { row = { ...row, data: JSON.parse(row.data) }; } catch { row = { ...row, data: {} }; }
  }
  return row;
}

/** 读取单个模板完整 data */
export async function getQuoteTemplate(
  db: D1Database,
  userId: string,
  id: string
): Promise<any | null> {
  const row = await db.prepare(
    `SELECT * FROM quote_templates WHERE id = ? AND user_id = ?`
  ).bind(id, userId).first<any>();
  return parseTemplate(row);
}

/** 取该账号「上次使用」的模板（用于打开页面自动载入） */
export async function getLastQuoteTemplate(
  db: D1Database,
  userId: string
): Promise<any | null> {
  const row = await db.prepare(
    `SELECT * FROM quote_templates WHERE user_id = ? AND is_last = 1
     ORDER BY updated_at DESC LIMIT 1`
  ).bind(userId).first<any>();
  return parseTemplate(row);
}

/**
 * 保存 / 更新模板。
 * - 保存时若当前无模板内容带 id → 更新该模板；否则新建。
 * - 新模板默认名字如「模板 · N」，可在前端改名。
 * - 保存后置为 is_last=1（=最近使用），并把同账号其它模板 is_last 清零。
 */
export async function saveQuoteTemplate(
  db: D1Database,
  userId: string,
  opts: { id?: string; name?: string; data?: any; setLast?: boolean }
): Promise<{ ok: boolean; code?: string; error?: string; record?: any }> {
  const name = String(opts.name || '').trim().slice(0, 60);
  const data = opts.data || {};
  const ts = now();
  try {
    if (opts.id) {
      // 更新：校验归属
      const existing = await db.prepare(
        `SELECT id FROM quote_templates WHERE id = ? AND user_id = ?`
      ).bind(opts.id, userId).first<any>();
      if (!existing) return { ok: false, code: 'not_found', error: '模板不存在' };
      await db.prepare(
        `UPDATE quote_templates SET name = ?, data = ?, updated_at = ?
         WHERE id = ? AND user_id = ?`
      ).bind(name || '未命名模板', JSON.stringify(data), ts, opts.id, userId).run();
      if (opts.setLast) await markTemplateLast(db, userId, opts.id);
      const rec = await getQuoteTemplate(db, userId, opts.id);
      return { ok: true, record: rec };
    }
    // 新建：先限制数量
    const cnt = await db.prepare(
      `SELECT COUNT(*) AS c FROM quote_templates WHERE user_id = ?`
    ).bind(userId).first<any>();
    if ((cnt?.c || 0) >= MAX_TEMPLATES) {
      return { ok: false, code: 'limit', error: `最多保存 ${MAX_TEMPLATES} 份模板` };
    }
    const id = newId();
    await db.prepare(
      `INSERT INTO quote_templates (id, user_id, name, data, is_last, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(id, userId, name || '未命名模板', JSON.stringify(data), 0, ts, ts).run();
    if (opts.setLast) await markTemplateLast(db, userId, id);
    const rec = await getQuoteTemplate(db, userId, id);
    return { ok: true, record: rec };
  } catch (e: any) {
    console.error('[quote] save template failed', e);
    return { ok: false, code: 'db', error: '保存失败，请重试' };
  }
}

/** 把某模板置为「最近使用」，同账号其它模板清零 */
async function markTemplateLast(db: D1Database, userId: string, id: string): Promise<void> {
  await db.prepare(`UPDATE quote_templates SET is_last = 0 WHERE user_id = ?`).bind(userId).run();
  await db.prepare(`UPDATE quote_templates SET is_last = 1, updated_at = ? WHERE id = ? AND user_id = ?`)
    .bind(now(), id, userId).run();
}

export async function deleteQuoteTemplate(
  db: D1Database,
  userId: string,
  id: string
): Promise<boolean> {
  const q = await db.prepare(
    `SELECT id FROM quote_templates WHERE id = ? AND user_id = ?`
  ).bind(id, userId).first<any>();
  if (!q) return false;
  await db.prepare(`DELETE FROM quote_templates WHERE id = ? AND user_id = ?`).bind(id, userId).run();
  return true;
}
