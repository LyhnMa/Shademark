import type { Env } from '../../lib/db';
import { jsonResponse, errorResponse } from '../../lib/db';

export async function onRequestGet(context: any): Promise<Response> {
  const { request, env } = context;
  const products = await env.DB.prepare(
    `SELECT * FROM products WHERE is_active = 1 ORDER BY created_at DESC`
  ).all<any>();

  const result = (products.results || []).map((p: any) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    price: p.price,
    stock: p.stock,
  }));

  return jsonResponse({ products: result });
}
