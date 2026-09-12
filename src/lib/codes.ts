import { newId, now, jsonResponse, errorResponse } from './db';

const CHARSETS = {
  alphanumeric: 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789',
  numeric: '0123456789',
  letters: 'ABCDEFGHJKLMNPQRSTUVWXYZ',
};

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
  product: { code_prefix: string; code_length: number; code_charset: string }
): Promise<void> {
  const codes = batchGenerate(
    parseInt(productId.split('-').pop() || '10'),
    product.code_prefix,
    product.code_length,
    product.code_charset as keyof typeof CHARSETS
  );

  const values = codes.map((code_value) => ({
    id: newId(),
    product_id: productId,
    code_value,
    status: 'unused',
    created_at: now(),
  }));

  // 批量插入，分片处理
  const batchSize = 500;
  for (let i = 0; i < values.length; i += batchSize) {
    const chunk = values.slice(i, i + batchSize);
    const placeholders = chunk.map(() => '(?, ?, ?, ?, ?)').join(', ');
    const params = chunk.flatMap((c) => [c.id, c.product_id, c.code_value, c.status, c.created_at]);
    await db.prepare(
      `INSERT INTO activation_codes (id, product_id, code_value, status, created_at) VALUES ${placeholders}`
    ).bind(...params).run();
  }
}

export async function claimCode(
  db: D1Database,
  productId: string
): Promise<{ id: string; code_value: string } | null> {
  const row = await db.prepare(
    `SELECT id, code_value FROM activation_codes WHERE product_id = ? AND status = 'unused' LIMIT 1`
  ).bind(productId).first<{ id: string; code_value: string }>();

  if (!row) return null;

  await db.prepare(
    `UPDATE activation_codes SET status = 'sold', order_id = 'pending' WHERE id = ?`
  ).bind(row.id).run();

  return row;
}

export async function revokeCode(db: D1Database, codeId: string): Promise<void> {
  await db.prepare(
    `UPDATE activation_codes SET status = 'revoked' WHERE id = ?`
  ).bind(codeId).run();
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

export async function getAllCodes(db: D1Database): Promise<Array<{
  id: string;
  code_value: string;
  status: string;
  created_at: number;
  product_id: string;
  product_name?: string;
}>> {
  return db.prepare(
    `SELECT c.id, c.code_value, c.status, c.created_at, c.product_id, p.name as product_name
     FROM activation_codes c
     LEFT JOIN products p ON c.product_id = p.id
     ORDER BY c.created_at DESC
     LIMIT 200`
  ).all<{ id: string; code_value: string; status: string; created_at: number; product_id: string; product_name?: string }>();
}
