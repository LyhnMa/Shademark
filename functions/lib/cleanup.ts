import { now } from './db';
import { orderRetentionDays, linkRetentionDays, quoteRetentionDays, proRetentionSql } from './subscription';

/**
 * 过期数据清理（按「平台统一订阅」等级分档保留）
 * free：订单 / 验证日志 / 点击记录 30 天
 * pro ：订单 / 验证日志 / 点击记录 90 天
 *
 * 「pro 档」= 现在是 Pro **或曾经是 Pro**（ever_pro=1）：降级不删数据，
 * 续费回来历史还在。数据只会因为「从未开过 Pro 且超 30 天」被清理。
 */
export async function cleanupExpiredData(db: D1Database): Promise<void> {
  const nowSec = now();
  const pro = proRetentionSql('u');

  const codeFree = nowSec - orderRetentionDays('free') * 86400;
  const codePro = nowSec - orderRetentionDays('pro') * 86400;
  const clickFree = nowSec - linkRetentionDays('free') * 86400;
  const clickPro = nowSec - linkRetentionDays('pro') * 86400;
  const quoteFree = nowSec - quoteRetentionDays('free') * 86400;
  const quotePro = nowSec - quoteRetentionDays('pro') * 86400;

  // 1. 订单（仅取消 / 退款）及其激活码、验证日志
  for (const t of [
    { cutoff: codeFree, cond: `NOT ${pro}` },
    { cutoff: codePro, cond: pro },
  ]) {
    const oldOrders = await db.prepare(
      `SELECT o.id FROM orders o
       JOIN products p ON o.product_id = p.id
       JOIN users u ON p.developer_id = u.id
       WHERE o.created_at < ? AND o.status IN ('cancelled', 'refunded') AND ${t.cond}`
    ).bind(t.cutoff).all<any>();

    for (const order of oldOrders.results || []) {
      const codes = await db.prepare(
        `SELECT id FROM activation_codes WHERE order_id = ?`
      ).bind(order.id).all<any>();
      for (const code of codes.results || []) {
        await db.prepare(`DELETE FROM verification_logs WHERE code_id = ?`).bind(code.id).run();
      }
      await db.prepare(`DELETE FROM activation_codes WHERE order_id = ?`).bind(order.id).run();
    }

    await db.prepare(
      `DELETE FROM orders WHERE id IN (
         SELECT o.id FROM orders o
         JOIN products p ON o.product_id = p.id
         JOIN users u ON p.developer_id = u.id
         WHERE o.created_at < ? AND o.status IN ('cancelled', 'refunded') AND ${t.cond}
       )`
    ).bind(t.cutoff).run();
  }

  // 2. 验证日志：free 保留 30 天；无法归属（code_id 为空）的按 free 处理
  await db.prepare(
    `DELETE FROM verification_logs
     WHERE created_at < ?
       AND (
         code_id IS NULL
         OR code_id NOT IN (
           SELECT ac.id FROM activation_codes ac
           JOIN products p ON ac.product_id = p.id
           JOIN users u ON p.developer_id = u.id
           WHERE ${pro}
         )
       )`
  ).bind(codeFree).run();
  await db.prepare(`DELETE FROM verification_logs WHERE created_at < ?`).bind(codePro).run();

  // 3. 短链点击记录：free 保留 30 天，pro 保留 90 天
  await db.prepare(
    `DELETE FROM link_clicks
     WHERE clicked_at < ?
       AND link_id IN (
         SELECT l.id FROM links l
         JOIN users u ON l.developer_id = u.id
         WHERE NOT ${pro}
       )`
  ).bind(clickFree).run();
  await db.prepare(`DELETE FROM link_clicks WHERE clicked_at < ?`).bind(clickPro).run();

  // 3.5 报价单历史：free 保留 30 天，pro 保留 90 天
  await db.prepare(
    `DELETE FROM quote_records
     WHERE created_at < ?
       AND user_id IN (SELECT u.id FROM users u WHERE NOT ${pro})`
  ).bind(quoteFree).run();
  await db.prepare(`DELETE FROM quote_records WHERE created_at < ?`).bind(quotePro).run();

  // 4. 过期会话
  const sessionsCutoff = nowSec - 30 * 86400;
  await db.prepare(`DELETE FROM sessions WHERE created_at < ?`).bind(sessionsCutoff).run();

  // 4.5 密码重置令牌：无论用过没用过，留 2 天便于排障后清理
  await db.prepare(`DELETE FROM password_reset_tokens WHERE created_at < ?`)
    .bind(nowSec - 2 * 86400)
    .run();

  console.log(`[cleanup] 清理完成 at ${new Date().toISOString()}`);
}

export function getCronSchedule(): string {
  // 每小时跑一次
  return '0 * * * *';
}
