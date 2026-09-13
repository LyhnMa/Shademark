# ShadeMark

要用的工具，都在这里。

https://shademark.cn

## 是什么

一人公司用的工具集合。窄场景、高频重复、规则能框住。交付业务结果，不交付模型能力。

不追求更聪明，追求更少出错。

## 工具

| 工具 | 说明 |
|------|------|
| 水印 | 图片加文字 / 图片水印 |
| 压缩 | 图片压缩 |
| 发码 | 激活码生成 + 订单管理 |
| 短链 | 短链接 + 点击统计 |
| 报价单 | 报价单生成 |

## 技术栈

- **前端 + 后端**：Cloudflare Pages + Functions
- **数据库**：Cloudflare D1
- **定时任务**：独立 Worker + Cron Triggers（`cron-cleanup/`）
- **邮件**：阿里云邮件推送 DirectMail（HTTP OpenAPI）

## 本地开发

```bash
# 1) 安装依赖（本机用 npx 拉 wrangler，可跳过）
npm install

# 2) 构建静态产物到 dist/（pages dev 需要 dist 已存在）
rm -rf dist && mkdir dist && cp src/pages/*.html dist/ && \
  cp public/logo.png public/favicon.png public/favicon.ico public/robots.txt public/sitemap.xml public/404.html dist/ 2>/dev/null; \
  cp -r public/watermark dist/ && cp -r public/compress dist/

# 3) 本地起 Pages + Functions（--d1=DB 对应 wrangler.toml 里的 DB 绑定）
npx wrangler pages dev dist --d1=DB
```

本地密钥走 `.dev.vars`（已 gitignore，不进仓库）。

## 部署

**顺序不能反：先 push 再 deploy。**

```bash
git add .
git commit -m "<改了什么>"
git push
npx wrangler pages deploy --project-name shademark
```

先 push 保证 GitHub 和线上一致；再 deploy 让改动生效。

## 密钥管理

**所有密钥走 secret 注入，不写进任何 toml / 代码 / 仓库。**

| 密钥 | 注入命令 |
|------|---------|
| `CRON_SECRET` | `npx wrangler pages secret put CRON_SECRET --project-name shademark` |
| `DM_ACCESS_KEY_ID` | `npx wrangler pages secret put DM_ACCESS_KEY_ID --project-name shademark` |
| `DM_ACCESS_KEY_SECRET` | `npx wrangler pages secret put DM_ACCESS_KEY_SECRET --project-name shademark` |

cron worker 的 secret 单独注入：

```bash
npx wrangler secret put CRON_SECRET --name shademark-cleanup
```

**注意**：`CRON_SECRET` 两端（Pages 和 cron worker）必须是同一个值，否则 cron 调 Pages 端点会 403。

普通配置（非密钥）写在 `wrangler.toml` 的 `[vars]` 里，可以进仓库。

## 定时任务

独立 Worker `shademark-cleanup`，两个触发器：

| Cron | 频率 | 作用 |
|------|------|------|
| `0 * * * *` | 每小时 | 过期数据清理（Free 30 天 / Pro 90 天） |
| `0 3 * * *` | 每天 03:00 UTC | Pro 到期超 3 天宽限后自动降级 |

部署（在 `cron-cleanup/` 目录下）：

```bash
npx wrangler deploy -c wrangler.cron.toml
```

**重部署 cron worker 前**：确认 `CRON_SECRET` 已作为 secret 注入（`npx wrangler secret list --name shademark-cleanup` 能看到）。如果 toml 里去掉 var 后 secret 没注入，重部署会让它丢失 `CRON_SECRET`，两个触发器全部 403。

## Free / Pro 权益

| 权益 | Free | Pro |
|------|------|-----|
| 批量生成上限 | 100 | 10000 |
| 验证 API 速率 | 60 次/分 | 600 次/分 |
| 订单数据保留 | 30 天 | 90 天 |
| 自动回调发码 | — | ✓ |
| 订单 / 激活码 CSV 导出 | — | ✓ |
| 短链月点击 | 10,000 | 100,000 |
| 短链统计保留 | 30 天 | 90 天 |
| 短链点击 CSV 导出 | — | ✓ |
| 水印工具 | 全部功能 | 全部功能 |
| 压缩工具 | 全部功能 | 全部功能 |

水印、压缩不分档，Free 和 Pro 都是全部功能。

## Pro 开通与到期规则

- **开通方式**：手动。用户线下付款，平台方在管理页设为 Pro 并设到期时间。不是自动续费。
- **宽限 3 天**：到期后进入宽限，功能保留，页面提示续费。宽限算法 = `expires_at + 3*86400` 实时推导，不落库。
- **自动降级**：独立 Worker + Cron Triggers，每天 3 点跑一次，降超过「到期 + 3 天」的 Pro 用户为 Free。
- **数据保留**：开过 Pro 的账号，窗口永久 90 天（`users.ever_pro`，只增不减）。降级只改 `subscription_tier`，不回写 `ever_pro`。清理任务按清理那一刻的 `ever_pro` 实时分档，不按记录产生时的档位快照。界面（`retainedDays`）与清理（`proRetentionSql`）共用同一口径。

## 账号与密码

- **登录**：邮箱登录。登录名只认邮箱；`display_name` 纯展示，不参与登录。
- **忘记密码**：`/forgot` → 邮件链接 → `/reset`。令牌 sha256 存哈希，30 分钟，一次性，改密后清空全部会话。
- **邮件服务**：阿里云邮件推送 DirectMail。发信域名 `mail.shademark.cn`，发信地址 `no-reply@mail.shademark.cn`。走 HTTP OpenAPI（Cloudflare 无 TCP，SMTP 不通）。
- **安全**：统一文案 + 固定响应耗时防枚举；限频 3 次/15 分钟/账号、10 次/15 分钟/IP；IP 只存加盐哈希。

## 邮件自检

```bash
node tools/dm-selftest.mjs
```

离线签名校验 + 真实发信。忘记密码功能依赖邮件服务，出问题先跑这个。

## 目录结构

```
Shademark/
├── functions/                 # Pages Functions（后端 API）
│   ├── api/                   # 路由目录
│   │   ├── auth/              # 登录 / 注册 / 找回密码 / 绑定邮箱
│   │   ├── links.ts  quote.ts  contact.ts  verify.ts   # 短链 / 报价单 / 联系 / 验证
│   │   ├── links/stats.ts     # 短链点击统计
│   │   ├── orders/            # 订单：confirm（回调发码）、[number]（查询）
│   │   ├── admin/             # 发码后台：codes（激活码）/ orders（订单）/ products（商品）/ settings
│   │   ├── platform/          # 运营方后台：users / links / contacts
│   │   ├── internal/          # cleanup.ts / downgrade.ts（仅 cron 调用，需 X-Cron-Auth）
│   │   └── store/             # 商品购买页 / 订单
│   ├── lib/                   # 共享库
│   │   ├── db.ts  mail.ts  subscription.ts  cleanup.ts
│   │   ├── codes.ts  orders.ts  quote.ts  links.ts  auth.ts  reset.ts  validate.ts  verify.ts
│   │   └── mail.ts            # 邮件发送（阿里云 DirectMail HTTP OpenAPI）
│   ├── l/[slug].ts            # 短链跳转（302）
│   └── store/[product_id].ts  # 商品购买页 HTML
├── src/pages/                 # 页面源文件（构建时复制到 dist/）
│   ├── index.html   links.html   quote.html   admin.html   platform.html
│   ├── login.html   forgot.html   reset.html
│   ├── order-query.html   store.html   privacy.html
├── public/                    # 静态资源
│   ├── logo.png  favicon.png  favicon.ico  robots.txt  sitemap.xml  404.html
│   ├── watermark/   compress/  # 水印 / 压缩纯前端单页（index.html）
├── tools/                     # 自检 / 调试脚本
│   ├── dm-selftest.mjs        # 邮件自检（离线签名 + 真实发信）
│   ├── cdp-*.mjs  d1-query.mjs  cf-schedules.mjs  run-cron-test.mjs ...
├── cron-cleanup/              # 定时任务 Worker
│   ├── worker.ts
│   └── wrangler.cron.toml
├── wrangler.toml              # Pages 配置（无密钥，[vars] 只放非敏感项）
├── .dev.vars                  # 本地密钥（已 gitignore，不进仓库）
├── .gitignore
├── schema*.sql                # D1 迁移脚本
└── README.md
```

## 维护备忘

- **GitHub 和 Cloudflare 保持一致**：每次改完，先 push 再 deploy。
- **密钥不进仓库**：任何 `.toml` / 代码 / README 里都不应有密钥明文。提交前扫一眼。
- **cron worker 重部署有坑**：先确认 secret 已注入，再 deploy。
- **cron worker 的 secret 注入必须从项目树外跑**：`wrangler secret put` 会向上查找 `wrangler.toml`，命中根目录带 `pages_build_output_dir` 的 Pages 配置会误判成 Pages 项目而拒绝（报 "run in a Pages project"）。注入 cron worker 的 `CRON_SECRET` 时，把 `worker.ts` + `wrangler.cron.toml` 拷到项目树之外的临时目录再跑 `secret put`，再回 `cron-cleanup/` 重新 `deploy -c wrangler.cron.toml` 让绑定生效。
