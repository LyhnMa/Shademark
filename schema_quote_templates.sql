-- 报价单模板（quote_templates）
-- 登录用户专属，与账号绑定。用于「保存模板 / 载入模板 / 打开页自动载入上次模板」。
-- 在已有库上执行：npx wrangler d1 execute shademark --remote --file=schema_quote_templates.sql

CREATE TABLE IF NOT EXISTS quote_templates (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  -- 卖家信息 + 税率 + 常用条目 + 报价说明（JSON 快照，前端直接回填）
  data TEXT NOT NULL,
  is_last INTEGER DEFAULT 0,      -- 1 = 该账号最近一次使用的模板
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_quote_tpl_user ON quote_templates(user_id, updated_at);
