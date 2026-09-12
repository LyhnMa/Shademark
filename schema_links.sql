-- 短链接追踪（links / link_clicks）
-- 在已有库上执行：npx wrangler d1 execute shademark --remote --file=schema_links.sql

CREATE TABLE IF NOT EXISTS links (
  id TEXT PRIMARY KEY,
  developer_id TEXT NOT NULL REFERENCES users(id),
  slug TEXT UNIQUE NOT NULL,
  target_url TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER,
  is_active INTEGER DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_links_dev ON links(developer_id, created_at);

CREATE TABLE IF NOT EXISTS link_clicks (
  id TEXT PRIMARY KEY,
  link_id TEXT NOT NULL REFERENCES links(id),
  clicked_at INTEGER NOT NULL,
  referer TEXT DEFAULT '',
  user_agent TEXT DEFAULT '',
  ip_hash TEXT DEFAULT '',
  country TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_clicks_link ON link_clicks(link_id, clicked_at);

-- users 扩展列（单独执行，重复执行会报 duplicate column，属正常）
-- role：user | platform，平台管理员可管理全站短链
-- ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'user';
-- 月度点击计数（免费额度用），link_click_month 格式 YYYY-MM
-- ALTER TABLE users ADD COLUMN link_click_month TEXT DEFAULT '';
-- ALTER TABLE users ADD COLUMN link_click_count INTEGER DEFAULT 0;
