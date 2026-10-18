const $ = (s) => document.querySelector(s);
const fmt = n => Number(n || 0).toLocaleString("fa-IR") + " تومان";
let products = [], cart = JSON.parse(localStorage.getItem("king-cart") || "[]");
const escapeHtml = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
function saveCart(){localStorage.setItem("king-cart",JSON.stringify(cart));updateCartCount();}
function updateCartCount(){$("#cartCount").textContent=cart.reduce((s,i)=>s+i.qty,0).toLocaleString("fa-IR");}
function showNotice(text){const n=$("#notice");n.textContent=text;n.classList.remove("hidden");}
async function loadProducts(){
  try{const r=await fetch("/api/products");products=await r.json();renderProducts();}
  catch(e){$("#productGrid").innerHTML='<div class="empty">ارتباط با فروشگاه برقرار نشد. تنظیمات سرور را بررسی کنید.</div>';}
}
function renderProducts(){
 const grid=$("#productGrid");
 if(!products.length){grid.innerHTML='<div class="empty">هنوز محصولی ثبت نشده است. از پنل مدیریت محصول اضافه کن.</div>';return;}
 grid.innerHTML=products.map(p=>`<article class="card"><div class="productImage">${p.image_data?`<img src="${p.image_data}" alt="${escapeHtml(p.name)}">`:'<span class="placeholder">♛</span>'}</div><div class="cardBody"><h3>${escapeHtml(p.name)}</h3><p>${escapeHtml(p.description||"لوازم جانبی خودرو")}</p><div class="priceRow"><span class="price">${fmt(p.price_toman)}</span><button class="addBtn" data-add="${p.id}" ${p.stock<1?"disabled":""}>${p.stock>0?"افزودن به سبد":"ناموجود"}</button></div><div class="stock">موجودی: ${Number(p.stock).toLocaleString("fa-IR")}</div></div></article>`).join("");
 grid.querySelectorAll("[data-add]").forEach(b=>b.onclick=()=>{const id=Number(b.dataset.add),found=cart.find(i=>i.id===id);if(found)found.qty++;else cart.push({id,qty:1});saveCart();renderCart();b.textContent="اضافه شد ✓";setTimeout(()=>{if(b.isConnected)b.textContent="افزودن به سبد";},900);});
}
function renderCart(){
 const wrap=$("#cartItems");
 if(!cart.length){wrap.innerHTML='<div class="empty">سبد خریدت خالی است.</div>';$("#cartTotal").textContent=fmt(0);return;}
 let total=0;
 wrap.innerHTML=cart.map(i=>{const p=products.find(p=>p.id===i.id);if(!p)return"";total+=Number(p.price_toman)*i.qty;return `<div class="cartLine"><div><b>${escapeHtml(p.name)}</b><small>${fmt(p.price_toman)} × ${i.qty.toLocaleString("fa-IR")}</small></div><div class="qtyControls"><button data-minus="${p.id}">−</button><span>${i.qty.toLocaleString("fa-IR")}</span><button data-plus="${p.id}">+</button><button data-remove="${p.id}" aria-label="حذف">×</button></div></div>`;}).join("");
 $("#cartTotal").textContent=fmt(total);
 wrap.querySelectorAll("[data-minus]").forEach(b=>b.onclick=()=>changeQty(Number(b.dataset.minus),-1));
 wrap.querySelectorAll("[data-plus]").forEach(b=>b.onclick=()=>changeQty(Number(b.dataset.plus),1));
 wrap.querySelectorAll("[data-remove]").forEach(b=>b.onclick=()=>{cart=cart.filter(i=>i.id!==Number(b.dataset.remove));saveCart();renderCart();});
}
function changeQty(id,d){const i=cart.find(i=>i.id===id);if(i){i.qty+=d;if(i.qty<1)cart=cart.filter(x=>x.id!==id);saveCart();renderCart();}}
function openModal(id){$("#"+id).classList.remove("hidden");}
function closeModal(id){$("#"+id).classList.add("hidden");}
document.querySelectorAll("[data-close]").forEach(b=>b.onclick=()=>closeModal(b.dataset.close));
document.querySelectorAll(".modal").forEach(m=>m.addEventListener("click",e=>{if(e.target===m)closeModal(m.id)}));
$("#cartOpen").onclick=()=>{renderCart();openModal("cartModal");};
$("#checkoutForm").onsubmit=async e=>{
 e.preventDefault();if(!cart.length){alert("سبد خرید خالی است.");return;}
 const btn=e.submitter;btn.disabled=true;btn.textContent="در حال ثبت سفارش...";
 try{
  const form=new FormData(e.target);
  const r=await fetch("/api/checkout",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:form.get("name"),phone:form.get("phone"),address:form.get("address"),items:cart})});
  const data=await r.json();if(!r.ok)throw new Error(data.error||"ثبت سفارش ناموفق بود.");
  if(data.redirect){location.href=data.redirect;return;}
  cart=[];saveCart();renderCart();closeModal("cartModal");alert(`سفارش شماره ${data.orderId} ثبت شد. ${data.message||""}`);e.target.reset();
 }catch(err){alert(err.message);}finally{btn.disabled=false;btn.textContent="ثبت سفارش و پرداخت";}
};
$("#adminOpen").onclick=async()=>{openModal("adminModal");await checkAdmin();};
async function checkAdmin(){try{const r=await fetch("/api/admin/me");const d=await r.json();$("#adminLogin").classList.toggle("hidden",d.loggedIn);$("#adminPanel").classList.toggle("hidden",!d.loggedIn);if(d.loggedIn)loadAdminProducts();}catch(e){}}
$("#loginForm").onsubmit=async e=>{e.preventDefault();const password=new FormData(e.target).get("password");const r=await fetch("/api/admin/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({password})});const d=await r.json();if(!r.ok){alert(d.error);return;}e.target.reset();checkAdmin();};
$("#logoutBtn").onclick=async()=>{await fetch("/api/admin/logout",{method:"POST"});checkAdmin();};
document.querySelectorAll("[data-tab]").forEach(b=>b.onclick=()=>{document.querySelectorAll("[data-tab]").forEach(x=>x.classList.toggle("active",x===b));$("#manageProducts").classList.toggle("hidden",b.dataset.tab!=="manageProducts");$("#manageOrders").classList.toggle("hidden",b.dataset.tab!=="manageOrders");if(b.dataset.tab==="manageOrders")loadOrders();});
async function loadAdminProducts(){const r=await fetch("/api/products");products=await r.json();renderProducts();$("#adminProducts").innerHTML=products.map(p=>`<div class="adminRow"><div><b>${escapeHtml(p.name)}</b><small>${fmt(p.price_toman)} | موجودی ${p.stock}</small></div><button class="danger" data-del="${p.id}">حذف محصول</button></div>`).join("")||'<div class="empty">محصولی وجود ندارد.</div>';$("#adminProducts").querySelectorAll("[data-del]").forEach(b=>b.onclick=async()=>{if(!confirm("این محصول حذف شود؟"))return;const r=await fetch("/api/admin/products/"+b.dataset.del,{method:"DELETE"});if(r.ok)loadAdminProducts();});}
$("#productForm").onsubmit=async e=>{e.preventDefault();const r=await fetch("/api/admin/products",{method:"POST",body:new FormData(e.target)});const d=await r.json();if(!r.ok){alert(d.error||"خطا");return;}e.target.reset();alert("محصول ثبت شد.");loadAdminProducts();};
async function loadOrders(){const r=await fetch("/api/admin/orders");if(!r.ok){$("#ordersList").innerHTML='<div class="empty">ابتدا دوباره وارد پنل شوید.</div>';return;}const orders=await r.json();$("#ordersList").innerHTML=orders.map(o=>`<div class="adminRow"><div><b>سفارش #${o.id}</b><small>${escapeHtml(o.customer_name)} — ${escapeHtml(o.phone)}</small><small>${escapeHtml(o.address)}</small><small>${(o.items||[]).map(i=>escapeHtml(i.name)+" × "+i.qty).join("، ")}</small><small>مبلغ: ${fmt(o.total_toman)} ${o.ref_id?" | کد پیگیری: "+escapeHtml(o.ref_id):""}</small></div><div><select class="statusSelect" data-status="${o.id}"><option value="pending">در انتظار پرداخت</option><option value="paid">پرداخت‌شده</option><option value="processing">در حال آماده‌سازی</option><option value="sent">ارسال‌شده</option><option value="cancelled">لغوشده</option></select></div></div>`).join("")||'<div class="empty">هنوز سفارشی ثبت نشده است.</div>';orders.forEach(o=>{const s=document.querySelector(`[data-status="${o.id}"]`);if(s){s.value=o.status;s.onchange=async()=>{const r=await fetch("/api/admin/orders/"+o.id,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({status:s.value})});if(!r.ok)alert("تغییر وضعیت ناموفق بود.");};}});}
$("#refreshOrders").onclick=loadOrders;
function paymentMessage(){const q=new URLSearchParams(location.search),status=q.get("payment"),order=q.get("order");if(!status)return;const messages={success:`پرداخت سفارش ${order||""} با موفقیت تأیید شد.`,cancelled:`پرداخت سفارش ${order||""} لغو شد.`,failed:"تأیید پرداخت انجام نشد؛ وضعیت سفارش را بررسی کنید.",error:"در بررسی پرداخت خطایی رخ داد؛ با فروشگاه تماس بگیرید.",unknown:"سفارش مربوط به این پرداخت پیدا نشد."};showNotice(messages[status]||"وضعیت پرداخت نامشخص است.");history.replaceState({}, "", "/");}
updateCartCount();loadProducts().then(paymentMessage);
