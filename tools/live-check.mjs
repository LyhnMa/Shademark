const url = 'https://shademark.cn/admin.html?v=' + Date.now();
const r = await fetch(url);
const h = await r.text();
const has = (s) => h.includes(s);
const out = {
  status: r.status,
  len: h.length,
  sidebarLogoAnchor: has('class="logo" title="返回主页"'),
  whoBox: has('whoBox'),
  renderNavAuth: has('renderNavAuth'),
  navToolsAll6: ['主页', '报价单', '水印', '压缩', '发码', '短链'].every((t) => has('>' + t + '<')),
  sidebarHome: has('class="home"'),
  sidebarLinkItem: has('class="link-item"'),
  sidebarLogout: has('class="logout"'),
  logoutMini: has('logout-mini'),
  checkInline: (h.match(/function renderAccount\(d\)\{/) || []).length,
};
console.log(JSON.stringify(out, null, 2));
