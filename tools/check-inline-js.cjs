/**
 * 轻量前端自检：逐个 <script> 块做语法编译 + div 标签平衡
 * 用法：node tools/check-inline-js.cjs [目录]   默认 src/pages
 */
const fs = require('fs');
const path = require('path');

const dir = process.argv[2] || 'src/pages';
let bad = 0;

for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.html'))) {
  const html = fs.readFileSync(path.join(dir, f), 'utf8');
  const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map(
    (m) => m[1]
  );
  scripts.forEach((code, i) => {
    try {
      new Function(code);
    } catch (e) {
      bad++;
      console.log(`JS-FAIL  ${f} script#${i}: ${e.message}`);
    }
  });

  const open = (html.match(/<div\b/g) || []).length;
  const close = (html.match(/<\/div>/g) || []).length;
  const flag = open === close ? '' : '  <== DIV 不平衡';
  if (open !== close) bad++;
  console.log(`OK  ${f}  scripts=${scripts.length}  div=${open}/${close}${flag}`);
}

console.log(bad ? `\n发现 ${bad} 个问题` : '\n全部通过');
process.exit(bad ? 1 : 0);
