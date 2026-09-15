const PAGE = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>商品购买 — ShadeMark</title>
<link rel="icon" href="/favicon.png" type="image/png">
<style>
:root{--bg:#0d0d0f;--card:#17171b;--border:#2a2a33;--text:#e8e8ea;--muted:#8a8a94;--accent:#7c6cf0;--danger:#f87171;--success:#4ade80;--warn:#ffd166}
*{margin:0;padding:0;box-sizing:border-box}
body{background:var(--bg);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;min-height:100vh;overflow-x:hidden}
.nav{height:60px;border-bottom:1px solid var(--border);display:flex;align-items:center;padding:0 24px;gap:24px;background:var(--bg)}
.nav .brand{display:flex;align-items:center;gap:10px;text-decoration:none;color:var(--text);flex-shrink:0}
.nav .brand img{width:32px;height:32px;object-fit:contain;border-radius:8px}
.nav .brand span{font-size:16px;font-weight:700;letter-spacing:-0.02em}
.nav-tools{display:flex;gap:4px;align-items:center}
.nav-tools a{color:var(--muted);text-decoration:none;font-size:14px;font-weight:500;padding:7px 12px;border-radius:6px;transition:color .2s,background .2s;white-space:nowrap}
.nav-tools a:hover{color:var(--text);background:#141419}
.nav-links{display:flex;gap:20px;align-items:center;margin-left:auto}
.nav-links a{color:var(--muted);text-decoration:none;font-size:14px;font-weight:500;transition:color .2s}
.nav-links a:hover{color:var(--text)}
.home-link{display:inline-flex;align-items:center;gap:6px;padding:6px 12px;border:1px solid var(--border);border-radius:6px;color:var(--muted);text-decoration:none;font-size:13px;font-weight:600;white-space:nowrap;transition:all .2s;margin-left:auto}
.home-link:hover{color:var(--text);border-color:var(--accent)}
.wrap{max-width:600px;margin:0 auto;padding:clamp(28px,6vh,56px) 24px;min-height:calc(100vh - 60px);display:flex;flex-direction:column}
.card{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:clamp(24px,4vh,32px)}
.card h1{font-size:22px;font-weight:700;margin-bottom:10px}
.desc{color:var(--muted);font-size:14px;line-height:1.6;margin-bottom:20px;white-space:pre-wrap}
.price{font-size:30px;font-weight:700;margin-bottom:24px;color:var(--text)}
.price span{font-size:14px;color:var(--muted);font-weight:400}
.form-group{margin-bottom:16px}
.form-group label{display:block;font-size:12px;color:var(--muted);margin-bottom:6px;font-weight:600;text-transform:uppercase;letter-spacing:.5px}
.form-group input{width:100%;padding:12px;background:var(--bg);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:14px;outline:none}
.form-group input:focus{border-color:var(--accent)}
.btn{padding:12px 18px;border-radius:6px;border:none;font-size:15px;font-weight:600;cursor:pointer;transition:all .2s}
.btn-primary{background:var(--accent);color:#fff;width:100%}
.btn-primary:hover{opacity:.88}
.btn-primary:disabled{opacity:.5;cursor:not-allowed}
.btn-ghost{background:transparent;border:1px solid var(--border);color:var(--text);text-decoration:none;display:inline-flex;align-items:center;justify-content:center;gap:6px}
.btn-ghost:hover{border-color:var(--accent);color:var(--text)}
.btn-block{width:100%;display:flex;box-sizing:border-box;padding:12px;margin-top:16px}
.error{color:var(--danger);font-size:13px;margin-top:10px;display:none}
.notice{display:none;margin-top:24px;padding-top:20px;border-top:1px solid var(--border)}
.notice.show{display:block}
.order-no{font-family:'ui-monospace',SFMono-Regular,Menlo,monospace;font-size:18px;font-weight:700;letter-spacing:1px;color:var(--warn);word-break:break-all}
.state-msg{color:var(--muted);font-size:13px;line-height:1.7;margin:12px 0 16px}
.code-box{background:var(--bg);border:1px solid var(--success);border-radius:6px;padding:16px;text-align:center;margin-bottom:16px}
.code-box .code{font-size:20px;font-weight:700;letter-spacing:2px;color:var(--success);font-family:'ui-monospace',SFMono-Regular,Menlo,monospace;word-break:break-all}
.code-box .hint{font-size:12px;color:var(--muted);margin-top:8px}
.action-row{display:flex;gap:10px;flex-wrap:wrap;margin-top:8px}
.state-tag{display:inline-block;padding:3px 8px;border-radius:4px;font-size:12px;font-weight:600}
.spin{display:inline-block;width:12px;height:12px;border:2px solid rgba(255,255,255,.3);border-top-color:#fff;border-radius:50%;animation:sp .7s linear infinite;vertical-align:-1px;margin-right:6px}
@keyframes sp{to{transform:rotate(360deg)}}
.empty{color:var(--muted);text-align:center;padding:60px 0;font-size:14px}
.footer{text-align:center;margin-top:28px}
@media(max-width:600px){.nav{padding:0 16px;gap:8px}.nav-tools{display:none}.nav-links{gap:14px;overflow-x:auto}.card{padding:20px}}
</style>
</head>
<body>
<nav class="nav">
  <a href="/" class="brand"><img src="/logo.png" alt="ShadeMark"><span>ShadeMark</span></a>
  <div class="nav-tools">
    <a href="/">主页</a><a href="/quote">报价单</a><a href="/watermark">水印</a><a href="/compress">压缩</a><a href="/admin">发码</a><a href="/links">短链</a>
  </div>
</nav>
<div class="wrap">
  <div id="loadState" class="empty">加载中...</div>
  <div id="errorState" class="empty" style="display:none"></div>
  <!-- 商品信息 + 下单 -->
  <div id="buyBox" style="display:none">
    <div class="card">
      <h1 id="pName"></h1>
      <p class="desc" id="pDesc"></p>
      <div class="price">¥<span id="pPrice"></span><span id="pPriceUnit"> / 个</span></div>
      <div id="orderForm">
        <div class="form-group"><label>备注</label><input id="buyerEmail" type="text" placeholder="建议使用邮箱，用于卖家核对订单" autocomplete="email" /></div>
        <button class="btn btn-primary" id="orderBtn" onclick="placeOrder()">立即下单</button>
        <div class="error" id="formError"></div>
      </div>
      <!-- 下单成功 / 状态区 -->
      <div class="notice" id="notice">
        <div id="noticeInner"></div>
      </div>
    </div>
  </div>
  <div class="footer"><a href="/" class="home-link">← 返回主页</a></div>
</div>
<script>
var productId=location.pathname.split('/').filter(Boolean).pop()||'';
var pollTimer=null;
var statusLabels={pending:'待支付',paid:'已支付',delivered:'已发码',cancelled:'已取消',refunded:'已退款'};
function esc(s){return String(s??'').replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function loadState(html){document.getElementById('loadState').innerHTML=html;document.getElementById('loadState').style.display='block'}
function showBuy(){document.getElementById('loadState').style.display='none';document.getElementById('buyBox').style.display='block'}
function showError(msg){document.getElementById('loadState').style.display='none';var e=document.getElementById('errorState');e.style.display='block';e.innerHTML=esc(msg)}
async function loadProduct(){
  if(!productId){showError('链接缺少商品ID');return}
  try{
    var r=await fetch('/api/store/products/'+encodeURIComponent(productId));
    var d=await r.json();
    if(d.error){showError(d.error);return}
    if(!d||!d.is_active){showError('商品已下架或不存在');return}
    document.getElementById('pName').textContent=d.name||'未命名商品';
    document.getElementById('pDesc').textContent=d.description||'暂无描述';
    document.getElementById('pPrice').textContent=(d.price/100).toFixed(2);
    var email=localStorage.getItem('shademark_buyer_email');
    if(email)document.getElementById('buyerEmail').value=email;
    showBuy();
  }catch(e){showError('加载失败，请重试')}
}
function setFormError(msg){var el=document.getElementById('formError');el.textContent=msg;el.style.display=msg?'block':'none'}
function stopPoll(){if(pollTimer){clearInterval(pollTimer);pollTimer=null}}
// 渲染订单状态区（delivered 传 code 显示激活码；否则显示等待提示）
function renderNotice(stateMsgHtml, code, orderNumber){
  var inner=document.getElementById('noticeInner');
  var html='';
  if(code){
    html+='<div style="font-size:15px;font-weight:700;margin-bottom:4px;color:var(--success)">✓ 订单已创建</div>';
    html+='<div class="code-box"><div class="code">'+esc(code)+'</div><div class="hint">您的激活码，请妥善保管</div></div>';
  }
  html+='<div style="font-size:13px;color:var(--muted);margin-bottom:6px">订单号</div>';
  html+='<div class="order-no">'+esc(orderNumber)+'</div>';
  html+='<div class="state-msg">'+stateMsgHtml+'</div>';
  var note=document.getElementById('buyerEmail').value||'';
  html+='<a class="btn btn-ghost btn-block" href="/order-query?order='+encodeURIComponent(orderNumber)+'&email='+encodeURIComponent(note)+'">刷新状态</a>';
  document.getElementById('notice').classList.add('show');
  inner.innerHTML=html;
}
async function tickOrder(){
  // 轮询订单状态：delivered 时显示激活码（不跳转也可自动出现）
  try{
    var r=await fetch('/api/orders/'+encodeURIComponent(currentOrderNumber));
    var d=await r.json();
    if(d.error)return;
    if(d.status==='delivered'&&d.activation_code){
      stopPoll();
      renderNotice('', '订单已完成，您的激活码如下：', d.activation_code, currentOrderNumber);
      return;
    }
    if(d.status==='cancelled'||d.status==='refunded'){
      stopPoll();
      renderNotice('', '该订单已取消/退款，未发码。', null, currentOrderNumber);
      return;
    }
  }catch(e){}
}
var currentOrderNumber=null;
async function placeOrder(){
  var note=document.getElementById('buyerEmail').value.trim();
  setFormError('');
  if(!note){setFormError('请填写备注');return}
  localStorage.setItem('shademark_buyer_email',note);
  var btn=document.getElementById('orderBtn');
  btn.disabled=true;btn.innerHTML='<span class="spin"></span>下单中...';
  try{
    var r=await fetch('/api/store/orders',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({product_id:productId,buyer_email:note})});
    var d=await r.json();
    if(d.error){setFormError(d.error)}
    else{
      // 下单成功：隐藏下单表单，显示订单号 + 页内刷新按钮
      document.getElementById('orderForm').style.display='none';
      currentOrderNumber=d.order_number;
      renderNotice('', '订单已创建，等待开发者确认收款后将自动显示激活码。可点击下方按钮随时查询状态。', null, currentOrderNumber);
      // 自动轮询，发码后即时展示
      stopPoll();tickOrder();pollTimer=setInterval(tickOrder,3000);
    }
  }catch(e){setFormError('网络错误，请重试')}
  finally{btn.disabled=false;btn.innerHTML='立即下单'}
}
document.getElementById('buyerEmail').addEventListener('keydown',function(e){if(e.key==='Enter')placeOrder()});
loadProduct();
window.addEventListener('beforeunload',stopPoll);
</script>
</body>
</html>`;

// GET /store/:product_id —— 渲染商品独立购买页（买家无需登录）
export async function onRequestGet(context: any): Promise<Response> {
  return new Response(PAGE, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}
