export interface Env {
  DB: D1Database;
}

export function newId(): string {
  return crypto.randomUUID();
}

export function now(): number {
  return Math.floor(Date.now() / 1000);
}

export async function getDB(env: Env): Promise<D1Database> {
  return env.DB;
}

export function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export function errorResponse(message: string, status = 400): Response {
  return jsonResponse({ error: message }, status);
}
