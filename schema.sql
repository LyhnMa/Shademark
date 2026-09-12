CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  contact TEXT DEFAULT '',
  password_hash TEXT NOT NULL,
  subscription_tier TEXT DEFAULT 'free',
  subscription_expires_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  developer_id TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  price INTEGER NOT NULL,
  code_prefix TEXT DEFAULT '',
  code_length INTEGER DEFAULT 16,
  code_charset TEXT DEFAULT 'alphanumeric',
  auto_confirm_enabled INTEGER DEFAULT 0,
  callback_url TEXT DEFAULT '',
  callback_secret TEXT DEFAULT '',
  stock INTEGER DEFAULT 0,
  code_validity_days INTEGER,
  is_active INTEGER DEFAULT 1,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS activation_codes (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id),
  code_value TEXT NOT NULL,
  status TEXT DEFAULT 'unused',
  order_id TEXT,
  expires_at INTEGER,
  issued_at INTEGER,
  created_at INTEGER NOT NULL,
  used_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_codes_product ON activation_codes(product_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_codes_value ON activation_codes(product_id, code_value);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  order_number TEXT UNIQUE NOT NULL,
  product_id TEXT NOT NULL REFERENCES products(id),
  buyer_email TEXT DEFAULT '',
  amount INTEGER NOT NULL,
  status TEXT DEFAULT 'pending',
  activation_code_id TEXT,
  created_at INTEGER NOT NULL,
  paid_at INTEGER,
  delivered_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_orders_product ON orders(product_id, status);

CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  developer_id TEXT NOT NULL REFERENCES users(id),
  key_value TEXT UNIQUE NOT NULL,
  secret TEXT NOT NULL,
  scope TEXT DEFAULT 'verify',
  is_active INTEGER DEFAULT 1,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS verification_logs (
  id TEXT PRIMARY KEY,
  code_id TEXT,
  code_value TEXT,
  result TEXT NOT NULL,
  ip_hash TEXT DEFAULT '',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
