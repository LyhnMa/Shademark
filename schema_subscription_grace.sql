-- Pro 到期 / 宽限 / 自动降级 增量迁移（2026-09-12）
--
-- 背景：users 里已有 subscription_tier / subscription_expires_at（到期时间在不在、
-- 有没有过期，全靠这两个字段 + 代码里 GRACE_DAYS=3 推导，**不新增宽限期字段**）。
--
-- 本文件只加一列：
--   ever_pro  是否开过 Pro（1 = 开过）。用途只有一个 —— 清理任务按保留期分档时
--             认「现在是 Pro 或曾经是 Pro」，避免自动降级落库后用户的 90 天数据
--             被当成 free 的 30 天档删掉（降级只限制新操作，不删已有结果）。
--
-- D1 一次只能跑一条语句，逐条执行：
--   npx wrangler d1 execute shademark --remote --command "ALTER TABLE users ADD COLUMN ever_pro INTEGER DEFAULT 0"
--   npx wrangler d1 execute shademark --remote --command "UPDATE users SET ever_pro = 1 WHERE subscription_tier = 'pro'"

ALTER TABLE users ADD COLUMN ever_pro INTEGER DEFAULT 0;

UPDATE users SET ever_pro = 1 WHERE subscription_tier = 'pro';

CREATE INDEX IF NOT EXISTS idx_users_expiry ON users(subscription_tier, subscription_expires_at);
