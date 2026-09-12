/** 邮箱格式校验：必须有 @ 与点分域名，且不含空白 */
export function isEmail(input: string): boolean {
  const s = String(input || '').trim();
  if (s.length > 254) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s);
}

/** 脱敏展示：ab***@163.com */
export function maskEmail(input: string): string {
  const s = String(input || '');
  const at = s.lastIndexOf('@');
  if (at <= 0) return s ? s.slice(0, 1) + '***' : '';
  const name = s.slice(0, at);
  const domain = s.slice(at);
  const head = name.slice(0, Math.min(2, name.length));
  return `${head}***${domain}`;
}
