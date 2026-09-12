-- 联系消息（站内联系表单）
CREATE TABLE IF NOT EXISTS contact_messages (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  email TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'other',
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'unread',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_contact_messages_created_at ON contact_messages (created_at);
