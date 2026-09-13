import crypto from 'node:crypto';

/**
 * 邮件发送层 —— 阿里云邮件推送 DirectMail
 *
 * ⚠️ 撞墙点：Cloudflare Workers / Pages Functions 运行在 workerd 上，
 * 只有 fetch（HTTP/HTTPS），没有 TCP socket，因此**无法直连 SMTP**
 * （25/465/587 都不行）。所以这里不采用「SMTP 客户端」方案，
 * 而是调用 DirectMail 的 HTTP OpenAPI `SingleSendMail`。
 *
 * 副作用（需要人工配置的东西变了）：
 *   - 不需要「SMTP 密码」，需要阿里云 AccessKey（建议 RAM 子账号最小权限）
 *   - 发信地址（AccountName）、SPF/DKIM 域名验证 仍然照旧需要
 */

export interface MailEnv {
  DB?: D1Database;
  /** RAM 子账号 AccessKeyId（secret，用 wrangler pages secret put 注入） */
  DM_ACCESS_KEY_ID?: string;
  /** RAM 子账号 AccessKeySecret（secret） */
  DM_ACCESS_KEY_SECRET?: string;
  /** 控制台里已配置并通过验证的发信地址，如 no-reply@shademark.cn */
  DM_ACCOUNT_NAME?: string;
  /** 发信人昵称 */
  DM_FROM_ALIAS?: string;
  /** 华东1（杭州）：cn-hangzhou */
  DM_REGION?: string;
  /** 默认 dm.aliyuncs.com */
  DM_ENDPOINT?: string;
  /** 签名版本：v2（默认，HMAC-SHA1，已用官方测试向量离线校验）| v3（ACS3-HMAC-SHA256，备用） */
  DM_SIGN_VERSION?: string;
}

export interface SendMailInput {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export interface SendMailResult {
  ok: boolean;
  requestId?: string;
  code?: string;
  error?: string;
}

/** RFC3986 编码（阿里云要求额外转义 ! ' ( ) * ，空格 → %20，~ 不转义） */
export function percentEncode(input: string): string {
  return encodeURIComponent(input).replace(
    /[!'()*]/g,
    (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase()
  );
}

/**
 * 签名 V2（HMAC-SHA1）。已按阿里云官方 API Reference 中的测试向量离线校验：
 * 见 tools/dm-selftest.ts
 */
export function signV2(
  params: Record<string, string>,
  accessKeySecret: string
): { canonicalQuery: string; stringToSign: string; signature: string; body: string } {
  const canonicalQuery = Object.keys(params)
    .sort()
    .map((k) => `${percentEncode(k)}=${percentEncode(params[k])}`)
    .join('&');
  const stringToSign = `POST&${percentEncode('/')}&${percentEncode(canonicalQuery)}`;
  const signature = crypto
    .createHmac('sha1', accessKeySecret + '&')
    .update(stringToSign, 'utf8')
    .digest('base64');
  const body = `${canonicalQuery}&Signature=${percentEncode(signature)}`;
  return { canonicalQuery, stringToSign, signature, body };
}

/** 签名 V3（ACS3-HMAC-SHA256，参数走 query string，空 body）。备用方案，未实测。 */
export function signV3(
  params: Record<string, string>,
  accessKeyId: string,
  accessKeySecret: string
): { url: string; headers: Record<string, string> } {
  const host = params.__host__ || 'dm.aliyuncs.com';
  delete params.__host__;
  const canonicalQuery = Object.keys(params)
    .sort()
    .map((k) => `${percentEncode(k)}=${percentEncode(params[k])}`)
    .join('&');

  const sha256Hex = (s: string) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
  const hashedPayload = sha256Hex('');

  const signedHeaderMap: Record<string, string> = {
    host,
    'x-acs-action': params.Action || '',
    'x-acs-content-sha256': hashedPayload,
    'x-acs-date': new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    'x-acs-signature-nonce': crypto.randomUUID(),
    'x-acs-version': params.Version || '2015-11-23',
  };
  const signedHeaderNames = Object.keys(signedHeaderMap).sort();
  const canonicalHeaders = signedHeaderNames
    .map((n) => `${n}:${String(signedHeaderMap[n]).trim()}\n`)
    .join('');

  const canonicalRequest = [
    'POST',
    '/',
    canonicalQuery,
    canonicalHeaders,
    signedHeaderNames.join(';'),
    hashedPayload,
  ].join('\n');

  const stringToSign = `ACS3-HMAC-SHA256\n${sha256Hex(canonicalRequest)}`;
  const signature = crypto
    .createHmac('sha256', accessKeySecret)
    .update(stringToSign, 'utf8')
    .digest('hex');

  const headers: Record<string, string> = {};
  for (const n of signedHeaderNames) headers[n] = signedHeaderMap[n];
  headers['authorization'] =
    `ACS3-HMAC-SHA256 Credential=${accessKeyId},` +
    `SignedHeaders=${signedHeaderNames.join(';')},Signature=${signature}`;

  return { url: `https://${host}/?${canonicalQuery}`, headers };
}

export function isMailConfigured(env: MailEnv): boolean {
  return !!(env.DM_ACCESS_KEY_ID && env.DM_ACCESS_KEY_SECRET && env.DM_ACCOUNT_NAME);
}

/** 调用 DirectMail SingleSendMail 发送一封邮件 */
export async function sendMail(env: MailEnv, input: SendMailInput): Promise<SendMailResult> {
  if (!isMailConfigured(env)) {
    return { ok: false, error: 'mail_not_configured' };
  }

  const endpoint = env.DM_ENDPOINT || 'dm.aliyuncs.com';
  const params: Record<string, string> = {
    Action: 'SingleSendMail',
    Version: '2015-11-23',
    Format: 'JSON',
    RegionId: env.DM_REGION || 'cn-hangzhou',
    AccessKeyId: env.DM_ACCESS_KEY_ID as string,
    SignatureMethod: 'HMAC-SHA1',
    SignatureVersion: '1.0',
    SignatureNonce: crypto.randomUUID(),
    Timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    AccountName: env.DM_ACCOUNT_NAME as string,
    AddressType: '1',
    ReplyToAddress: 'false',
    ToAddress: input.to,
    Subject: input.subject,
    HtmlBody: input.html,
  };
  if (input.text) params.TextBody = input.text;
  if (env.DM_FROM_ALIAS) params.FromAlias = env.DM_FROM_ALIAS;

  let signal: AbortSignal | undefined;
  try {
    signal = AbortSignal.timeout(10000);
  } catch {
    signal = undefined;
  }

  try {
    let res: Response;
    if ((env.DM_SIGN_VERSION || 'v2').toLowerCase() === 'v3') {
      const v3 = signV3({ ...params, __host__: endpoint }, params.AccessKeyId, env.DM_ACCESS_KEY_SECRET as string);
      res = await fetch(v3.url, { method: 'POST', headers: v3.headers, signal });
    } else {
      const signed = signV2(params, env.DM_ACCESS_KEY_SECRET as string);
      res = await fetch(`https://${endpoint}/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: signed.body,
        signal,
      });
    }

    const raw = await res.text();
    let data: any = {};
    try {
      data = JSON.parse(raw);
    } catch {
      data = { Code: 'NonJsonResponse', Message: raw.slice(0, 300) };
    }

    // 成功响应形如 {"RequestId":"...","EnvId":"..."}；失败一定带 Code
    if (data.Code && data.Code !== 'OK') {
      return { ok: false, code: data.Code, error: data.Message || data.Code, requestId: data.RequestId };
    }
    if (!res.ok) {
      return { ok: false, code: String(res.status), error: raw.slice(0, 300) };
    }
    return { ok: true, requestId: data.RequestId };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
}

/** 密码重置邮件正文（浅色、纯内联样式，兼容主流邮箱） */
export function renderResetEmail(link: string, ttlMinutes: number, account: string): string {
  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>重置 ShadeMark 密码</title></head>
<body style="margin:0;padding:0;background:#f4f4f7;">
  <div style="max-width:520px;margin:0 auto;padding:32px 20px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;color:#1c1c22;">
    <div style="font-size:17px;font-weight:700;letter-spacing:-0.01em;padding-bottom:20px;">ShadeMark</div>
    <div style="background:#ffffff;border:1px solid #e6e6ec;border-radius:12px;padding:28px 24px;">
      <div style="font-size:16px;font-weight:700;margin-bottom:14px;">重置密码</div>
      <p style="font-size:14px;line-height:1.7;color:#4a4a55;margin:0 0 18px;">
        你（或有人）为账号 <span style="color:#1c1c22;">${account}</span> 申请了重置密码。点击下面的按钮设置新密码，链接 ${ttlMinutes} 分钟内有效。
      </p>
      <div style="margin:24px 0;">
        <a href="${link}" style="display:inline-block;background:#7c6cf0;color:#ffffff;text-decoration:none;font-size:14px;font-weight:700;padding:12px 22px;border-radius:6px;">设置新密码</a>
      </div>
      <p style="font-size:13px;line-height:1.7;color:#8a8a94;margin:0 0 6px;">按钮点不开？把下面这行完整复制到浏览器打开：</p>
      <p style="font-size:12px;line-height:1.6;color:#7c6cf0;word-break:break-all;margin:0;">${link}</p>
    </div>
    <p style="font-size:12px;line-height:1.7;color:#8a8a94;margin:18px 0 0;">
      如果这不是你本人操作，忽略这封邮件即可，密码不会被修改。<br>
      本邮件由系统自动发出，请勿直接回复。
    </p>
  </div>
</body></html>`;
}

export function renderResetText(link: string, ttlMinutes: number, account: string): string {
  return `ShadeMark 重置密码

你（或有人）为账号 ${account} 申请了重置密码。
链接 ${ttlMinutes} 分钟内有效，打开后设置新密码：
${link}

如果这不是你本人操作，忽略这封邮件即可，密码不会被修改。
本邮件由系统自动发出，请勿直接回复。`;
}
