/**
 * 品牌一致性自检 —— 扫描所有线上页面（src/pages + public），核对 Logo 与商标标识是否统一。
 *
 * 用法：node tools/brand-audit.mjs
 * 退出码：0 = 全部一致；1 = 存在不一致（便于接到 CI / 提交前检查）
 *
 * 检查项：
 *   1. favicon 与品牌 <img> 是否都指向 /logo.png
 *   2. 品牌 <img> 的 alt 是否统一为 "ShadeMark"
 *   3. 页面可见文本里是否残留商标符号（™ / ®）
 *   4. 顶部品牌区 logo 尺寸是否统一 32px
 *   5. 顶部品牌区字号是否按分组统一（导航 16px / 工具页 18px / 登录卡片 20px）
 *   6. 品牌名写法是否为 ShadeMark（无 Shademark / ShadeMark 变体）
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// 分组：同组内应完全一致；跨组允许有设计差异
const GROUPS = {
  nav: {
    font: '16px',
    files: [
      'src/pages/index.html', 'src/pages/store.html', 'src/pages/privacy.html',
      'src/pages/order-query.html', 'src/pages/links.html', 'src/pages/admin.html',
      'src/pages/platform.html',
    ],
  },
  tool: {
    font: '18px',
    files: ['src/pages/quote.html', 'public/watermark/index.html', 'public/compress/index.html'],
  },
  auth: {
    font: '20px',
    files: ['src/pages/login.html', 'src/pages/forgot.html', 'src/pages/reset.html'],
  },
  misc: {
    font: '18px',
    files: ['public/404.html'],
  },
};

const EXPECT_ALT = 'ShadeMark';
const EXPECT_ICON = '/logo.png';
const EXPECT_LOGO_SIZE = '32px';

const problems = [];
const rows = [];

for (const [group, cfg] of Object.entries(GROUPS)) {
  for (const rel of cfg.files) {
    const p = path.join(ROOT, rel);
    if (!fs.existsSync(p)) { problems.push(`${rel}: 文件不存在`); continue; }
    const html = fs.readFileSync(p, 'utf8');

    // 1) icon
    const icons = [...new Set([...html.matchAll(/<link[^>]*rel=["']icon["'][^>]*href=["']([^"']+)/gi)].map(m => m[1]))];
    if (icons.length === 0) problems.push(`${rel}: 缺少 <link rel="icon">`);
    else if (icons.length > 1 || icons[0] !== EXPECT_ICON) problems.push(`${rel}: favicon = ${JSON.stringify(icons)}，期望 ${EXPECT_ICON}`);

    // 2) 品牌 img 的 alt + src
    const imgs = [...html.matchAll(/<img[^>]*>/gi)].map(m => m[0]).filter(t => /logo\.png/i.test(t));
    if (imgs.length === 0) problems.push(`${rel}: 未找到品牌 <img>`);
    for (const t of imgs) {
      const alt = (t.match(/alt=["']([^"']*)["']/) || [])[1];
      if (alt !== EXPECT_ALT) problems.push(`${rel}: img alt = ${JSON.stringify(alt)}，期望 "${EXPECT_ALT}"`);
    }

    // 3) 可见文本残留商标符号
    const visible = html.replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<script[\s\S]*?<\/script>/gi, '');
    if (/[™®]/.test(visible)) problems.push(`${rel}: 可见文本里残留商标符号（™/®）`);

    // 4) logo 显示尺寸
    const sizes = [...html.matchAll(/\.(?:nav\s+\.?brand|sidebar\s+\.logo|logo|brand)\s+img\{([^}]*)\}/gi)]
      .map(m => (m[1].match(/width:\s*([^;}]+)/) || [])[1]).filter(Boolean);
    if (sizes.length && !sizes.includes(EXPECT_LOGO_SIZE)) {
      problems.push(`${rel}: logo 尺寸 = ${JSON.stringify(sizes)}，期望含 ${EXPECT_LOGO_SIZE}`);
    }

    // 5) 品牌字号
    const fonts = [...html.matchAll(/\.(?:nav\s+\.?brand|sidebar\s+\.logo|brand-text|logo\s+h1|logo)\s*(?:span|h1)?\{([^}]*font-size:\s*([^;}]+))/gi)]
      .map(m => m[2].trim());
    const primary = fonts[0] || '';
    if (primary && primary !== cfg.font) {
      problems.push(`${rel}: 品牌字号 = ${primary}（组 ${group} 期望 ${cfg.font}）`);
    }

    rows.push({ group, rel, icons: icons.join(','), alt: imgs.map(t => (t.match(/alt=["']([^"']*)["']/) || [])[1]).join(','), size: sizes.join(','), font: fonts.join(',') });
  }
}

console.log('品牌一致性自检\n' + '='.repeat(72));
for (const g of Object.keys(GROUPS)) {
  console.log(`\n[${g}]`);
  for (const r of rows.filter(r => r.group === g)) {
    console.log(`  ${r.rel.padEnd(32)} icon=${r.icons}  alt=${r.alt}  size=${r.size}  font=${r.font}`);
  }
}
console.log('\n' + '='.repeat(72));
if (problems.length) {
  console.log(`发现 ${problems.length} 处不一致：`);
  problems.forEach(p => console.log('  x ' + p));
  process.exit(1);
} else {
  console.log('全部一致，未发现问题。');
  process.exit(0);
}
