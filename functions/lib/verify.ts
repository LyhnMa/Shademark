import { newId, now, jsonResponse, errorResponse } from './db';

export async function verifyCode(
  db: D1Database,
  codeValue: string
): Promise<{ success: boolean; result: string; message?: string }> {
  const code = await db.prepare(
    `SELECT ac.*, p.id as product_id FROM activation_codes ac
     JOIN products p ON ac.product_id = p.id
     WHERE ac.code_value = ?`
  ).bind(codeValue).first<any>();

  if (!code) {
    await logVerification(db, codeValue, 'failed', '');
    return { success: false, result: 'failed', message: '激活码不存在' };
  }

  if (code.status === 'revoked') {
    await logVerification(db, codeValue, 'revoked', '');
    return { success: false, result: 'revoked', message: '激活码已作废' };
  }

  if (code.status === 'unused') {
    await logVerification(db, codeValue, 'failed', '');
    return { success: false, result: 'failed', message: '激活码未售出' };
  }

  // 过期检查对 sold / active 均生效；expires_at 为空(永久)则跳过
  if (code.expires_at && code.expires_at < now()) {
    await logVerification(db, codeValue, 'expired', '');
    return { success: false, result: 'expired', message: '激活码已过期' };
  }

  if (code.status === 'active') {
    await logVerification(db, codeValue, 'success', '');
    return { success: true, result: 'success', message: '有效' };
  }

  // 首次验证：sold → active
  await db.prepare(
    `UPDATE activation_codes SET status = 'active', used_at = ? WHERE id = ?`
  ).bind(now(), code.id).run();

  await logVerification(db, codeValue, 'success', '');
  return { success: true, result: 'success', message: '有效' };
}

async function logVerification(
  db: D1Database,
  codeValue: string,
  result: string,
  ipHash: string
): Promise<void> {
  await db.prepare(
    `INSERT INTO verification_logs (id, code_value, result, ip_hash, created_at)
     VALUES (?, ?, ?, ?, ?)`
  ).bind(newId(), codeValue, result, ipHash, now()).run();
}

export async function logVerificationById(
  db: D1Database,
  codeId: string,
  result: string,
  ipHash: string
): Promise<void> {
  await db.prepare(
    `INSERT INTO verification_logs (id, code_id, result, ip_hash, created_at)
     VALUES (?, ?, ?, ?, ?)`
  ).bind(newId(), codeId, result, ipHash, now()).run();
}
