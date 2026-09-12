import { newId, now, jsonResponse, errorResponse } from './db';

const CHARSETS = {
  alphanumeric: 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789',
  numeric: '0123456789',
  letters: 'ABCDEFGHJKLMNPQRSTUVWXYZ',
};

// 有效期天数 → 过期时间戳。天数<=0 或为空 → 永久(NULL)
export function validityToExpiresAt(validityDays: number | null | undefined, createdAt: number): number | null {
  if (!validityDays || validityDays <= 0) return null;
  return createdAt + validityDays * 86400;
}

export function generateCode(
  prefix: string,
  length: number,
  charset: keyof typeof CHARSETS
): string {
  const chars = CHARSETS[charset];
  let code = '';
  for (let i = 0; i < length; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return prefix ? `${prefix}${code}` : code;
}

export function batchGenerate(
  count: number,
  prefix: string,
  length: number,
  charset: keyof typeof CHARSETS
): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    codes.push(generateCode(prefix, length, charset));
  }
  return codes;
}

export async function createCodes(
  db: D1Database,
  productId: string,
  product: { code_prefix: string; code_length: number; code_charset: string; code_validity_days?: number | null }
): Promise<void> {
  const codes = batchGenerate(
    parseInt(productId.split('-').pop() || '10'),
    product.code_prefix,
    product.code_length,
    product.code_charset as keyof typeof CHARSETS
  );

  // 有效期：生成时即按商品天数计算（无值/0 → NULL 永久）
  const createdAt = now();
  const expiresAt = product.code_validity_days && product.code_validity_days > 0
    ? createdAt + product.code_validity_days * 86400
    : null;

  const values = codes.map((code_value) => ({
    id: newId(),
    product_id: productId,
    code_value,
    status: 'unused',
    created_at: createdAt,
    expires_at: expiresAt,
  }));

  // 批量插入，分片处理
  const batchSize = 500;
  for (let i = 0; i < values.length; i += batchSize) {
    const chunk = values.slice(i, i + batchSize);
    const placeholders = chunk.map(() => '(?, ?, ?, ?, ?, ?)').join(', ');
    const params = chunk.flatMap((c) => [c.id, c.product_id, c.code_value, c.status, c.created_at, c.expires_at]);
    await db.prepare(
      `INSERT INTO activation_codes (id, product_id, code_value, status, created_at, expires_at) VALUES ${placeholders}`
    ).bind(...params).run();
  }
}

export async function claimCode(
  db: D1Database,
  productId: string
): Promise<{ id: string; code_value: string } | null> {
  const nowTs = now();
  // 优先领取：未售 且 未过期（expires_at 为空或未到期的）的码
  const row = await db.prepare(
    `SELECT id, code_value FROM activation_codes
     WHERE product_id = ? AND status = 'unused'
       AND (expires_at IS NULL OR expires_at > ?)
     LIMIT 1`
  ).bind(productId, nowTs).first<{ id: string; code_value: string }>();

  if (!row) return null;

  await db.prepare(
    `UPDATE activation_codes SET status = 'sold', order_id = ? WHERE id = ?`
  ).bind('pending', row.id).run();

  return row;
}

export async function revokeCode(db: D1Database, codeId: string, developerId?: string): Promise<boolean> {
  // 传入 developerId 时做归属校验，防止作废他人激活码
  if (developerId) {
    const owned = await db.prepare(
      `SELECT c.id FROM activation_codes c
       JOIN products p ON c.product_id = p.id
       WHERE c.id = ? AND p.developer_id = ?`
    ).bind(codeId, developerId).first();
    if (!owned) return false;
  }
  await db.prepare(
    `UPDATE activation_codes SET status = 'revoked' WHERE id = ?`
  ).bind(codeId).run();
  return true;
}

export async function getCodesByProduct(db: D1Database, productId: string): Promise<Array<{
  id: string;
  code_value: string;
  status: string;
  created_at: number;
  product_name?: string;
}>> {
  return db.prepare(
    `SELECT c.id, c.code_value, c.status, c.created_at, p.name as product_name
     FROM activation_codes c
     LEFT JOIN products p ON c.product_id = p.id
     WHERE c.product_id = ?
     ORDER BY c.created_at DESC`
  ).bind(productId).all<{ id: string; code_value: string; status: string; created_at: number; product_name?: string }>();
}

export async function getAllCodes(
  db: D1Database,
  developerId?: string,
  filters?: { product_id?: string; status?: string }
): Promise<{ results: any[] }> {
  let sql = `
    SELECT c.id, c.code_value, c.status, c.created_at, c.expires_at, c.issued_at, c.product_id, c.order_id,
           p.name as product_name, o.order_number as order_number
    FROM activation_codes c
    LEFT JOIN products p ON c.product_id = p.id
    LEFT JOIN orders o ON c.order_id = o.id
    WHERE 1=1
  `;
  const params: any[] = [];
  if (developerId) {
    sql += ` AND p.developer_id = ?`;
    params.push(developerId);
  }
  if (filters?.product_id) {
    sql += ` AND c.product_id = ?`;
    params.push(filters.product_id);
  }
  if (filters?.status) {
    sql += ` AND c.status = ?`;
    params.push(filters.status);
  }
  sql += ` ORDER BY c.created_at DESC LIMIT 500`;
  return db.prepare(sql).bind(...params).all<any>();
}
