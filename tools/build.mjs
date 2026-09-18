/**
 * 构建 dist/：src/pages/*.html → dist/，public/* → dist/*
 * 用法：node tools/build.mjs
 *
 * 为什么不直接 Copy-Item -Recurse：源目录与已存在的目标目录同名时 PowerShell 会多套一层，
 * 曾把 dist/watermark/watermark/ 一起部署上线。这里显式逐文件复制，根目录先清空。
 */
import { cp, mkdir, readdir, rm, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const DIST = join(ROOT, 'dist');

async function walk(dir, base = dir, out = []) {
  for (const name of await readdir(dir)) {
    const full = join(dir, name);
    const st = await stat(full);
    if (st.isDirectory()) await walk(full, base, out);
    else out.push(relative(base, full).split('\\').join('/'));
  }
  return out;
}

await rm(DIST, { recursive: true, force: true });
await mkdir(DIST, { recursive: true });

const rel = [];
for (const f of await readdir(join(ROOT, 'src/pages'))) {
  if (f.endsWith('.html')) rel.push(['src/pages/' + f, f]);
}
for (const f of await walk(join(ROOT, 'public'))) rel.push(['public/' + f, f]);

let n = 0;
for (const [src, dest] of rel) {
  const from = join(ROOT, src);
  if (!existsSync(from)) continue;
  const to = join(DIST, dest);
  await mkdir(join(to, '..'), { recursive: true });
  await cp(from, to);
  n++;
}

const built = await walk(DIST);
console.log(`dist/ 重建完成：${n} 个文件（src/pages ${rel.filter((r) => r[0].startsWith('src/')).length} + public ${rel.filter((r) => r[0].startsWith('public/')).length}）`);
console.log(built.sort().map((f) => '  ' + f).join('\n'));
