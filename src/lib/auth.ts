import { newId, now, jsonResponse, errorResponse } from './db';
import crypto from 'node:crypto';

// 简单 bcrypt-like 哈希（实际生产建议用bcrypt）
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
  return `${salt}$${hash}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [salt, hash] = stored.split('$');
  const computed = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
  return computed === hash;
}

export async function createSession(
  db: D1Database,
  userId: string
): Promise<string> {
  const token = crypto.randomBytes(32).toString('hex');
  await db.prepare(
    `INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)`
  ).bind(token, userId, now()).run();
  return token;
}

export async function getSession(
  db: D1Database,
  token: string
): Promise<any> {
  return db.prepare(
    `SELECT s.user_id, u.email, u.subscription_tier, u.subscription_expires_at, u.role
     FROM sessions s
     JOIN users u ON s.user_id = u.id
     WHERE s.token = ?`
  ).bind(token).first<any>();
}

export async function deleteSession(db: D1Database, token: string): Promise<void> {
  await db.prepare(`DELETE FROM sessions WHERE token = ?`).bind(token).run();
}

export function generateAPIKey(): string {
  return 'sm_' + crypto.randomBytes(24).toString('base64url');
}

export function generateSecret(): string {
  return crypto.randomBytes(32).toString('hex');
}

export async function createAPIKey(
  db: D1Database,
  developerId: string,
  scope: string
): Promise<{ key_value: string; secret: string }> {
  const key_value = generateAPIKey();
  const secret = generateSecret();
  await db.prepare(
    `INSERT INTO api_keys (id, developer_id, key_value, secret, scope, is_active, created_at)
     VALUES (?, ?, ?, ?, ?, 1, ?)`
  ).bind(newId(), developerId, key_value, secret, scope, now()).run();
  return { key_value, secret };
}

export async function verifyAPIKey(
  db: D1Database,
  apiKey: string
): Promise<any> {
  return db.prepare(
    `SELECT * FROM api_keys WHERE key_value = ? AND is_active = 1`
  ).bind(apiKey).first<any>();
}

export function createSignature(secret: string, timestamp: number, body: string): string {
  const message = `${timestamp}${body}`;
  return crypto.createHmac('sha256', secret).update(message).digest('hex');
}

export function verifySignature(
  secret: string,
  signature: string,
  timestamp: number,
  body: string
): boolean {
  const expected = createSignature(secret, timestamp, body);
  return expected === signature && Math.abs(Date.now() / 1000 - timestamp) <= 300;
}

export function parseAuthorization(request: Request): { apiKey?: string; bearer?: string } {
  const authHeader = request.headers.get('authorization') || '';
  const parts = authHeader.split(' ');
  if (parts[0] === 'Bearer' && parts[1]) {
    return { bearer: parts[1] };
  }
  if (authHeader.startsWith('sm_')) {
    return { apiKey: authHeader };
  }
  return {};
}

export async function authenticate(request: Request, env: any): Promise<{
  authenticated: boolean;
  user?: any;
  apiKey?: any;
  error?: string;
}> {
  const sessionToken = request.headers.get('cookie')?.match(/session=([^;]+)/)?.[1];

  if (sessionToken) {
    const session = await getSession(env.DB, sessionToken);
    if (session) {
      return { authenticated: true, user: session };
    }
  }

  const authHeader = request.headers.get('authorization') || '';
  if (authHeader) {
    const apiKeyValue = authHeader.replace('Bearer ', '').replace('sm_', '');
    const key = await verifyAPIKey(env.DB, authHeader.startsWith('Bearer ') ? `sm_${apiKeyValue}` : authHeader);
    if (key) {
      return { authenticated: true, apiKey: key };
    }
  }

  return { authenticated: false };
}

export async function requireAuth(request: Request, env: any): Promise<Response> {
  const result = await authenticate(request, env);
  if (!result.authenticated) {
    return errorResponse('未登录', 401);
  }
  return null;
}

export async function requireAPIKey(request: Request, env: any): Promise<{
  key: any;
  response?: Response;
}> {
  const authHeader = request.headers.get('authorization') || '';
  const keyName = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;
  const key = await verifyAPIKey(env.DB, keyName);
  if (!key) {
    return { key: null, response: errorResponse('无效的 API Key', 401) };
  }
  return { key };
}

export async function requireAdmin(request: Request, env: any): Promise<any> {
  const result = await authenticate(request, env);
  if (!result.authenticated) {
    return errorResponse('未登录', 401);
  }
  return result.user;
}

// 平台管理员：users.role = 'platform'
export async function requirePlatform(request: Request, env: any): Promise<any> {
  const user = await requireAdmin(request, env);
  if (user instanceof Response) return user;
  if (user.role !== 'platform') return errorResponse('没有平台管理权限', 403);
  return user;
}
