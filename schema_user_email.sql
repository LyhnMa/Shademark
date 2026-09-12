-- ============================================================
-- 增量迁移：邮箱登录 + 密码找回
-- 原则：只加字段、只加表，不改动任何已有字段与约束
-- D1 不支持多语句 execute，请逐条执行本文件中的每个语句
-- ============================================================

-- 1) users 新增：找回邮箱（存量用户补录用；新注册用户为空，因为 email 本身就是邮箱）
ALTER TABLE users ADD COLUMN recovery_email TEXT DEFAULT '';

-- 2) users 新增：显示名（用户名只作展示，不作登录凭据）
ALTER TABLE users ADD COLUMN display_name TEXT DEFAULT '';

-- 3) users 新增：是否已忽略「补一个邮箱」的提示（1 = 不要再提）
ALTER TABLE users ADD COLUMN email_prompt_dismissed INTEGER DEFAULT 0;

-- 4) 密码重置令牌表（只存哈希，不存明文令牌）
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  created_at INTEGER NOT NULL,
  request_ip TEXT DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_prt_user_time ON password_reset_tokens(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_prt_ip_time ON password_reset_tokens(request_ip, created_at);
CREATE INDEX IF NOT EXISTS idx_users_recovery_email ON users(recovery_email);
