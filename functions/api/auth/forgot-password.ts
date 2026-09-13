import { jsonResponse, errorResponse, now } from '../../lib/db';
import { isEmail, maskEmail } from '../../lib/validate';
import {
  findUserByEmail,
  newResetToken,
  hashIp,
  resetTtlMinutes,
  appOrigin,
  resetRateLimited,
  padResponse,
} from '../../lib/reset';
import { sendMail, renderResetEmail, renderResetText, isMailConfigured } from '../../lib/mail';

// 统一文案：无论邮箱是否注册，返回完全一致，避免被用来枚举账号
const SAME_ANSWER = '如果这个邮箱已注册，重置链接已经发过去了。请查收（也看一眼垃圾邮件箱）。';

// POST /api/auth/forgot-password
export async function onRequestPost(context: any): Promise<Response> {
  const { request, env } = context;
  const startedAt = Date.now();

  const body = await request.json<any>().catch(() => ({}));
  const email = String(body.email || '').trim();

  // 邮件通道没配好时，直接如实告知（这是全局状态，不泄露任何账号信息）
  if (!isMailConfigured(env)) {
    return errorResponse('邮件服务尚未配置，暂时无法发送重置链接，请联系平台处理。', 503);
  }

  if (!email || !isEmail(email)) {
    await padResponse(startedAt);
    return jsonResponse({ success: true, message: SAME_ANSWER });
  }

  const nowSec = now();
  const user = await findUserByEmail(env.DB, email);

  if (user) {
    const ip = hashIp(env, request);
    const limited = await resetRateLimited(env.DB, user.id, ip, nowSec);

    if (!limited) {
      const ttl = resetTtlMinutes(env);
      const { token, hash } = newResetToken();

      await env.DB.prepare(
        `INSERT INTO password_reset_tokens (token_hash, user_id, expires_at, used_at, created_at, request_ip)
         VALUES (?, ?, ?, NULL, ?, ?)`
      ).bind(hash, user.id, nowSec + ttl * 60, nowSec, ip).run();

      // 落库用主邮箱或找回邮箱中更「像邮箱」的那个来展示
      const shown = isEmail(user.email) ? user.email : user.recovery_email || user.email;
      const link = `${appOrigin(request, env)}/reset?token=${encodeURIComponent(token)}`;

      const result = await sendMail(env, {
        to: email,
        subject: '重置你的 ShadeMark 密码',
        html: renderResetEmail(link, ttl, maskEmail(shown)),
        text: renderResetText(link, ttl, maskEmail(shown)),
      });

      if (!result.ok) {
        // 发信失败不改变对外响应；但要让运维看得见
        console.error('[forgot-password] 发信失败', JSON.stringify(result));
        // 令牌已生成但没送达，直接标记作废，避免留下悬空令牌
        await env.DB.prepare(`UPDATE password_reset_tokens SET used_at = ? WHERE token_hash = ?`)
          .bind(nowSec, hash)
          .run();
      }
    } else {
      console.warn('[forgot-password] 触发限频', user.id);
    }
  }

  await padResponse(startedAt);
  return jsonResponse({ success: true, message: SAME_ANSWER });
}
