# ShadeMark 平台统一订阅

> 原「发码平台付费功能」已废弃。订阅是**平台级状态**，不属于任何单个工具。

## 一、核心原则

**一个账号，一个等级，所有工具通用。**

`users.subscription_tier` 与 `users.subscription_expires_at` 是平台级字段：

| 字段 | 说明 |
| --- | --- |
| `subscription_tier` | `free`（默认） / `pro` |
| `subscription_expires_at` | Unix 秒。`NULL` = 不限期；小于当前时间 = 已到期，进入 3 天宽限期 |
| `ever_pro` | 1 = 开过 Pro。**只用于清理任务的保留期分档**：降级后仍按 Pro 档保留 90 天，数据不因降级被删 |

平台方在 `/platform` 把某个开发者改成 `pro` 之后，**发码平台、短链接、水印工具的付费功能同时生效**，不需要分别开通、不需要单独计价。

判定顺序（服务端唯一入口 `lib/subscription.ts`）：

```
tier = 'pro' 且 (expires_at 为空 或 expires_at + 3 天 > now)  →  pro
其他情况                                                      →  free
```

**到期 → 3 天宽限期 → 自动降级**（宽限算法不落库，一律由 `expires_at + 3 天` 推导）：

| 阶段 | 判定 | 权益 | 页面 |
| --- | --- | --- | --- |
| 有效期内 | `expires_at > now` | Pro | 剩余天数；≤7 天标「即将到期」 |
| 宽限期（3 天） | `expires_at ≤ now < expires_at + 3d` | **仍是 Pro**（功能保留） | 提示「已到期，续费保留」 |
| 超宽限 | `now ≥ expires_at + 3d` | 立即按 Free 运行 | 定时任务当天把 `tier` 落库为 `free` |

降级**只改 `subscription_tier` 一列**，不动 `expires_at`、不动任何业务数据；数据保留期认「现在是 Pro 或曾经是 Pro」，所以降级不会删数据，续费回来历史还在。受限的只是新操作（自动回调、批量、CSV 导出、API 额度、点击数额度）。

定时任务（Cloudflare Pages 无 cron，用独立 Worker + Cron Triggers 回调 Pages 内部端点）：

| 触发器 | 频率 | 端点 | 作用 |
| --- | --- | --- | --- |
| `0 * * * *` | 每小时 | `POST /api/internal/cleanup` | 过期数据清理（free 30 天 / pro 90 天） |
| `0 3 * * *` | 每天 03:00 UTC | `POST /api/internal/downgrade` | 超过宽限期的 Pro 自动降为 Free |

两者共用 `CRON_SECRET`（`X-Cron-Auth` 头）。Worker 在 `cron-cleanup/`，配置 `cron-cleanup/wrangler.cron.toml`，部署：`cd cron-cleanup && npx wrangler deploy -c wrangler.cron.toml`。

---

## 二、权益矩阵

### 免费用户（free）

| 工具 | 权益 |
| --- | --- |
| **发码平台** | 手动确认收款发码、基础验证 API（60 次/分钟）、订单数据保留 30 天 |
| **短链接** | 链接数量不限、10,000 次点击/月（可记录）、统计保留 30 天 |
| **水印工具** | 完全免费，不区分等级 |

### Pro 用户（pro）

| 工具 | 权益 |
| --- | --- |
| **发码平台** | 自动回调发码、更高 API 额度（600 次/分钟）、批量操作、订单数据保留 90 天 |
| **短链接** | 更高点击额度（500,000 次/月）、统计保留 90 天、CSV 导出 |
| **水印工具** | 高级功能同步解锁（当前工具本身免费，后续高级功能直接对 Pro 开放） |

### 一览表

| 能力 | free | pro |
| --- | --- | --- |
| 发码 · 手动确认发码 | ✅ | ✅ |
| 发码 · 自动回调发码 | — | ✅ |
| 发码 · 批量操作 | — | ✅ |
| 发码 · 验证 API | 60 次/分钟 | 600 次/分钟 |
| 发码 · 订单/日志保留 | 30 天 | 90 天 |
| 短链 · 链接数量 | 不限 | 不限 |
| 短链 · 可记录点击 | 10,000 / 月 | 500,000 / 月 |
| 短链 · 统计保留 | 30 天 | 90 天 |
| 短链 · CSV 导出 | — | ✅ |
| 水印 · 全部功能 | ✅ | ✅（含后续高级功能） |

---

## 三、短链接的免费 / 付费边界（按统一逻辑）

1. **链接数量永远不限** —— 免费用户也能无限创建短链，不拿这个当付费点。
2. **计费单位是「被记录的点击数」**，不是链接数：每月 1 号（UTC）重置 `link_click_month` / `link_click_count`。
3. **超额不清空、不打断业务**：额度用尽后，**短链照常 302 跳转，只是停止记录新的点击**。用户的线上链接永远不会因为没付费而失效。
4. **统计保留期随等级变化**：free 30 天、pro 90 天，由清理任务按等级分档删除。
5. **CSV 导出为 Pro 权益**：免费用户在面板看到导出入口但标记「Pro」，点击提示升级。

跳转实现要点（不变）：`/l/:slug` 一律 **302** + `Cache-Control: no-store` + `Referrer-Policy: no-referrer`，绝不能用 301（会被浏览器缓存导致统计丢失）。

---

## 四、平台方操作（不变）

- 入口：`/platform` → 订阅管理，接口 `GET/PUT /api/platform/users`
- 升级：`{ user_id, tier: 'pro', days: 30 }`，`days` 省略或为 0 表示不限期（同时置 `ever_pro=1`）
- 降级：`{ user_id, tier: 'free' }`，立即清空到期时间（自动降级**不清空**，只改 tier）
- 页面顶部「到期提醒」列出**即将到期（≤7 天）**与**宽限期中**的账号，表内「到期 / 状态」列显示：永久 Pro / 正常 / 即将到期 / 宽限期中 / 已过期（待降级）/ 已降级；可按状态筛选
- 返回的 `summary` 给出 total / pro / expiring / grace / expired / downgraded 计数，`attention` 是待处理清单
- 角色 `role='platform'` 与订阅等级相互独立：角色管"能管谁"，等级管"能用多少"

手动提权（应急）：

```bash
npx wrangler d1 execute shademark --remote \
  --command "UPDATE users SET subscription_tier='pro', subscription_expires_at=NULL WHERE email='dev@example.com'"
```

---

## 五、为什么这样设计

1. **对开发者简单** —— 买一次，全部解锁。不用为每个工具单独算账。
2. **对平台好管理** —— 只有 free / pro 两档，一个字段控制全部，没有交叉状态。
3. **矩阵成立** —— 用户会因为一个工具进来，因为整体价值留下。
