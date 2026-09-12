-- 报价单工具（quote_records）
-- 在已有库上执行：npx wrangler d1 execute shademark --remote --file=schema_quote.sql

CREATE TABLE IF NOT EXISTS quote_records (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  quote_no TEXT NOT NULL,
  buyer_name TEXT DEFAULT '',
  buyer_contact TEXT DEFAULT '',
  seller_name TEXT DEFAULT '',
  seller_contact TEXT DEFAULT '',
  seller_note TEXT DEFAULT '',
  validity_days INTEGER DEFAULT 30,
  tax_enabled INTEGER DEFAULT 0,
  tax_rate REAL DEFAULT 0,
  items TEXT NOT NULL,
  note TEXT DEFAULT '',
  total REAL NOT NULL DEFAULT 0,
  tax_amount REAL NOT NULL DEFAULT 0,
  grand_total REAL NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_quote_user ON quote_records(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_quote_no ON quote_records(user_id, quote_no);
