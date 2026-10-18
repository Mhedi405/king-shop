require("dotenv").config();
const express = require("express");
const session = require("express-session");
const multer = require("multer");
const { Pool } = require("pg");
const path = require("path");

const app = express();
const port = process.env.PORT || 3000;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 3 * 1024 * 1024 } });

if (!process.env.DATABASE_URL) {
  console.error("Missing DATABASE_URL. Copy .env.example to .env and configure a PostgreSQL database.");
  process.exit(1);
}
if (!process.env.SESSION_SECRET || !process.env.ADMIN_PASSWORD) {
  console.error("Set SESSION_SECRET and ADMIN_PASSWORD in environment variables.");
  process.exit(1);
}
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : false
});

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false }));
app.use(session({
  name: "king.sid",
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 8 * 60 * 60 * 1000 }
}));
app.use((req, res, next) => {
  if (["/server.js", "/package.json", "/README.md", "/.env", "/.env.example"].includes(req.path)) {
    return res.sendStatus(404);
  }
  next();
});
app.use(express.static(__dirname, { dotfiles: "deny" }));

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS products (
      id SERIAL PRIMARY KEY, name TEXT NOT NULL, description TEXT DEFAULT '',
      price_toman INTEGER NOT NULL CHECK(price_toman >= 0), stock INTEGER NOT NULL DEFAULT 0,
      image_data TEXT DEFAULT '', created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS orders (
      id BIGSERIAL PRIMARY KEY, customer_name TEXT NOT NULL, phone TEXT NOT NULL,
      address TEXT NOT NULL, items JSONB NOT NULL, total_toman INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending', authority TEXT DEFAULT '',
      ref_id TEXT DEFAULT '', created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
}
const adminOnly = (req, res, next) => req.session && req.session.isAdmin ? next() : res.status(401).json({ error: "ابتدا وارد پنل مدیریت شوید." });

app.get("/api/products", async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT id,name,description,price_toman,stock,image_data FROM products ORDER BY id DESC");
    res.json(rows);
  } catch (e) { console.error(e); res.status(500).json({ error: "خطا در دریافت محصولات" }); }
});

app.post("/api/admin/login", (req, res) => {
  const password = String(req.body.password || "");
  if (password !== process.env.ADMIN_PASSWORD) return res.status(401).json({ error: "رمز عبور درست نیست." });
  req.session.isAdmin = true;
  res.json({ ok: true });
});
app.post("/api/admin/logout", (req, res) => req.session.destroy(() => res.json({ ok: true })));
app.get("/api/admin/me", (req, res) => res.json({ loggedIn: !!(req.session && req.session.isAdmin) }));
app.get("/api/admin/orders", adminOnly, async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT id,customer_name,phone,address,items,total_toman,status,ref_id,created_at FROM orders ORDER BY id DESC LIMIT 200");
    res.json(rows);
  } catch (e) { console.error(e); res.status(500).json({ error: "خطا در دریافت سفارش‌ها" }); }
});
app.patch("/api/admin/orders/:id", adminOnly, async (req, res) => {
  const allowed = ["pending", "paid", "processing", "sent", "cancelled"];
  if (!allowed.includes(req.body.status)) return res.status(400).json({ error: "وضعیت نامعتبر است." });
  try {
    await pool.query("UPDATE orders SET status=$1 WHERE id=$2", [req.body.status, req.params.id]);
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: "خطا در تغییر وضعیت" }); }
});
app.post("/api/admin/products", adminOnly, upload.single("image"), async (req, res) => {
  const name = String(req.body.name || "").trim();
  const price = Number(req.body.price_toman);
  const stock = Number(req.body.stock);
  if (!name || !Number.isSafeInteger(price) || price < 0 || !Number.isSafeInteger(stock) || stock < 0) {
    return res.status(400).json({ error: "نام، قیمت و موجودی را درست وارد کنید." });
  }
  let imageData = "";
  if (req.file) {
    if (!req.file.mimetype.startsWith("image/")) return res.status(400).json({ error: "فقط فایل تصویر مجاز است." });
    imageData = `data:${req.file.mimetype};base64,${req.file.buffer.toString("base64")}`;
  }
  try {
    const { rows } = await pool.query(
      "INSERT INTO products(name,description,price_toman,stock,image_data) VALUES($1,$2,$3,$4,$5) RETURNING id,name,description,price_toman,stock,image_data",
      [name, String(req.body.description || "").trim(), price, stock, imageData]
    );
    res.json(rows[0]);
  } catch (e) { console.error(e); res.status(500).json({ error: "خطا در ثبت محصول" }); }
});
app.delete("/api/admin/products/:id", adminOnly, async (req, res) => {
  try {
    await pool.query("DELETE FROM products WHERE id=$1", [req.params.id]);
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: "خطا در حذف محصول" }); }
});

app.post("/api/checkout", async (req, res) => {
  const { name, phone, address, items } = req.body || {};
  if (!String(name || "").trim() || !/^[0-9+\-\s()]{8,20}$/.test(String(phone || "")) || !String(address || "").trim() || !Array.isArray(items) || !items.length) {
    return res.status(400).json({ error: "نام، شماره تماس، نشانی و سبد خرید را بررسی کنید." });
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    let total = 0, cleanItems = [];
    for (const item of items) {
      const id = Number(item.id), qty = Number(item.qty);
      if (!Number.isInteger(id) || !Number.isInteger(qty) || qty < 1 || qty > 20) throw new Error("تعداد محصول نامعتبر است.");
      const result = await client.query("SELECT id,name,price_toman,stock FROM products WHERE id=$1 FOR UPDATE", [id]);
      if (!result.rows.length) throw new Error("یکی از محصولات دیگر موجود نیست.");
      const p = result.rows[0];
      if (p.stock < qty) throw new Error(`موجودی «${p.name}» کافی نیست.`);
      total += Number(p.price_toman) * qty;
      cleanItems.push({ id: p.id, name: p.name, price_toman: Number(p.price_toman), qty });
    }
    if (total <= 0) throw new Error("مبلغ سفارش معتبر نیست.");
    const result = await client.query(
      "INSERT INTO orders(customer_name,phone,address,items,total_toman,status) VALUES($1,$2,$3,$4,$5,'pending') RETURNING id",
      [String(name).trim(), String(phone).trim(), String(address).trim(), JSON.stringify(cleanItems), total]
    );
    await client.query("COMMIT");
    const orderId = result.rows[0].id;
    if (process.env.PAYMENTS_ENABLED !== "true" || !process.env.ZARINPAL_MERCHANT_ID) {
      return res.json({ ok: true, orderId, payment: "disabled", message: "سفارش آزمایشی ثبت شد؛ درگاه هنوز فعال نشده است." });
    }
    const siteUrl = String(process.env.SITE_URL || "").replace(/\/$/, "");
    if (!siteUrl.startsWith("https://")) return res.status(500).json({ error: "برای پرداخت، SITE_URL باید آدرس HTTPS سایت باشد." });
    const amountRial = total * 10;
    const gatewayResp = await fetch("https://api.zarinpal.com/pg/v4/payment/request.json", {
      method: "POST", headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({
        merchant_id: process.env.ZARINPAL_MERCHANT_ID,
        amount: amountRial,
        callback_url: `${siteUrl}/api/payment/callback`,
        description: `سفارش KING SHOP شماره ${orderId}`,
        metadata: { mobile: String(phone).trim() }
      })
    });
    const gateway = await gatewayResp.json();
    const data = gateway.data || {};
    if (!gatewayResp.ok || !data.authority) {
      console.error("Gateway request failed", gateway);
      return res.status(502).json({ error: "درخواست پرداخت ناموفق بود؛ سفارش ثبت شده و برای پیگیری با فروشگاه تماس بگیرید." });
    }
    await pool.query("UPDATE orders SET authority=$1 WHERE id=$2", [data.authority, orderId]);
    res.json({ ok: true, orderId, payment: "online", redirect: `https://www.zarinpal.com/pg/StartPay/${data.authority}` });
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch (_) {}
    res.status(400).json({ error: e.message || "ثبت سفارش ناموفق بود." });
  } finally { client.release(); }
});

app.get("/api/payment/callback", async (req, res) => {
  const authority = String(req.query.Authority || "");
  const status = String(req.query.Status || "");
  try {
    const found = await pool.query("SELECT id,total_toman FROM orders WHERE authority=$1", [authority]);
    if (!found.rows.length) return res.redirect("/?payment=unknown");
    const order = found.rows[0];
    if (status !== "OK") {
      await pool.query("UPDATE orders SET status='cancelled' WHERE id=$1 AND status='pending'", [order.id]);
      return res.redirect(`/?payment=cancelled&order=${order.id}`);
    }
    const verifyResp = await fetch("https://api.zarinpal.com/pg/v4/payment/verify.json", {
      method: "POST", headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({
        merchant_id: process.env.ZARINPAL_MERCHANT_ID,
        amount: Number(order.total_toman) * 10,
        authority
      })
    });
    const verify = await verifyResp.json();
    const code = Number(verify.data && verify.data.code);
    if (verifyResp.ok && (code === 100 || code === 101)) {
      await pool.query("UPDATE orders SET status='paid',ref_id=$1 WHERE id=$2", [String(verify.data.ref_id || ""), order.id]);
      return res.redirect(`/?payment=success&order=${order.id}`);
    }
    console.error("Payment verification failed", verify);
    return res.redirect(`/?payment=failed&order=${order.id}`);
  } catch (e) {
    console.error(e);
    return res.redirect("/?payment=error");
  }
});

app.get("*", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));
initDb().then(() => app.listen(port, () => console.log(`KING SHOP running on ${port}`)))
  .catch(e => { console.error("Database initialization failed:", e); process.exit(1); });
