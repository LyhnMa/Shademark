/**
 * DirectMail 签名 & 发信自检
 *
 * 用法（在项目根目录）：
 *   # 1) 只校验签名（离线，不需要任何密钥）
 *   node tools/dm-selftest.mjs
 *
 *   # 2) 校验签名 + 真发一封测试邮件（需要阿里云 AccessKey）
 *   DM_ACCESS_KEY_ID=xxx DM_ACCESS_KEY_SECRET=yyy \
 *   DM_ACCOUNT_NAME=no-reply@shademark.cn DM_FROM_ALIAS=ShadeMark \
 *   DM_TEST_TO=你的邮箱@example.com node tools/dm-selftest.mjs
 *
 * 依赖：先把 functions/lib/mail.ts 打成 tools/.build-mail.mjs
 *   esbuild functions/lib/mail.ts --bundle --format=esm --platform=node --outfile=tools/.build-mail.mjs
 */
import { signV2, sendMail } from './.build-mail.mjs';

// ---- 1) 官方测试向量校验（来源：阿里云 Direct Mail API Reference）----
const vectorParams = {
  AccessKeyId: 'testid',
  // 官方向量里的原始值（含 % 与 ' 两个特殊字符）：
  // "<a%b'>" → 一次编码 %3Ca%25b%27%3E → 二次编码 %253Ca%2525b%2527%253E
  AccountName: "<a%b'>",
  Action: 'SingleSendMail',
  AddressType: '1',
  Format: 'XML',
  HtmlBody: '4',
  RegionId: 'cn-hangzhou',
  ReplyToAddress: 'true',
  SignatureMethod: 'HMAC-SHA1',
  SignatureNonce: 'c1b2c332-4cfb-4a0f-b8cc-ebe622aa0a5c',
  SignatureVersion: '1.0',
  Subject: '3',
  TagName: '2',
  Timestamp: '2016-10-20T06:27:56Z',
  ToAddress: '1@test.com',
  Version: '2015-11-23',
};
const EXPECTED_SIG = 'llJfXJjBW3OacrVgxxsITgYaYm0=';
const expectedStringToSign =
  'POST&%2F&AccessKeyId%3Dtestid%26AccountName%3D%253Ca%2525b%2527%253E%26Action%3DSingleSendMail%26AddressType%3D1%26Format%3DXML%26HtmlBody%3D4%26RegionId%3Dcn-hangzhou%26ReplyToAddress%3Dtrue%26SignatureMethod%3DHMAC-SHA1%26SignatureNonce%3Dc1b2c332-4cfb-4a0f-b8cc-ebe622aa0a5c%26SignatureVersion%3D1.0%26Subject%3D3%26TagName%3D2%26Timestamp%3D2016-10-20T06%253A27%253A56Z%26ToAddress%3D1%2540test.com%26Version%3D2015-11-23';

const r = signV2(vectorParams, 'testsecret');
const passSts = r.stringToSign === expectedStringToSign;
const passSig = r.signature === EXPECTED_SIG;

console.log('--- 1) 签名 V2 官方向量校验 ---');
console.log('StringToSign 一致 :', passSts ? 'PASS' : 'FAIL');
if (!passSts) {
  console.log('  期望:', expectedStringToSign);
  console.log('  实际:', r.stringToSign);
}
console.log('Signature 一致    :', passSig ? 'PASS' : 'FAIL', `(期望 ${EXPECTED_SIG} / 实际 ${r.signature})`);

// ---- 2) 可选：真实发信 ----
const { DM_ACCESS_KEY_ID, DM_ACCESS_KEY_SECRET, DM_ACCOUNT_NAME, DM_FROM_ALIAS, DM_TEST_TO, DM_REGION } = process.env;
if (!DM_ACCESS_KEY_ID || !DM_TEST_TO) {
  console.log('\n--- 2) 真实发信 ---\n跳过（未提供 DM_ACCESS_KEY_ID / DM_TEST_TO）');
} else {
  console.log('\n--- 2) 真实发信 ---');
  const res = await sendMail(
    {
      DM_ACCESS_KEY_ID,
      DM_ACCESS_KEY_SECRET,
      DM_ACCOUNT_NAME,
      DM_FROM_ALIAS,
      DM_REGION,
    },
    {
      to: DM_TEST_TO,
      subject: 'ShadeMark 发信自检',
      html: '<p>这是一封发信自检邮件。收到即表示 AccessKey / 发信地址 / SPF·DKIM 全部就绪。</p>',
      text: '这是一封发信自检邮件。收到即表示 AccessKey / 发信地址 / SPF·DKIM 全部就绪。',
    }
  );
  console.log(JSON.stringify(res));
}

process.exit(passSts && passSig ? 0 : 1);
