import { newId, now, jsonResponse, errorResponse } from './db';
import { claimCode } from './codes';

export async function createOrder(
  db: D1Database,
  productId: string,
  buyerEmail: string,
  amount: number
): Promise<{ id: string; order_number: string }> {
  const id = newId();
  const order_number = `ORD-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;

  await db.prepare(
    `INSERT INTO orders (id, order_number, product_id, buyer_email, amount, status, created_at)
     VALUES (?, ?, ?, ?, ?, 'pending', ?)`
  ).bind(id, order_number, productId, buyerEmail, amount, now()).run();

  return { id, order_number };
}

export async function confirmOrder(
  db: D1Database,
  orderId: string,
  developerId?: string
): Promise<{ success: boolean; code?: string; error?: string }> {
  const order = await db.prepare(`SELECT * FROM orders WHERE id = ?`).bind(orderId).first<any>();
  if (!order) return { success: false, error: '订单不存在' };

  // 归属校验：该订单的商品必须属于当前开发者，否则拒绝
  if (developerId) {
    const owned = await db.prepare(
      `SELECT p.id FROM products p WHERE p.id = ? AND p.developer_id = ?`
    ).bind(order.product_id, developerId).first();
    if (!owned) return { success: false, error: '无权操作该订单' };
  }

  if (order.status === 'delivered') {
    // 幂等：已发码，返回已有激活码
    const code = await db.prepare(
      `SELECT code_value FROM activation_codes WHERE id = ?`
    ).bind(order.activation_code_id).first<{ code_value: string }>();
    return { success: true, code: code?.code_value };
  }
  if (order.status !== 'pending' && order.status !== 'paid') {
    return { success: false, error: '订单状态不允许确认' };
  }

  // 获取商品归属信息（发码不再重算有效期——expires_at 已在生成激活码时按商品有效期写入）
  const product = await db.prepare(
    `SELECT id FROM products WHERE id = ?`
  ).bind(order.product_id).first<any>();
  if (!product) return { success: false, error: '商品不存在' };

  // 原子领取激活码
  const codeRow = await claimCode(db, product.id);
  if (!codeRow) return { success: false, error: '激活码库存不足' };

  // 生效时间 = 确认收款(发码)时刻；有效期 expires_at 保持生成时的值，不再重算
  const issuedAt = now();

  await db.prepare(
    `UPDATE orders SET status = 'delivered', activation_code_id = ?, delivered_at = ? WHERE id = ?`
  ).bind(codeRow.id, issuedAt, orderId).run();

  await db.prepare(
    `UPDATE activation_codes SET order_id = ?, issued_at = ? WHERE id = ?`
  ).bind(orderId, issuedAt, codeRow.id).run();

  return { success: true, code: codeRow.code_value };
}

export async function cancelOrder(db: D1Database, orderId: string, developerId?: string): Promise<{ success: boolean; error?: string }> {
  const order = await db.prepare(`SELECT * FROM orders WHERE id = ?`).bind(orderId).first<any>();
  if (!order) return { success: false, error: '订单不存在' };

  // 归属校验
  if (developerId) {
    const owned = await db.prepare(
      `SELECT p.id FROM products p WHERE p.id = ? AND p.developer_id = ?`
    ).bind(order.product_id, developerId).first();
    if (!owned) return { success: false, error: '无权操作该订单' };
  }

  if (order.status === 'delivered') return { success: false, error: '已发码订单不可取消' };

  await db.prepare(
    `UPDATE orders SET status = 'cancelled' WHERE id = ?`
  ).bind(orderId).run();

  return { success: true };
}

// 退款并作废：仅 delivered 订单可退款；订单 → refunded，关联激活码 → revoked
export async function refundOrder(db: D1Database, orderId: string, developerId?: string): Promise<{ success: boolean; error?: string }> {
  const order = await db.prepare(`SELECT * FROM orders WHERE id = ?`).bind(orderId).first<any>();
  if (!order) return { success: false, error: '订单不存在' };

  if (developerId) {
    const owned = await db.prepare(
      `SELECT p.id FROM products p WHERE p.id = ? AND p.developer_id = ?`
    ).bind(order.product_id, developerId).first();
    if (!owned) return { success: false, error: '无权操作该订单' };
  }

  if (order.status !== 'delivered') return { success: false, error: '仅已发码订单可退款并作废' };

  await db.prepare(`UPDATE orders SET status = 'refunded' WHERE id = ?`).bind(orderId).run();
  if (order.activation_code_id) {
    await db.prepare(`UPDATE activation_codes SET status = 'revoked' WHERE id = ?`)
      .bind(order.activation_code_id).run();
  }

  return { success: true };
}

export async function getOrders(
  db: D1Database,
  developerId?: string,
  status?: string,
  productId?: string
): Promise<any[]> {
  // developerId 传入时仅返回该开发者名下商品的订单，避免跨卖家越权
  let sql = `
    SELECT o.*, p.name as product_name, ac.code_value as code_value, ac.status as code_status,
           ac.expires_at as code_expires_at
    FROM orders o
    LEFT JOIN products p ON o.product_id = p.id
    LEFT JOIN activation_codes ac ON o.activation_code_id = ac.id
    WHERE 1=1
  `;
  const params: any[] = [];
  if (developerId) {
    sql += ` AND p.developer_id = ?`;
    params.push(developerId);
  }
  if (status) {
    sql += ` AND o.status = ?`;
    params.push(status);
  }
  if (productId) {
    sql += ` AND o.product_id = ?`;
    params.push(productId);
  }
  sql += ` ORDER BY o.created_at DESC LIMIT 300`;
  return db.prepare(sql).bind(...params).all<any>();
}

export async function getOrderNumber(db: D1Database, orderNumber: string): Promise<any> {
  return db.prepare(
    `SELECT o.*, p.name as product_name
     FROM orders o
     LEFT JOIN products p ON o.product_id = p.id
     WHERE o.order_number = ?`
  ).bind(orderNumber).first<any>();
}

export async function queryOrder(
  db: D1Database,
  orderNumber: string,
  buyerEmail: string
): Promise<{ success: boolean; order?: any; error?: string }> {
  const order = await db.prepare(
    `SELECT o.*, p.name as product_name, ac.code_value, ac.status as code_status
     FROM orders o
     LEFT JOIN products p ON o.product_id = p.id
     LEFT JOIN activation_codes ac ON o.activation_code_id = ac.id
     WHERE o.order_number = ? AND (o.buyer_email = ? OR o.buyer_email = '')`
  ).bind(orderNumber, buyerEmail).first<any>();

  if (!order) return { success: false, error: '订单不存在' };
  return { success: true, order };
}
