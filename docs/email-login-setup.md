# 邮箱登录 + 密码找回：上线说明与人工待办

本次交付已部署（Pages 部署号 `a1801fee`，域名 shademark.cn / shademark.pages.dev）。
代码、数据库迁移、端到端冒烟测试都已完成；**唯一需要你手动做的是阿里云邮件推送的开通与密钥注入**。

---

## 一、代码层做了什么

### 数据库（只加字段、只加表，未改动任何已有字段）
`schema_user_email.sql`，已在远端 D1 执行完毕：

| 变更 | 说明 |
|---|---|
| `users.recovery_email` | 找回邮箱。新注册用户留空（email 本身就是邮箱）；存量账号补录用 |
| `users.display_name` | 显示名。**只作界面展示，不作登录凭据** |
| `users.email_prompt_dismissed` | 是否已忽略「补一个邮箱」提示，1=不再提 |
| `password_reset_tokens`（新表） | 只存 `sha256(令牌)`，明文只出现在邮件链接里 |

### 端点
| 端点 | 作用 |
|---|---|
| `POST /api/auth/forgot-password` | 发重置链接。无论邮箱是否注册，**返回完全一致**的那句话 |
| `POST /api/auth/reset-verify` | 打开重置页时校验链接是否还能用 |
| `POST /api/auth/reset-password` | 换新密码；令牌一次性作废；**清空该账号全部会话** |
| `POST /api/auth/bind-email` | 存量账号补邮箱（需登录），写入 `recovery_email` |
| `POST /api/auth/dismiss-email-prompt` | 关掉补录提示，之后不再提 |
| `POST /api/auth/login`（改） | 登录名按 `email` 或 `recovery_email` 匹配；返回 `needs_email` |
| `POST /api/auth/register`（改） | 强制邮箱格式校验；新增可选显示名 |
| `GET /api/auth/session`（改） | 返回 `display_name` / `needs_email` |

### 页面
- `/forgot` 忘记密码（输入邮箱 → 已发送；同文案不泄露是否注册）
- `/reset?token=…` 重置密码（失效时显示：**这个链接失效了，重新发一个。** + 重新获取按钮）
- `/login`（改）密码行下加了一个很轻的「忘记密码？」；注册页邮箱下加小字「用于登录和找回密码」，登录框改为可容纳存量非邮箱登录名
- `/admin`（改）侧栏底部显示当前账号；存量账号登录后顶部出现**一行**可关掉的补录提示

---

## 二、撞墙点（如实说明）

1. **Cloudflare Workers / Pages 没有 TCP，发不了 SMTP。**
   25 / 80 / 465 端口一律不通，`nodemailer` 这类库在 Workers 里根本跑不起来。
   → 因此**没有采用 SMTP 方案**，改成阿里云邮件推送的 HTTP OpenAPI `SingleSendMail`。
   → 副作用：**不需要设置 SMTP 密码**，需要的是 RAM 子账号的 AccessKey（ID + Secret）。

2. **Pages 不会自动执行数据库迁移。** 本次 3 个字段 + 1 张表已由我手动在远端 D1 执行，文件留在 `schema_user_email.sql` 备查。

3. **我这边的沙箱到不了阿里云，无法真实发一封邮件验证。**
   我做到的是：用阿里云官方 API Reference 里的**签名测试向量**离线校验了签名算法（`tools/dm-selftest.mjs` 通过，签名与官方样例逐字节一致），并在生产环境跑通了除「真实发信」以外的整条链路（见第四节）。
   → 最后「信能不能发出去」必须由你在配好 AccessKey 后实测一次。

4. **邮件送达是 DNS 的事，不是代码的事。** 发信域名必须把控制台给出的 4 条解析（TXT 验证 / SPF / MX / DKIM-CNAME）配好并点「验证」通过；未验证时 API 会直接返回发信失败（邮件发不出去，但用户看到的仍是统一文案）。

5. **阿里云的限制**：一个主域名及其所有子域名，只能被一个阿里云账号用作发信域名；且**官方明确建议用二级域名发信**，避免影响主域名的邮件信誉。你指定的发信地址是 `no-reply@shademark.cn`（主域名）——能用，但如果 shademark.cn 以后还要接企业邮箱之类，建议改成 `no-reply@mail.shademark.cn`。改的时候只要动 `wrangler.toml` 里的 `DM_ACCOUNT_NAME`。

6. **免费额度**：新开通 2000 封，每天最多免费 200 封。密码找回是低频事件，够用很久。

7. **存量用户适配**：目前库里有 3 个账号，登录名全部是正常邮箱，**没有一个是当年用非邮箱字符串注册的**，所以补录机制当前没有触发对象。机制已就位，将来出现这类账号会自动提示。

8. **「用户名降为显示名」**：这个项目原本就没有用户名字段（注册只要邮箱）+ 密码 + 联系方式，登录本来就只有邮箱一条路。所以新增了 `display_name` 作为纯展示字段，管理后台侧栏会显示它，**它不参与任何登录或找回逻辑**。

---

## 三、你需要做的 6 步

### 1. 开通邮件推送
阿里云控制台 → 搜索「邮件推送 DirectMail」→ 开通（免费）。

### 2. 建发信域名 + 配 DNS
发信域名 → 新建域名。**建议填二级域名**（如 `mail.shademark.cn`，不要填 `shademark.cn`）。
拿到 4 条记录后在域名 DNS 处添加：TXT（域名所有权验证）、SPF、MX、CNAME（DKIM）。
等约 20 分钟，回到控制台点「验证」，状态变绿为止。

### 3. 建发信地址
发信地址 → 新建：账号填 `no-reply`，域名选上一步的域名（自动拼成 `no-reply@mail.shademark.cn`）。
**类型必须选「触发邮件」**（注册通知/密码找回属于触发类；选批量通道会被风控）。
回信地址可留空（我们设了 `ReplyToAddress=false`，不需要它）。

### 4. 建 RAM 子账号 AccessKey
RAM 访问控制 → 用户 → 新建用户（勾选「OpenAPI 调用访问」）→ 授权 `AliyunDirectMailFullAccess`
（更严格的做法是自定义策略只给 `dm:SingleSendMail`）。
拿到 **AccessKey ID** 和 **AccessKey Secret**。

### 5. 注入密钥（不进代码、不进配置文件）
```bash
cd E:/Workbuddy/Shademark
npx wrangler pages secret put DM_ACCESS_KEY_ID --project-name shademark
npx wrangler pages secret put DM_ACCESS_KEY_SECRET --project-name shademark
```

### 6. 实测一封
```bash
# 先把 mail.ts 打包成自检脚本能用的 esm（一次即可）
npx esbuild functions/lib/mail.ts --bundle --format=esm --platform=node --outfile=tools/.build-mail.mjs

# 只验签名（不需要密钥，应为全 PASS）
node tools/dm-selftest.mjs

# 真发一封
DM_ACCESS_KEY_ID=你的ID DM_ACCESS_KEY_SECRET=你的SECRET \
DM_ACCOUNT_NAME=no-reply@mail.shademark.cn DM_FROM_ALIAS=ShadeMark \
DM_TEST_TO=你的邮箱@example.com node tools/dm-selftest.mjs
```
收到邮件即全部就绪，随后在线上走一遍「忘记密码」即可。

---

## 四、已经跑过的验证（生产环境实测）

| 用例 | 结果 |
|---|---|
| 注册 + 邮箱格式校验（`not-an-email` 被拒） | 通过 |
| 手动写入令牌 → `/reset-verify` | `{"valid":true,"account":"e2***@…"}` |
| 弱密码被拒（`123`） | `密码至少6位` |
| 带令牌重置密码 | 成功 |
| 同一令牌二次使用 | `这个链接失效了，请重新获取` |
| 旧密码登录 | 401 |
| 新密码登录 + 会话返回 `display_name` | 通过 |
| 伪造令牌 / 未登录调 bind-email | 分别 400、401 |
| 未配 AccessKey 时点「忘记密码」 | 503 + 明确提示（不会静默失败） |

测试账号与令牌已全部清理，库里仍有 3 个真实账号（`mowl0311` / `sleven2026` / `206290978` 的邮箱），未受影响。

---

## 五、安全设计要点

- 令牌：32 字节随机（base64url），**只存 sha256**；30 分钟过期；用完即废；同一账号其余未用令牌一并作废。
- 改密后**清空该账号所有会话**，其他设备必须重新登录。
- 防枚举：邮箱未注册 / 已注册 / 被限频，返回**同一句话**，并用固定最小响应耗时抹平时间差。
- 限频：同一账号 15 分钟 3 次，同一 IP 15 分钟 10 次。
- IP 不落明文，只存加盐 sha256 前 32 位。
- 登录/注册 Cookie 在 HTTPS 下追加 `Secure`。
- `/forgot` `/reset` 带 `noindex` 并已加入 `robots.txt` Disallow。

---

## 六、配置速查 / 回滚

| 想改什么 | 改哪里 |
|---|---|
| 发信地址、发信人昵称 | `wrangler.toml` → `DM_ACCOUNT_NAME` / `DM_FROM_ALIAS` |
| 邮件里链接的域名 | `wrangler.toml` → `APP_ORIGIN`（默认 `https://shademark.cn`） |
| 链接有效期 | `wrangler.toml` → `RESET_TTL_MINUTES`（默认 30 分钟） |
| 换签名版本 | `DM_SIGN_VERSION`：`v2`（默认，已校验）/ `v3`（备用，未实测） |

**临时不想发信**：把两个 secret 删掉即可 —— 「忘记密码」会明确回 503，登录、注册、其他功能完全不受影响。
**完全回滚**：从构建命令里去掉 `forgot.html` / `reset.html`，并移除 `/login` 上那个「忘记密码？」入口即可；数据库新增字段全是可选字段，不影响旧代码。
