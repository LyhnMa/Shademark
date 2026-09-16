/**
 * 品牌一致性自检 —— 扫描所有线上页面（src/pages + public + functions 内嵌 HTML），
 * 核对 Logo 与商标标识是否统一。
 *
 * 用法：node tools/brand-audit.mjs
 * 退出码：0 = 全部一致；1 = 存在不一致（便于接到 CI / 提交前检查）
 *
 * 检查项：
 *   1. favicon（rel="icon"）是否指向 /favicon.png（64² 小图，省流量）
 *   2. 页面内品牌 <img> 与 og:image 是否指向 /logo.png（256² 大图）
 *   3. 品牌 <img> 的 alt 是否统一为 "ShadeMark"
 *   4. 页面可见文本里是否残留商标符号（™ / ®）
 *   5. 顶部品牌区 logo 尺寸是否统一 32px
 *   6. 顶部品牌区字号是否按分组统一（导航 / 工具页 / 独立页 均 16px；登录卡片标题 20px）
 *   7. 顶部品牌区文字颜色是否为实色（不得使用 background-clip:text 渐变填充）
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// 分组：同组内应完全一致；跨组允许有设计差异。font 为 null 表示该页无品牌名文字，跳过字号检查
// 2026-09-15 起 logo 旁品牌名全站 16px（工具页保留渐变填充，仅字号统一）
const GROUPS = {
  nav: {
    font: '16px',
    files: [
      'src/pages/index.html', 'src/pages/store.html', 'src/pages/privacy.html',
      'src/pages/order-query.html', 'src/pages/links.html', 'src/pages/admin.html',
      'src/pages/platform.html',
      'functions/store/[product_id].ts',
    ],
  },
  tool: {
    font: '16px',
    files: ['src/pages/quote.html', 'public/watermark/index.html', 'public/compress/index.html'],
  },
  auth: {
    font: '20px',
    files: ['src/pages/login.html', 'src/pages/forgot.html', 'src/pages/reset.html'],
  },
  misc: {
    font: '16px',
    files: ['public/404.html'],
  },
  dyn: {
    font: null, // 短链失效页：只有 logo 图形，无品牌名文字
    files: ['functions/l/[slug].ts'],
  },
};

const EXPECT_ICON = '/favicon.png';   // tab 图标用小图
const EXPECT_LOGO = '/logo.png';      // 品牌图形 / 社交大图用大图
const EXPECT_ALT = 'ShadeMark';
const EXPECT_LOGO_SIZE = '32px';

const problems = [];
const rows = [];

for (const [group, cfg] of Object.entries(GROUPS)) {
  for (const rel of cfg.files) {
    const p = path.join(ROOT, rel);
    if (!fs.existsSync(p)) { problems.push(`${rel}: 文件不存在`); continue; }
    const html = fs.readFileSync(p, 'utf8');

    // 1) favicon
    const icons = [...new Set([...html.matchAll(/<link[^>]*rel=["']icon["'][^>]*href=["']([^"']+)/gi)].map(m => m[1]))];
    if (icons.length === 0) problems.push(`${rel}: 缺少 <link rel="icon">`);
    else if (icons.length > 1 || icons[0] !== EXPECT_ICON) problems.push(`${rel}: favicon = ${JSON.stringify(icons)}，期望 ${EXPECT_ICON}`);

    // 2) og:image（社交分享，必须用大图）
    const ogImages = [...html.matchAll(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)/gi)].map(m => m[1]);
    for (const u of ogImages) {
      if (!u.includes(EXPECT_LOGO)) problems.push(`${rel}: og:image = ${u}，期望指向 ${EXPECT_LOGO}`);
    }

    // 3) 品牌 <img> 的 src + alt
    const imgs = [...html.matchAll(/<img[^>]*>/gi)].map(m => m[0]).filter(t => /logo\.png/i.test(t));
    if (imgs.length === 0) problems.push(`${rel}: 未找到品牌 <img>`);
    for (const t of imgs) {
      const alt = (t.match(/alt=["']([^"']*)["']/) || [])[1];
      if (alt !== EXPECT_ALT) problems.push(`${rel}: img alt = ${JSON.stringify(alt)}，期望 "${EXPECT_ALT}"`);
      const src = (t.match(/src=["']([^"']+)/) || [])[1];
      if (src !== EXPECT_LOGO) problems.push(`${rel}: 品牌 img src = ${src}，期望 ${EXPECT_LOGO}`);
    }

    // 4) 可见文本残留商标符号
    const visible = html.replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<script[\s\S]*?<\/script>/gi, '');
    if (/[™®]/.test(visible)) problems.push(`${rel}: 可见文本里残留商标符号（™/®）`);

    // 5) logo 显示尺寸
    const sizes = [...html.matchAll(/\.(?:nav\s+\.?brand|sidebar\s+\.logo|logo|brand)\s+img\{([^}]*)\}/gi)]
      .map(m => (m[1].match(/width:\s*([^;}]+)/) || [])[1]).filter(Boolean);
    if (sizes.length && !sizes.includes(EXPECT_LOGO_SIZE)) {
      problems.push(`${rel}: 品牌 logo 尺寸 = ${JSON.stringify(sizes)}，期望含 ${EXPECT_LOGO_SIZE}`);
    }

    // 6) 品牌字号
    const fonts = [...html.matchAll(/\.(?:nav\s+\.?brand|sidebar\s+\.logo|brand-text|logo\s+h1|logo)\s*(?:span|h1)?\{([^}]*font-size:\s*([^;}]+))/gi)]
      .map(m => m[2].trim());
    const primary = fonts[0] || '';
    if (cfg.font && primary && primary !== cfg.font) {
      problems.push(`${rel}: 品牌字号 = ${primary}（组 ${group} 期望 ${cfg.font}）`);
    }

    // 7) 品牌名必须是实色（禁止 background-clip:text 渐变填充）
    const brandRule = (html.match(/\.(?:nav\s+\.?brand|sidebar\s+\.logo|brand-text|logo)\s*(?:span|h1)?\{[^}]*\}/gi) || []).join(' ');
    const hasGradientFill = /-webkit-background-clip:\s*text|background-clip:\s*text|-webkit-text-fill-color:\s*transparent/i.test(brandRule);
    if (hasGradientFill) {
      problems.push(`${rel}: 品牌名使用了渐变填充（background-clip:text），应为实色`);
    }

    rows.push({
      group, rel,
      icon: icons.join(','),
      alt: imgs.map(t => (t.match(/alt=["']([^"']*)["']/) || [])[1]).join(','),
      size: sizes.join(','),
      font: fonts.join(','),
      og: ogImages.length ? ogImages[0] : '-',
    });
  }
}

console.log('品牌一致性自检\n' + '='.repeat(78));
for (const g of Object.keys(GROUPS)) {
  console.log(`\n[${g}]`);
  for (const r of rows.filter(r => r.group === g)) {
    console.log(`  ${r.rel.padEnd(34)} icon=${r.icon}  alt=${r.alt}  size=${r.size}  font=${r.font}`);
  }
}
console.log('\nog:image（应为 logo.png）:');
for (const r of rows) if (r.og !== '-') console.log(`  ${r.rel} -> ${r.og}`);

console.log('\n' + '='.repeat(78));
if (problems.length) {
  console.log(`发现 ${problems.length} 处不一致：`);
  problems.forEach(p => console.log('  x ' + p));
  process.exit(1);
} else {
  console.log('全部一致，未发现问题。');
  process.exit(0);
}
