import { newId, now, jsonResponse, errorResponse } from './db';
import { claimCode, revokeCode, getAllCodes } from './codes';

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
  orderId: string
): Promise<{ success: boolean; code?: string; error?: string }> {
  const order = await db.prepare(`SELECT * FROM orders WHERE id = ?`).bind(orderId).first<any>();
  if (!order) return { success: false, error: '订单不存在' };
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

  // 获取商品信息
  const product = await db.prepare(
    `SELECT id, code_prefix, code_length, code_charset FROM products WHERE id = ?`
  ).bind(order.product_id).first<any>();
  if (!product) return { success: false, error: '商品不存在' };

  // 原子领取激活码
  const codeRow = await claimCode(db, product.id);
  if (!codeRow) return { success: false, error: '激活码库存不足' };

  await db.prepare(
    `UPDATE orders SET status = 'delivered', activation_code_id = ?, delivered_at = ? WHERE id = ?`
  ).bind(codeRow.id, now(), orderId).run();

  await db.prepare(
    `UPDATE activation_codes SET order_id = ? WHERE id = ?`
  ).bind(orderId, codeRow.id).run();

  return { success: true, code: codeRow.code_value };
}

export async function cancelOrder(db: D1Database, orderId: string): Promise<{ success: boolean; error?: string }> {
  const order = await db.prepare(`SELECT * FROM orders WHERE id = ?`).bind(orderId).first<any>();
  if (!order) return { success: false, error: '订单不存在' };
  if (order.status === 'delivered') return { success: false, error: '已发码订单不可取消' };

  await db.prepare(
    `UPDATE orders SET status = 'cancelled' WHERE id = ?`
  ).bind(orderId).run();

  return { success: true };
}

export async function getOrders(
  db: D1Database,
  status?: string
): Promise<any[]> {
  let sql = `
    SELECT o.*, p.name as product_name
    FROM orders o
    LEFT JOIN products p ON o.product_id = p.id
    ORDER BY o.created_at DESC
    LIMIT 100
  `;
  const params: any[] = [];
  if (status) {
    sql = `
      SELECT o.*, p.name as product_name
      FROM orders o
      LEFT JOIN products p ON o.product_id = p.id
      WHERE o.status = ?
      ORDER BY o.created_at DESC
      LIMIT 100
    `;
    params.push(status);
  }
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
