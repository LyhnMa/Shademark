// functions/lib/mail.ts
import crypto from "node:crypto";
function percentEncode(input) {
  return encodeURIComponent(input).replace(
    /[!'()*]/g,
    (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase()
  );
}
function signV2(params, accessKeySecret) {
  const canonicalQuery = Object.keys(params).sort().map((k) => `${percentEncode(k)}=${percentEncode(params[k])}`).join("&");
  const stringToSign = `POST&${percentEncode("/")}&${percentEncode(canonicalQuery)}`;
  const signature = crypto.createHmac("sha1", accessKeySecret + "&").update(stringToSign, "utf8").digest("base64");
  const body = `${canonicalQuery}&Signature=${percentEncode(signature)}`;
  return { canonicalQuery, stringToSign, signature, body };
}
function signV3(params, accessKeyId, accessKeySecret) {
  const host = params.__host__ || "dm.aliyuncs.com";
  delete params.__host__;
  const canonicalQuery = Object.keys(params).sort().map((k) => `${percentEncode(k)}=${percentEncode(params[k])}`).join("&");
  const sha256Hex = (s) => crypto.createHash("sha256").update(s, "utf8").digest("hex");
  const hashedPayload = sha256Hex("");
  const signedHeaderMap = {
    host,
    "x-acs-action": params.Action || "",
    "x-acs-content-sha256": hashedPayload,
    "x-acs-date": (/* @__PURE__ */ new Date()).toISOString().replace(/\.\d{3}Z$/, "Z"),
    "x-acs-signature-nonce": crypto.randomUUID(),
    "x-acs-version": params.Version || "2015-11-23"
  };
  const signedHeaderNames = Object.keys(signedHeaderMap).sort();
  const canonicalHeaders = signedHeaderNames.map((n) => `${n}:${String(signedHeaderMap[n]).trim()}
`).join("");
  const canonicalRequest = [
    "POST",
    "/",
    canonicalQuery,
    canonicalHeaders,
    signedHeaderNames.join(";"),
    hashedPayload
  ].join("\n");
  const stringToSign = `ACS3-HMAC-SHA256
${sha256Hex(canonicalRequest)}`;
  const signature = crypto.createHmac("sha256", accessKeySecret).update(stringToSign, "utf8").digest("hex");
  const headers = {};
  for (const n of signedHeaderNames) headers[n] = signedHeaderMap[n];
  headers["authorization"] = `ACS3-HMAC-SHA256 Credential=${accessKeyId},SignedHeaders=${signedHeaderNames.join(";")},Signature=${signature}`;
  return { url: `https://${host}/?${canonicalQuery}`, headers };
}
function isMailConfigured(env) {
  return !!(env.DM_ACCESS_KEY_ID && env.DM_ACCESS_KEY_SECRET && env.DM_ACCOUNT_NAME);
}
async function sendMail(env, input) {
  if (!isMailConfigured(env)) {
    return { ok: false, error: "mail_not_configured" };
  }
  const endpoint = env.DM_ENDPOINT || "dm.aliyuncs.com";
  const params = {
    Action: "SingleSendMail",
    Version: "2015-11-23",
    Format: "JSON",
    RegionId: env.DM_REGION || "cn-hangzhou",
    AccessKeyId: env.DM_ACCESS_KEY_ID,
    SignatureMethod: "HMAC-SHA1",
    SignatureVersion: "1.0",
    SignatureNonce: crypto.randomUUID(),
    Timestamp: (/* @__PURE__ */ new Date()).toISOString().replace(/\.\d{3}Z$/, "Z"),
    AccountName: env.DM_ACCOUNT_NAME,
    AddressType: "1",
    ReplyToAddress: "false",
    ToAddress: input.to,
    Subject: input.subject,
    HtmlBody: input.html
  };
  if (input.text) params.TextBody = input.text;
  if (env.DM_FROM_ALIAS) params.FromAlias = env.DM_FROM_ALIAS;
  let signal;
  try {
    signal = AbortSignal.timeout(1e4);
  } catch {
    signal = void 0;
  }
  try {
    let res;
    if ((env.DM_SIGN_VERSION || "v2").toLowerCase() === "v3") {
      const v3 = signV3({ ...params, __host__: endpoint }, params.AccessKeyId, env.DM_ACCESS_KEY_SECRET);
      res = await fetch(v3.url, { method: "POST", headers: v3.headers, signal });
    } else {
      const signed = signV2(params, env.DM_ACCESS_KEY_SECRET);
      res = await fetch(`https://${endpoint}/`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: signed.body,
        signal
      });
    }
    const raw = await res.text();
    let data = {};
    try {
      data = JSON.parse(raw);
    } catch {
      data = { Code: "NonJsonResponse", Message: raw.slice(0, 300) };
    }
    if (data.Code && data.Code !== "OK") {
      return { ok: false, code: data.Code, error: data.Message || data.Code, requestId: data.RequestId };
    }
    if (!res.ok) {
      return { ok: false, code: String(res.status), error: raw.slice(0, 300) };
    }
    return { ok: true, requestId: data.RequestId };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}
function renderResetEmail(link, ttlMinutes, account) {
  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>\u91CD\u7F6E Shademark \u5BC6\u7801</title></head>
<body style="margin:0;padding:0;background:#f4f4f7;">
  <div style="max-width:520px;margin:0 auto;padding:32px 20px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;color:#1c1c22;">
    <div style="font-size:17px;font-weight:700;letter-spacing:-0.01em;padding-bottom:20px;">Shademark</div>
    <div style="background:#ffffff;border:1px solid #e6e6ec;border-radius:12px;padding:28px 24px;">
      <div style="font-size:16px;font-weight:700;margin-bottom:14px;">\u91CD\u7F6E\u5BC6\u7801</div>
      <p style="font-size:14px;line-height:1.7;color:#4a4a55;margin:0 0 18px;">
        \u4F60\uFF08\u6216\u6709\u4EBA\uFF09\u4E3A\u8D26\u53F7 <span style="color:#1c1c22;">${account}</span> \u7533\u8BF7\u4E86\u91CD\u7F6E\u5BC6\u7801\u3002\u70B9\u51FB\u4E0B\u9762\u7684\u6309\u94AE\u8BBE\u7F6E\u65B0\u5BC6\u7801\uFF0C\u94FE\u63A5 ${ttlMinutes} \u5206\u949F\u5185\u6709\u6548\u3002
      </p>
      <div style="margin:24px 0;">
        <a href="${link}" style="display:inline-block;background:#7c6cf0;color:#ffffff;text-decoration:none;font-size:14px;font-weight:700;padding:12px 22px;border-radius:6px;">\u8BBE\u7F6E\u65B0\u5BC6\u7801</a>
      </div>
      <p style="font-size:13px;line-height:1.7;color:#8a8a94;margin:0 0 6px;">\u6309\u94AE\u70B9\u4E0D\u5F00\uFF1F\u628A\u4E0B\u9762\u8FD9\u884C\u5B8C\u6574\u590D\u5236\u5230\u6D4F\u89C8\u5668\u6253\u5F00\uFF1A</p>
      <p style="font-size:12px;line-height:1.6;color:#7c6cf0;word-break:break-all;margin:0;">${link}</p>
    </div>
    <p style="font-size:12px;line-height:1.7;color:#8a8a94;margin:18px 0 0;">
      \u5982\u679C\u8FD9\u4E0D\u662F\u4F60\u672C\u4EBA\u64CD\u4F5C\uFF0C\u5FFD\u7565\u8FD9\u5C01\u90AE\u4EF6\u5373\u53EF\uFF0C\u5BC6\u7801\u4E0D\u4F1A\u88AB\u4FEE\u6539\u3002<br>
      \u672C\u90AE\u4EF6\u7531\u7CFB\u7EDF\u81EA\u52A8\u53D1\u51FA\uFF0C\u8BF7\u52FF\u76F4\u63A5\u56DE\u590D\u3002
    </p>
  </div>
</body></html>`;
}
function renderResetText(link, ttlMinutes, account) {
  return `Shademark \u91CD\u7F6E\u5BC6\u7801

\u4F60\uFF08\u6216\u6709\u4EBA\uFF09\u4E3A\u8D26\u53F7 ${account} \u7533\u8BF7\u4E86\u91CD\u7F6E\u5BC6\u7801\u3002
\u94FE\u63A5 ${ttlMinutes} \u5206\u949F\u5185\u6709\u6548\uFF0C\u6253\u5F00\u540E\u8BBE\u7F6E\u65B0\u5BC6\u7801\uFF1A
${link}

\u5982\u679C\u8FD9\u4E0D\u662F\u4F60\u672C\u4EBA\u64CD\u4F5C\uFF0C\u5FFD\u7565\u8FD9\u5C01\u90AE\u4EF6\u5373\u53EF\uFF0C\u5BC6\u7801\u4E0D\u4F1A\u88AB\u4FEE\u6539\u3002
\u672C\u90AE\u4EF6\u7531\u7CFB\u7EDF\u81EA\u52A8\u53D1\u51FA\uFF0C\u8BF7\u52FF\u76F4\u63A5\u56DE\u590D\u3002`;
}
export {
  isMailConfigured,
  percentEncode,
  renderResetEmail,
  renderResetText,
  sendMail,
  signV2,
  signV3
};
