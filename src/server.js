const { createServer } = require("node:http");
const { readFile, writeFile, mkdir } = require("node:fs/promises");
const { join } = require("node:path");
const { randomUUID, createHmac, timingSafeEqual } = require("node:crypto");
const { Pool } = require("pg");

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";
const DATA_PATH = join(process.cwd(), "data", "store.json");
const UPLOAD_DIR = join(process.cwd(), "data", "uploads");
const SESSION_SECRET = process.env.SESSION_SECRET || process.env.ADMIN_PASSWORD || "dev-secret-change-me";
const ADMIN_PATH = process.env.ADMIN_PATH || "/";
const ADMIN_PORT = process.env.ADMIN_PORT || "3001";
const ADMIN_2FA_SECRET = String(process.env.ADMIN_2FA_SECRET || "").replace(/\s+/g, "").toUpperCase();
const ADMIN_2FA_REQUIRED = process.env.ADMIN_2FA_REQUIRED === "true" || Boolean(ADMIN_2FA_SECRET);
const ADMIN_HOSTS = (process.env.ADMIN_HOSTS || `localhost:${ADMIN_PORT},127.0.0.1:${ADMIN_PORT}`)
  .split(",")
  .map((host) => host.trim().toLowerCase())
  .filter(Boolean);
const DATABASE_URL = process.env.DATABASE_URL || "";
const MERCADO_PAGO_ACCESS_TOKEN = process.env.MERCADO_PAGO_ACCESS_TOKEN || "";
const pool = DATABASE_URL ? new Pool({ connectionString: DATABASE_URL }) : null;

const heroImages = [
  "https://dcdn-us.mitiendanube.com/stores/004/609/190/themes/lima/2-slide-1790108780606-5262463668-a678aa4f38cd4fb9b47f383e1ffd334e1790108749-1920-1920.webp?6958786256829648182",
  "https://dcdn-us.mitiendanube.com/stores/004/609/190/themes/lima/2-slide-1790108832791-964289113-a678aa4f38cd4fb9b47f383e1ffd334e1790108801-1920-1920.webp?6958786256829648182"
];

const categoryTiles = [
  { title: "Polaroid", href: "#produtos", image: "https://dcdn-us.mitiendanube.com/stores/004/609/190/themes/lima/2-slide-1791437548763-1949893582-49d5996b00ffbb6bbc75ca18a9077da61791437504-240-0.webp?6958786256829648182" },
  { title: "Cartao Google", href: "#produtos", image: "https://dcdn-us.mitiendanube.com/stores/004/609/190/themes/lima/2-slide-1791436357603-4183690577-a29be5b4f016971c121b38eeead706271791436314-240-0.webp?6958786256829648182" },
  { title: "Quadros A4", href: "#produtos", image: "https://dcdn-us.mitiendanube.com/stores/004/609/190/themes/lima/2-slide-1791436357603-8293761929-81ffe1be5dea7514c93de507664f7fdb1791436313-240-0.webp?6958786256829648182" },
  { title: "Hot Wheels", href: "#produtos", image: "https://dcdn-us.mitiendanube.com/stores/004/609/190/themes/lima/2-slide-1791436357603-8323698324-5d84123033c6dcc47b9578be9acdc52f1791436313-240-0.webp?6958786256829648182" }
];

const testimonials = [
  { name: "Allan", text: "Mais de coracao eu agradeco pelo trabalho incrivel, pelo carinho e pelo cuidado com todos os detalhes." },
  { name: "Leticia Costa", text: "Ficou lindo, lindo, lindo. Amei. Como pode uma foto tocar tanto a gente? Obrigada pelo capricho." },
  { name: "Maiara", text: "Eu achei lindo, muito delicado. A pessoa que ganhou chorou. Muito obrigada por esse momento." }
];

const money = (value) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value || 0));

const escapeHtml = (value = "") =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

async function readSeedStore() {
  return JSON.parse(await readFile(DATA_PATH, "utf8"));
}

function normalizeProduct(row) {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    category: row.category,
    price: Number(row.price),
    compareAtPrice: row.compare_at_price === null ? null : Number(row.compare_at_price),
    featured: row.featured,
    image: row.image,
    gallery: row.gallery || [],
    shortDescription: row.short_description,
    description: row.description,
    digitalDeliveryUrl: row.digital_delivery_url || "",
    active: row.active
  };
}

async function initDatabase() {
  if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value JSONB NOT NULL
    );
    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      slug TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      price NUMERIC(10,2) NOT NULL,
      compare_at_price NUMERIC(10,2),
      featured BOOLEAN NOT NULL DEFAULT TRUE,
      image TEXT NOT NULL,
      gallery JSONB NOT NULL DEFAULT '[]'::jsonb,
      short_description TEXT NOT NULL,
      description TEXT NOT NULL,
      digital_delivery_url TEXT,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      customer_name TEXT,
      customer_email TEXT,
      customer_phone TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      items JSONB NOT NULL,
      total NUMERIC(10,2) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      delivery_token TEXT,
      payment_provider TEXT,
      payment_id TEXT,
      payment_payload JSONB
    );
  `);
  await pool.query("ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_token TEXT");
  await pool.query("ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_provider TEXT");
  await pool.query("ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_id TEXT");
  await pool.query("ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_payload JSONB");

  const count = await pool.query("SELECT COUNT(*)::int AS total FROM products");
  if (count.rows[0].total > 0) return;

  const seed = await readSeedStore();
  await pool.query(
    "INSERT INTO settings (key, value) VALUES ($1, $2), ($3, $4), ($5, $6) ON CONFLICT (key) DO NOTHING",
    ["settings", JSON.stringify(seed.settings), "pages", JSON.stringify(seed.pages), "seededAt", JSON.stringify(new Date().toISOString())]
  );
  for (const product of seed.products) {
    await pool.query(
      `INSERT INTO products (id, slug, name, category, price, compare_at_price, featured, image, gallery, short_description, description, digital_delivery_url, active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (id) DO NOTHING`,
      [product.id, product.slug, product.name, product.category, product.price, product.compareAtPrice || null, product.featured !== false, product.image, JSON.stringify(product.gallery || []), product.shortDescription, product.description, product.digitalDeliveryUrl || "", product.active !== false]
    );
  }
}

const dbReady = initDatabase();

async function readStore() {
  if (!pool) return readSeedStore();
  await dbReady;
  const [settingsResult, productsResult, ordersResult] = await Promise.all([
    pool.query("SELECT key, value FROM settings WHERE key IN ('settings', 'pages')"),
    pool.query("SELECT * FROM products ORDER BY created_at ASC"),
    pool.query("SELECT id, customer_name, customer_email, customer_phone, status, items, total, created_at, delivery_token, payment_provider, payment_id, payment_payload FROM orders ORDER BY created_at DESC")
  ]);
  const settingsMap = Object.fromEntries(settingsResult.rows.map((row) => [row.key, row.value]));
  return {
    settings: settingsMap.settings || {},
    products: productsResult.rows.map(normalizeProduct),
    orders: ordersResult.rows.map((row) => ({
      id: row.id,
      customerName: row.customer_name,
      customerEmail: row.customer_email,
      customerPhone: row.customer_phone,
      status: row.status,
      items: row.items || [],
      total: Number(row.total),
      createdAt: row.created_at,
      deliveryToken: row.delivery_token || "",
      paymentProvider: row.payment_provider || "",
      paymentId: row.payment_id || "",
      paymentPayload: row.payment_payload || null
    })),
    pages: settingsMap.pages || {}
  };
}

async function writeStore(store) {
  if (!pool) {
    await writeFile(DATA_PATH, `${JSON.stringify(store, null, 2)}\n`, "utf8");
    return;
  }
  await dbReady;
  await pool.query("INSERT INTO settings (key, value) VALUES ($1, $2), ($3, $4) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", ["settings", JSON.stringify(store.settings), "pages", JSON.stringify(store.pages)]);
  for (const product of store.products) {
    await pool.query(
      `INSERT INTO products (id, slug, name, category, price, compare_at_price, featured, image, gallery, short_description, description, digital_delivery_url, active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (id) DO UPDATE SET slug=EXCLUDED.slug, name=EXCLUDED.name, category=EXCLUDED.category, price=EXCLUDED.price,
       compare_at_price=EXCLUDED.compare_at_price, featured=EXCLUDED.featured, image=EXCLUDED.image, gallery=EXCLUDED.gallery,
       short_description=EXCLUDED.short_description, description=EXCLUDED.description, digital_delivery_url=EXCLUDED.digital_delivery_url,
       active=EXCLUDED.active, updated_at=now()`,
      [product.id, product.slug, product.name, product.category, product.price, product.compareAtPrice || null, product.featured !== false, product.image, JSON.stringify(product.gallery || []), product.shortDescription, product.description, product.digitalDeliveryUrl || "", product.active !== false]
    );
  }
  for (const order of store.orders) {
    await pool.query(
      `INSERT INTO orders (id, customer_name, customer_email, customer_phone, status, items, total, created_at, delivery_token, payment_provider, payment_id, payment_payload)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (id) DO UPDATE SET customer_name=EXCLUDED.customer_name, customer_email=EXCLUDED.customer_email, customer_phone=EXCLUDED.customer_phone, status=EXCLUDED.status, items=EXCLUDED.items, total=EXCLUDED.total, delivery_token=EXCLUDED.delivery_token, payment_provider=EXCLUDED.payment_provider, payment_id=EXCLUDED.payment_id, payment_payload=EXCLUDED.payment_payload`,
      [order.id, order.customerName, order.customerEmail, order.customerPhone, order.status || "pending", JSON.stringify(order.items || []), order.total || 0, order.createdAt || new Date().toISOString(), order.deliveryToken || randomUUID(), order.paymentProvider || "", order.paymentId || "", order.paymentPayload ? JSON.stringify(order.paymentPayload) : null]
    );
  }
}

function parseCookies(request) {
  return Object.fromEntries(String(request.headers.cookie || "").split(";").map((part) => part.trim()).filter(Boolean).map((part) => {
    const index = part.indexOf("=");
    return index === -1 ? [part, ""] : [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
  }));
}

function sign(value) {
  return createHmac("sha256", SESSION_SECRET).update(value).digest("hex");
}

function base32Decode(value = "") {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const char of value.replace(/=+$/g, "")) {
    const index = alphabet.indexOf(char);
    if (index === -1) throw new Error("Invalid base32 secret");
    bits += index.toString(2).padStart(5, "0");
  }
  const bytes = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) {
    bytes.push(parseInt(bits.slice(index, index + 8), 2));
  }
  return Buffer.from(bytes);
}

function hotp(secret, counter) {
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", base32Decode(secret)).update(counterBuffer).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = ((digest[offset] & 0x7f) << 24) | ((digest[offset + 1] & 0xff) << 16) | ((digest[offset + 2] & 0xff) << 8) | (digest[offset + 3] & 0xff);
  return String(binary % 1_000_000).padStart(6, "0");
}

function verifyTotp(token = "", secret = "") {
  const normalized = String(token).replace(/\D/g, "");
  if (!secret || normalized.length !== 6) return false;
  const currentStep = Math.floor(Date.now() / 30_000);
  try {
    for (let offset = -1; offset <= 1; offset += 1) {
      const expected = hotp(secret, currentStep + offset);
      if (timingSafeEqual(Buffer.from(normalized), Buffer.from(expected))) return true;
    }
  } catch {
    return false;
  }
  return false;
}

function createSessionValue() {
  const payload = `admin:${Date.now()}:${randomUUID()}`;
  return `${payload}.${sign(payload)}`;
}

function isValidSession(value = "") {
  const index = value.lastIndexOf(".");
  if (index === -1) return false;
  const payload = value.slice(0, index);
  const signature = value.slice(index + 1);
  const expected = sign(payload);
  try {
    return timingSafeEqual(Buffer.from(signature), Buffer.from(expected)) && payload.startsWith("admin:");
  } catch {
    return false;
  }
}

function isAdmin(request) {
  return isValidSession(parseCookies(request).meu_mimo_session);
}

function requestHost(request) {
  return String(request.headers.host || "").toLowerCase();
}

function isAdminHost(request) {
  return ADMIN_HOSTS.includes(requestHost(request));
}

function publicBaseUrl() {
  return process.env.PUBLIC_STORE_URL || process.env.BASE_URL || "http://localhost:3000";
}

async function createMercadoPagoPixPayment(order) {
  if (!MERCADO_PAGO_ACCESS_TOKEN) return null;
  const response = await fetch("https://api.mercadopago.com/v1/payments", {
    method: "POST",
    headers: {
      authorization: `Bearer ${MERCADO_PAGO_ACCESS_TOKEN}`,
      "content-type": "application/json",
      "x-idempotency-key": order.id
    },
    body: JSON.stringify({
      transaction_amount: Number(order.total.toFixed(2)),
      description: `Pedido ${order.id} - Meu Mimo Digital`,
      payment_method_id: "pix",
      external_reference: order.id,
      notification_url: `${publicBaseUrl().replace(/\/$/g, "")}/api/webhooks/mercado-pago`,
      payer: {
        email: order.customerEmail,
        first_name: String(order.customerName || "Cliente").split(/\s+/)[0],
        last_name: String(order.customerName || "").split(/\s+/).slice(1).join(" ") || undefined
      }
    })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload?.message || payload?.error || "Nao foi possivel criar o pagamento Pix.";
    throw new Error(message);
  }
  return payload;
}

async function getMercadoPagoPayment(paymentId) {
  if (!MERCADO_PAGO_ACCESS_TOKEN || !paymentId) return null;
  const response = await fetch(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(paymentId)}`, {
    headers: { authorization: `Bearer ${MERCADO_PAGO_ACCESS_TOKEN}` }
  });
  if (!response.ok) return null;
  return response.json();
}

function mapMercadoPagoStatus(status) {
  if (status === "approved" || status === "accredited") return "paid";
  if (["cancelled", "rejected", "refunded", "charged_back"].includes(status)) return "canceled";
  return "pending";
}

function setAdminCookie(response) {
  response.setHeader("set-cookie", `meu_mimo_session=${encodeURIComponent(createSessionValue())}; Path=/; HttpOnly; SameSite=Lax; Max-Age=28800`);
}

function clearAdminCookie(response) {
  response.setHeader("set-cookie", "meu_mimo_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0");
}

function requireAdmin(request, response) {
  if (isAdmin(request)) return true;
  json(response, 401, { error: "Login necessario." });
  return false;
}
async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function securityHeaders(type) {
  const headers = {
    "content-type": type,
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "strict-origin-when-cross-origin",
    "permissions-policy": "camera=(), microphone=(), geolocation=()"
  };
  if (type.startsWith("text/html")) {
    headers["content-security-policy"] = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' https: data:; connect-src 'self'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'";
  }
  return headers;
}

function send(response, status, body, type = "text/html; charset=utf-8") {
  response.writeHead(status, securityHeaders(type));
  response.end(body);
}

function json(response, status, body) {
  send(response, status, JSON.stringify(body), "application/json; charset=utf-8");
}


function publicStore(store) {
  return {
    ...store,
    products: store.products.map(({ digitalDeliveryUrl, ...product }) => product)
  };
}
function styles() {
  return `<style>
    @import url('https://fonts.googleapis.com/css2?family=Piazzolla:wght@400;600;700&display=swap');
    :root { color-scheme: light; --bg:#fffaf7; --paper:#ffffff; --ink:#3a282b; --muted:#7c686d; --line:#ead9d4; --rose:#b86978; --rose-dark:#7a3d4a; --soft:#f8ece8; --violet:#8a5b8d; }
    * { box-sizing: border-box; }
    body { margin:0; font-family:'Piazzolla', Georgia, serif; background:var(--bg); color:var(--ink); font-size:15px; }
    a { color:inherit; text-decoration:none; }
    img { max-width:100%; display:block; }
    .topbar { border-bottom:1px solid var(--line); background:#fff; font-size:13px; color:var(--muted); }
    .topbar-inner, .nav, .menu, main, .footer-grid { max-width:1180px; margin:auto; padding-left:20px; padding-right:20px; }
    .topbar-inner { min-height:36px; display:flex; justify-content:flex-end; align-items:center; gap:10px; }
    header { position:sticky; top:0; z-index:5; background:rgba(255,250,247,.96); border-bottom:1px solid var(--line); backdrop-filter:blur(12px); }
    .nav { min-height:78px; display:grid; grid-template-columns:1fr auto 1fr; gap:18px; align-items:center; }
    .search { position:relative; max-width:310px; }
    .search input { width:100%; border:1px solid var(--line); border-radius:999px; padding:12px 42px 12px 16px; background:#fff; font-family:inherit; }
    .search span { position:absolute; right:15px; top:50%; transform:translateY(-50%); color:var(--muted); }
    .brand { text-align:center; font-size:24px; color:var(--rose-dark); font-weight:600; line-height:1.1; }
    .cart-link { justify-self:end; border:1px solid var(--line); border-radius:999px; padding:10px 14px; background:#fff; color:var(--rose-dark); }
    .menu { min-height:44px; display:flex; justify-content:center; align-items:center; gap:28px; color:var(--muted); border-top:1px solid var(--line); }
    .menu a:hover, .brand:hover { color:var(--rose); }
    .hero { max-width:1180px; margin:22px auto 0; padding:0 20px; }
    .hero-frame { min-height:420px; border-radius:8px; overflow:hidden; background:var(--soft); position:relative; display:grid; align-items:end; border:1px solid var(--line); }
    .hero-frame::before { content:""; position:absolute; inset:0; background:linear-gradient(90deg, rgba(58,40,43,.58), rgba(58,40,43,.18), rgba(58,40,43,.04)), var(--hero) center/cover no-repeat; }
    .hero-copy { position:relative; padding:42px; max-width:580px; color:white; text-shadow:0 1px 18px rgba(0,0,0,.25); }
    .eyebrow { text-transform:uppercase; letter-spacing:.12em; font-size:12px; font-weight:700; color:var(--rose); }
    .hero-copy .eyebrow { color:#ffe9ef; }
    h1, h2, h3 { font-weight:400; line-height:1.12; margin:0; }
    h1 { font-size:clamp(38px, 6vw, 64px); }
    h2 { font-size:30px; text-align:center; margin:38px 0 20px; }
    p { line-height:1.65; }
    .btn, button { border:0; background:var(--rose); color:white; padding:12px 18px; border-radius:999px; font-family:inherit; font-weight:700; cursor:pointer; display:inline-flex; align-items:center; justify-content:center; gap:8px; }
    .btn.secondary, .remove-btn { background:#fff; color:var(--rose-dark); border:1px solid var(--line); }
    .category-grid { display:grid; grid-template-columns:repeat(4,1fr); gap:18px; }
    .category-tile { text-align:center; color:var(--rose-dark); }
    .category-tile img { width:100%; aspect-ratio:1/1; object-fit:cover; border-radius:999px; border:1px solid var(--line); background:#fff; }
    .category-tile strong { display:block; margin-top:10px; font-size:17px; }
    .about-band { margin-top:34px; background:#fff; border:1px solid var(--line); border-radius:8px; padding:34px; text-align:center; }
    .about-band p { max-width:850px; margin:14px auto 0; color:var(--muted); }
    .promo-grid { display:grid; grid-template-columns:repeat(3,1fr); gap:18px; margin-top:24px; }
    .promo { min-height:220px; border-radius:8px; border:1px solid var(--line); overflow:hidden; background:var(--soft); position:relative; display:flex; align-items:flex-end; }
    .promo::before { content:""; position:absolute; inset:0; background:linear-gradient(0deg, rgba(58,40,43,.55), rgba(58,40,43,.02)), var(--image) center/cover no-repeat; }
    .promo h3 { position:relative; color:#fff; font-size:25px; padding:24px; text-shadow:0 1px 16px rgba(0,0,0,.25); }
    .grid { display:grid; grid-template-columns:repeat(auto-fit, minmax(230px, 1fr)); gap:22px; }
    .card { background:#fff; border:1px solid var(--line); border-radius:8px; overflow:hidden; transition:transform .16s ease, box-shadow .16s ease; }
    .card:hover { transform:translateY(-2px); box-shadow:0 14px 28px rgba(122,61,74,.08); }
    .card img { width:100%; aspect-ratio:1/1; object-fit:cover; background:#fff; }
    .card-body { padding:18px; }
    .card-body p { color:var(--muted); margin:8px 0; }
    .price { color:var(--rose-dark); font-size:22px; font-weight:700; }
    .old-price { color:var(--muted); text-decoration:line-through; margin-left:8px; font-size:14px; }
    .product-main { display:grid; grid-template-columns:1fr 1fr; gap:34px; padding-top:34px; align-items:start; }
    .product-main img { width:100%; border-radius:8px; aspect-ratio:1/1; object-fit:cover; border:1px solid var(--line); background:#fff; }
    .gallery { display:grid; grid-template-columns:repeat(3,1fr); gap:8px; margin-top:8px; }
    form { display:grid; gap:12px; max-width:640px; }
    input, textarea { width:100%; padding:13px 14px; border-radius:8px; border:1px solid var(--line); font:inherit; background:#fff; }
    textarea { min-height:120px; resize:vertical; }
    .payment-qr { width:220px; max-width:100%; border:1px solid var(--line); border-radius:8px; background:#fff; padding:10px; margin:12px 0; }
    .cart-item { display:grid; grid-template-columns:92px 1fr auto; gap:14px; align-items:center; padding:14px 0; border-bottom:1px solid var(--line); }
    .cart-item img { width:92px; height:92px; object-fit:cover; border-radius:8px; }
    .notice { background:#fff; border:1px solid var(--line); padding:16px; border-radius:8px; margin:16px 0; }
    .error { color:#a32b2b; font-weight:700; }
    .testimonials { display:grid; grid-template-columns:repeat(3,1fr); gap:18px; }
    .quote { background:#fff; border:1px solid var(--line); border-radius:8px; padding:22px; min-height:190px; }
    .quote b { color:var(--rose-dark); }
    .benefits { margin-top:34px; display:grid; grid-template-columns:repeat(3,1fr); gap:14px; }
    .benefit { background:#fff; border:1px solid var(--line); border-radius:8px; padding:20px; text-align:center; }
    .newsletter { margin-top:36px; padding:34px; border-radius:8px; background:var(--soft); text-align:center; }
    .newsletter form { margin:18px auto 0; grid-template-columns:1fr auto; }
    footer { margin-top:44px; border-top:1px solid var(--line); background:#fff; color:var(--muted); }
    .footer-grid { padding-top:34px; padding-bottom:34px; display:grid; grid-template-columns:1.3fr 1fr 1fr; gap:24px; }
    .footer-grid h3 { color:var(--rose-dark); font-size:20px; margin-bottom:10px; }
    .copyright { text-align:center; border-top:1px solid var(--line); padding:16px; font-size:13px; }
    .admin-page { max-width:1240px; }
    .admin-hero { margin-top:28px; display:flex; justify-content:space-between; gap:18px; align-items:center; background:#fff; border:1px solid var(--line); border-radius:8px; padding:28px; }
    .admin-hero h1 { font-size:40px; }
    .admin-hero p { margin:10px 0 0; color:var(--muted); }
    .admin-workspace { display:grid; grid-template-columns:minmax(0, 1.35fr) 360px; gap:22px; margin-top:22px; align-items:start; }
    .admin-wizard { max-width:none; display:grid; gap:16px; }
    .wizard-block { position:relative; display:grid; gap:12px; background:#fff; border:1px solid var(--line); border-radius:8px; padding:22px 22px 22px 72px; }
    .wizard-block h2 { text-align:left; margin:0; font-size:24px; }
    .wizard-block p { margin:4px 0 0; color:var(--muted); }
    .wizard-block label { display:grid; gap:7px; color:var(--rose-dark); font-weight:700; }
    .step-badge { position:absolute; left:22px; top:22px; width:34px; height:34px; border-radius:999px; display:grid; place-items:center; background:var(--rose); color:#fff; font-weight:700; }
    .toggle-grid { display:grid; grid-template-columns:repeat(2, minmax(0, 1fr)); gap:12px; }
    .toggle-card { border:1px solid var(--line); border-radius:8px; padding:14px; background:var(--bg); color:var(--ink) !important; }
    .toggle-card input { width:auto; margin-right:8px; }
    .toggle-card span { font-weight:700; color:var(--rose-dark); }
    .toggle-card small { display:block; margin-top:6px; color:var(--muted); font-weight:400; }
    .preview-panel { position:relative; }
    .sticky-preview { position:sticky; top:150px; display:grid; gap:12px; }
    .preview-card { box-shadow:0 18px 38px rgba(122,61,74,.10); }
    .preview-image { aspect-ratio:1/1; display:grid; place-items:center; background:var(--soft); color:var(--muted); border-bottom:1px solid var(--line); background-size:cover; background-position:center; }
    .admin-tip { background:#fff; border:1px solid var(--line); border-radius:8px; padding:14px; color:var(--muted); }
    .admin-product-grid { display:grid; grid-template-columns:repeat(auto-fit, minmax(220px, 1fr)); gap:16px; }
    .admin-product-card { background:#fff; border:1px solid var(--line); border-radius:8px; overflow:hidden; }
    .admin-product-card img { width:100%; aspect-ratio:1/1; object-fit:cover; background:var(--soft); }
    .admin-product-card-body { padding:14px; }
    .admin-product-card h3 { font-size:20px; margin:8px 0; }
    .admin-product-card p { margin:6px 0; color:var(--rose-dark); }
    .admin-product-card p span { color:var(--muted); text-decoration:line-through; }
    .admin-product-card small { color:var(--muted); }
    .pill { display:inline-flex; border:1px solid var(--line); border-radius:999px; padding:4px 9px; color:var(--muted); font-size:12px; }
    .admin-product-card.is-muted { opacity:.58; }    .admin-login-card { max-width:460px; margin:24px auto 0; background:#fff; border:1px solid var(--line); border-radius:8px; padding:24px; }
    .admin-login-card label { display:grid; gap:7px; color:var(--rose-dark); font-weight:700; }
    .admin-actions { display:flex; gap:10px; flex-wrap:wrap; }
    .edit-box { margin-top:12px; border-top:1px solid var(--line); padding-top:10px; }
    .edit-box summary { cursor:pointer; color:var(--rose-dark); font-weight:700; }
    .product-edit-form { margin-top:12px; max-width:none; }
    .admin-list { display:grid; gap:14px; }
    .order-card { display:grid; grid-template-columns:1fr auto; gap:16px; align-items:center; background:#fff; border:1px solid var(--line); border-radius:8px; padding:18px; }
    .order-card h3 { margin:8px 0; }
    .order-card p { margin:4px 0; color:var(--muted); }
    .order-status-form { display:flex; gap:10px; align-items:center; max-width:none; }
    select { padding:12px 14px; border-radius:8px; border:1px solid var(--line); background:#fff; font:inherit; }    @media (max-width:820px) { .topbar { display:none; } .nav { grid-template-columns:auto auto; } .search { grid-column:1 / -1; max-width:none; order:3; } .brand { text-align:left; font-size:20px; } .menu { overflow:auto; justify-content:flex-start; gap:18px; } .hero-frame { min-height:330px; } .hero-copy { padding:28px; } .category-grid, .promo-grid, .testimonials, .benefits, .footer-grid, .product-main, .admin-workspace, .form-grid.two, .form-grid.three, .toggle-grid { grid-template-columns:1fr; } .admin-hero { align-items:flex-start; flex-direction:column; } .order-card, .order-status-form { grid-template-columns:1fr; flex-direction:column; align-items:stretch; } .wizard-block { padding-left:22px; padding-top:68px; } .sticky-preview { position:static; } .newsletter form { grid-template-columns:1fr; } .cart-item { grid-template-columns:72px 1fr; } .cart-item button { grid-column:1 / -1; } }
  </style>`;
}

function layout(store, title, content, options = {}) {
  const whatsapp = store.settings.whatsapp || "551134683618";
  const currentAdminPath = options.adminPath || ADMIN_PATH;
  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} | ${escapeHtml(store.settings.storeName)}</title>
  ${styles()}
</head>
<body data-admin-path="${escapeHtml(currentAdminPath)}">
  <div class="topbar"><div class="topbar-inner"><span>Arquivos digitais personalizados para presentear com carinho.</span></div></div>
  <header>
    <nav class="nav">
      <form class="search" action="/" method="get"><input name="q" placeholder="O que voce esta buscando?"><span>Buscar</span></form>
      <a class="brand" href="/">${escapeHtml(store.settings.storeName)}</a>
      <a class="cart-link" href="/cart">Carrinho (<span id="cart-count">0</span>)</a>
    </nav>
    <div class="menu">
      <a href="/">Inicio</a>
      <a href="/#produtos">Produtos</a>
      <a href="/#sobre">Quem Somos</a>
      <a href="/#faq">Perguntas Frequentes</a>
      <a href="https://wa.me/${escapeHtml(whatsapp)}">Contato</a>
    </div>
  </header>
  ${content}
  <footer>
    <div class="footer-grid">
      <div><h3>${escapeHtml(store.settings.storeName)}</h3><p>${escapeHtml(store.pages.about)}</p></div>
      <div><h3>Departamentos</h3><p><a href="/">Inicio</a></p><p><a href="/#produtos">Produtos</a></p><p><a href="/#faq">Perguntas frequentes</a></p></div>
      <div><h3>Entre em contato</h3><p><a href="https://wa.me/${escapeHtml(whatsapp)}">${escapeHtml(whatsapp)}</a></p><p>${escapeHtml(store.settings.email)}</p><p>${escapeHtml(store.settings.city)}</p></div>
    </div>
    <div class="copyright">Copyright Meu Mimo Digital - 2026. Todos os direitos reservados.</div>
  </footer>
  <script src="/app.js"></script>
</body>
</html>`;
}

function productCard(product) {
  return `<article class="card">
    <a href="/produto/${escapeHtml(product.slug)}"><img src="${escapeHtml(product.image)}" alt="${escapeHtml(product.name)}"></a>
    <div class="card-body">
      <p>${escapeHtml(product.category)}</p>
      <h3><a href="/produto/${escapeHtml(product.slug)}">${escapeHtml(product.name)}</a></h3>
      <p>${escapeHtml(product.shortDescription)}</p>
      <p><span class="price">${money(product.price)}</span>${product.compareAtPrice ? `<span class="old-price">${money(product.compareAtPrice)}</span>` : ""}</p>
      <button data-add-cart="${escapeHtml(product.id)}">Adicionar ao carrinho</button>
    </div>
  </article>`;
}

function homePage(store) {
  const products = store.products.filter((product) => product.active !== false);
  const promoProducts = products.slice(0, 3);
  return layout(store, "Arquivos digitais personalizados", `
    <section class="hero">
      <div class="hero-frame" style="--hero:url('${heroImages[0]}')">
        <div class="hero-copy">
          <div class="eyebrow">Arquivos digitais personalizados</div>
          <h1>Memorias especiais merecem um mimo especial.</h1>
          <p>${escapeHtml(store.settings.tagline)}</p>
          <a class="btn" href="#produtos">Ver produtos</a>
        </div>
      </div>
    </section>
    <main>
      <h2>Qual mimo de hoje?</h2>
      <div class="category-grid">${categoryTiles.map((item) => `<a class="category-tile" href="${item.href}"><img src="${item.image}" alt="${escapeHtml(item.title)}"><strong>${escapeHtml(item.title)}</strong></a>`).join("")}</div>
      <section id="sobre" class="about-band">
        <span class="eyebrow">Meu Mimo Digital</span>
        <h2>Presentes digitais para transformar detalhes em lembrancas.</h2>
        <p>${escapeHtml(store.pages.about)}</p>
      </section>
      <div class="promo-grid">${promoProducts.map((product, index) => `<a class="promo" href="/produto/${escapeHtml(product.slug)}" style="--image:url('${escapeHtml(index === 0 ? heroImages[1] : product.image)}')"><h3>${index === 0 ? "Lancamento!" : index === 1 ? "O queridinho do momento!" : "Quadro - Sorte no Amor!"}</h3></a>`).join("")}</div>
      <section id="produtos">
        <h2>Produtos</h2>
        <div class="grid">${products.map(productCard).join("")}</div>
      </section>
      <section>
        <h2>Feedback que a gente ama</h2>
        <div class="testimonials">${testimonials.map((item) => `<article class="quote"><p>"${escapeHtml(item.text)}"</p><b>${escapeHtml(item.name)}</b></article>`).join("")}</div>
      </section>
      <section id="faq" class="benefits">
        <a class="benefit" href="https://wa.me/${escapeHtml(store.settings.whatsapp)}"><h3>Possui alguma duvida?</h3><p>Chama no WhatsApp.</p></a>
        <div class="benefit"><h3>Pague com Pix</h3><p>E ganhe desconto de ${escapeHtml(store.settings.pixDiscountPercent)}%</p></div>
        <div class="benefit"><h3>Entrega digital</h3><p>Receba o arquivo para personalizar online.</p></div>
      </section>
      <section class="newsletter">
        <h2>Receba todas as promocoes</h2>
        <p>Cadastre seu e-mail para acompanhar novos mimos e ofertas.</p>
        <form><input type="email" placeholder="E-mail"><button type="button">Enviar</button></form>
      </section>
    </main>`);
}

function productPage(store, slug) {
  const product = store.products.find((entry) => entry.slug === slug && entry.active !== false);
  if (!product) return null;
  const gallery = [product.image, ...(product.gallery || [])].filter(Boolean);
  return layout(store, product.name, `
    <main class="product-main">
      <section>
        <img src="${escapeHtml(product.image)}" alt="${escapeHtml(product.name)}">
        <div class="gallery">${gallery.slice(1, 4).map((image) => `<img src="${escapeHtml(image)}" alt="${escapeHtml(product.name)}">`).join("")}</div>
      </section>
      <section>
        <p class="eyebrow">${escapeHtml(product.category)}</p>
        <h1>${escapeHtml(product.name)}</h1>
        <p><span class="price">${money(product.price)}</span>${product.compareAtPrice ? `<span class="old-price">${money(product.compareAtPrice)}</span>` : ""}</p>
        <p>${escapeHtml(product.description)}</p>
        <button data-add-cart="${escapeHtml(product.id)}">Adicionar ao carrinho</button>
      </section>
    </main>`);
}

function deliveryPage(store, orderId, token) {
  const order = store.orders.find((entry) => entry.id === orderId && entry.deliveryToken === token);
  if (!order) return layout(store, "Entrega nao encontrada", "<main><h1>Entrega nao encontrada</h1><p>Confira o link recebido.</p></main>");
  if (!["paid", "delivered"].includes(order.status)) {
    return layout(store, "Pedido pendente", `<main><h1>Pedido ainda pendente</h1><p>Assim que o pagamento for confirmado, os links digitais aparecem aqui.</p><p><strong>Pedido:</strong> ${escapeHtml(order.id)}</p></main>`);
  }
  const links = (order.items || []).map((item) => {
    const product = store.products.find((entry) => entry.id === item.productId);
    return `<article class="notice"><h3>${escapeHtml(item.name)}</h3>${product?.digitalDeliveryUrl ? `<a class="btn" href="${escapeHtml(product.digitalDeliveryUrl)}" target="_blank">Abrir arquivo digital</a>` : "<p>Link de entrega nao configurado.</p>"}</article>`;
  }).join("");
  return layout(store, "Entrega digital", `<main><h1>Seus arquivos digitais</h1><p>Pedido ${escapeHtml(order.id)} confirmado.</p>${links}</main>`);
}
function cartPage(store) {
  return layout(store, "Carrinho", `
    <main>
      <h1>Carrinho</h1>
      <section id="cart-items" class="notice"></section>
      <h2>Total: <span id="cart-total">R$ 0,00</span></h2>
      <form id="checkout-form">
        <h2>Finalizar pedido</h2>
        <input name="customerName" placeholder="Nome completo" required>
        <input name="customerEmail" type="email" placeholder="E-mail" required>
        <input name="customerPhone" placeholder="WhatsApp" required>
        <button type="submit">Criar pedido Pix</button>
      </form>
      <section id="checkout-result" class="notice"></section>
    </main>`);
}

function adminLoginPage(store) {
  return layout(store, "Acesso interno", `
    <main class="admin-page">
      <section class="admin-hero">
        <div>
          <span class="eyebrow">Painel da loja</span>
          <h1>Acesso interno</h1>
          <p>Acesse para cadastrar itens, editar produtos e acompanhar pedidos.</p>
        </div>
      </section>
      <form id="admin-login-form" class="admin-login-card">
        <label>E-mail<input name="adminEmail" type="email" value="${escapeHtml(process.env.ADMIN_EMAIL || "")}" required></label>
        <label>Senha<input name="adminPassword" type="password" placeholder="Senha do painel" required></label>
        ${ADMIN_2FA_REQUIRED ? `<label>Codigo 2FA<input name="otpCode" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" placeholder="000000" required></label>` : ""}
        <button type="submit">Entrar</button>
      </form>
    </main>`);
}
function adminPage(store) {
  const statusLabel = { pending: "Pendente", paid: "Pago", delivered: "Entregue", canceled: "Cancelado" };
  const productRows = store.products.map((product) => `
    <article class="admin-product-card ${product.active === false ? "is-muted" : ""}">
      <img src="${escapeHtml(product.image)}" alt="${escapeHtml(product.name)}">
      <div class="admin-product-card-body">
        <span class="pill">${escapeHtml(product.category)}</span>
        <h3>${escapeHtml(product.name)}</h3>
        <p><strong>${money(product.price)}</strong>${product.compareAtPrice ? ` <span>${money(product.compareAtPrice)}</span>` : ""}</p>
        <small>${product.active === false ? "Oculto da loja" : "Publicado"}${product.featured ? " - destaque" : ""}</small>
        <details class="edit-box">
          <summary>Editar item</summary>
          <form class="product-edit-form" data-product-id="${escapeHtml(product.id)}">
            <label>Nome<input name="name" value="${escapeHtml(product.name)}" required></label>
            <label>Categoria<input name="category" value="${escapeHtml(product.category)}" required></label>
            <div class="form-grid two">
              <label>Preco<input name="price" type="number" min="0" step="0.01" value="${escapeHtml(product.price)}" required></label>
              <label>Preco antigo<input name="compareAtPrice" type="number" min="0" step="0.01" value="${escapeHtml(product.compareAtPrice || "")}"></label>
            </div>
            <label>Imagem<input name="image" value="${escapeHtml(product.image)}" required></label>
            <label>Descricao curta<textarea name="shortDescription" required>${escapeHtml(product.shortDescription)}</textarea></label>
            <label>Descricao completa<textarea name="description" required>${escapeHtml(product.description)}</textarea></label>
            <label>Link entrega<input name="digitalDeliveryUrl" value="${escapeHtml(product.digitalDeliveryUrl || "")}"></label>
            <div class="toggle-grid">
              <label class="toggle-card"><input type="checkbox" name="featured" ${product.featured ? "checked" : ""}><span>Destaque</span></label>
              <label class="toggle-card"><input type="checkbox" name="active" ${product.active !== false ? "checked" : ""}><span>Publicado</span></label>
            </div>
            <button type="submit">Salvar alteracoes</button>
            <button type="button" class="btn secondary" data-hide-product="${escapeHtml(product.id)}">Ocultar item</button>
          </form>
        </details>
      </div>
    </article>
  `).join("");

  const orderRows = store.orders.map((order) => {
    const deliveryUrl = `/entrega/${encodeURIComponent(order.id)}/${encodeURIComponent(order.deliveryToken || "")}`;
    return `<article class="order-card">
      <div>
        <span class="pill">${statusLabel[order.status] || order.status}</span>
        <h3>${escapeHtml(order.id)}</h3>
        <p>${escapeHtml(order.customerName || "Cliente")} - ${escapeHtml(order.customerEmail || "sem e-mail")}</p>
        <p><strong>${money(order.total)}</strong></p>
        ${order.paymentId ? `<p>Pagamento: ${escapeHtml(order.paymentProvider || "gateway")} #${escapeHtml(order.paymentId)}</p>` : ""}
        <small>${(order.items || []).map((item) => `${escapeHtml(item.name)} x${item.quantity}`).join(" | ")}</small>
      </div>
      <form class="order-status-form" data-order-id="${escapeHtml(order.id)}">
        <select name="status">
          ${["pending", "paid", "delivered", "canceled"].map((status) => `<option value="${status}" ${order.status === status ? "selected" : ""}>${statusLabel[status]}</option>`).join("")}
        </select>
        <button type="submit">Atualizar</button>
        ${order.deliveryToken ? `<a class="btn secondary" href="${deliveryUrl}" target="_blank">Ver entrega</a>` : ""}
      </form>
    </article>`;
  }).join("");

  return layout(store, "Operacao", `
    <main class="admin-page">
      <section class="admin-hero">
        <div>
          <span class="eyebrow">Painel da loja</span>
          <h1>Gestao da Meu Mimo</h1>
          <p>Cadastre, edite e acompanhe itens e pedidos sem mexer em codigo.</p>
        </div>
        <div class="admin-actions"><a class="btn secondary" href="${escapeHtml(publicBaseUrl())}">Voltar para loja</a><a class="btn secondary" href="${escapeHtml(publicBaseUrl())}" target="_blank">Abrir loja em nova aba</a><button type="button" id="logout-admin">Sair</button></div>
      </section>

      <section class="admin-workspace">
        <form id="product-form" class="admin-wizard">
          <div class="wizard-block">
            <div class="step-badge">1</div>
            <div><h2>Novo item</h2><p>Preencha os dados principais do mimo digital.</p></div>
            <label>Nome do item<input name="name" data-preview="name" placeholder="Ex: Molde - Tirinha de Fotos" required></label>
            <div class="form-grid two"><label>Categoria<input name="category" data-preview="category" placeholder="Ex: Polaroid" required></label><label>Link curto opcional<input name="slug" placeholder="ex: molde-polaroid"></label></div>
            <div class="form-grid two"><label>Preco de venda<input name="price" data-preview="price" type="number" min="0" step="0.01" placeholder="4,99" required></label><label>Preco antigo<input name="compareAtPrice" data-preview="compareAtPrice" type="number" min="0" step="0.01" placeholder="29,90"></label></div>
          </div>
          <div class="wizard-block">
            <div class="step-badge">2</div>
            <div><h2>Imagem e entrega</h2><p>Envie uma imagem ou cole um link.</p></div>
            <label>Enviar imagem<input type="file" id="product-image-file" accept="image/*"></label>
            <label>Imagem principal<input name="image" data-preview="image" placeholder="https://... ou /uploads/..." required></label>
            <label>Galeria opcional<textarea name="gallery" placeholder="Cole uma URL por linha"></textarea></label>
            <label>Link de entrega digital<input name="digitalDeliveryUrl" placeholder="Canva, Drive ou link do arquivo"></label>
          </div>
          <div class="wizard-block">
            <div class="step-badge">3</div>
            <div><h2>Textos e publicacao</h2><p>Finalize a descricao e publique.</p></div>
            <label>Descricao curta<textarea name="shortDescription" data-preview="shortDescription" placeholder="Texto pequeno que aparece no card" required></textarea></label>
            <label>Descricao completa<textarea name="description" placeholder="Texto maior da pagina do produto" required></textarea></label>
            <div class="toggle-grid"><label class="toggle-card"><input type="checkbox" name="featured" checked><span>Mostrar como destaque</span></label><label class="toggle-card"><input type="checkbox" name="active" checked><span>Publicar na loja</span></label></div>
            <button type="submit">Cadastrar item</button>
          </div>
        </form>
        <aside class="preview-panel"><div class="sticky-preview"><span class="eyebrow">Previa do cliente</span><article class="card preview-card"><div class="preview-image" id="preview-image">Imagem</div><div class="card-body"><p id="preview-category">Categoria</p><h3 id="preview-name">Nome do item</h3><p id="preview-description">Descricao curta do mimo digital.</p><p><span class="price" id="preview-price">R$ 0,00</span><span class="old-price" id="preview-old-price"></span></p><button type="button">Adicionar ao carrinho</button></div></article><div class="admin-tip"><strong>Dica:</strong> se a imagem aparecer na previa, ela tambem aparece na loja.</div></div></aside>
      </section>

      <section><h2>Pedidos</h2><div class="admin-list">${orderRows || "<p class='notice'>Nenhum pedido ainda.</p>"}</div></section>
      <section><h2>Itens cadastrados</h2><div class="admin-product-grid">${productRows || "<p>Nenhum item cadastrado ainda.</p>"}</div></section>
    </main>`);
}
function createSlug(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function calculateOrder(store, cart) {
  const items = cart.map((item) => {
    const product = store.products.find((entry) => entry.id === item.id && entry.active !== false);
    if (!product) return null;
    const quantity = Math.max(1, Number(item.quantity || 1));
    return { productId: product.id, name: product.name, quantity, unitPrice: product.price, total: product.price * quantity };
  }).filter(Boolean);
  return { items, total: items.reduce((sum, item) => sum + item.total, 0) };
}

async function handleApi(request, response, pathname) {
  const store = await readStore();
  if (request.method === "GET" && pathname === "/api/store") return json(response, 200, publicStore(store));

  if ((pathname.startsWith("/api/internal/") || pathname.startsWith("/api/admin/")) && !isAdminHost(request)) return json(response, 404, { error: "Rota nao encontrada." });

  if (request.method === "POST" && pathname === "/api/internal/login") {
    const body = await readBody(request);
    if (body.adminEmail !== process.env.ADMIN_EMAIL || body.adminPassword !== process.env.ADMIN_PASSWORD) {
      return json(response, 401, { error: "Credenciais invalidas." });
    }
    if (ADMIN_2FA_REQUIRED && !verifyTotp(body.otpCode, ADMIN_2FA_SECRET)) {
      return json(response, 401, { error: "Codigo 2FA invalido." });
    }
    setAdminCookie(response);
    return json(response, 200, { ok: true });
  }

  if (request.method === "POST" && pathname === "/api/internal/logout") {
    clearAdminCookie(response);
    return json(response, 200, { ok: true });
  }

  if (request.method === "POST" && pathname === "/api/orders") {
    const body = await readBody(request);
    const orderCalc = calculateOrder(store, body.cart || []);
    if (!orderCalc.items.length) return json(response, 400, { error: "Carrinho vazio ou produtos invalidos." });
    const order = { id: `MM-${Date.now()}`, customerName: body.customerName, customerEmail: body.customerEmail, customerPhone: body.customerPhone, status: "pending", deliveryToken: randomUUID(), createdAt: new Date().toISOString(), ...orderCalc };
    let mercadoPagoPayment = null;
    try {
      mercadoPagoPayment = await createMercadoPagoPixPayment(order);
    } catch (error) {
      return json(response, 502, { error: `Mercado Pago: ${error.message}` });
    }
    if (mercadoPagoPayment) {
      order.paymentProvider = "mercado-pago";
      order.paymentId = String(mercadoPagoPayment.id || "");
      order.paymentPayload = mercadoPagoPayment;
    }
    store.orders.push(order);
    await writeStore(store);
    const transactionData = mercadoPagoPayment?.point_of_interaction?.transaction_data || {};
    return json(response, 201, {
      order: { ...order, deliveryToken: undefined, paymentPayload: undefined },
      payment: mercadoPagoPayment ? {
        provider: "mercado-pago",
        message: "Pedido criado. Pague com Pix para liberar a entrega digital.",
        pixCopyPaste: transactionData.qr_code || "",
        qrCodeBase64: transactionData.qr_code_base64 || "",
        ticketUrl: transactionData.ticket_url || "",
        paymentId: order.paymentId
      } : {
        provider: "mvp",
        message: "Pedido criado. Pagamento real entra depois; por enquanto a equipe confirma o status internamente.",
        pixCopyPaste: `MEUMIMO-MVP-${order.id}-${order.total.toFixed(2)}`
      }
    });
  }

  if (pathname.startsWith("/api/admin/")) return json(response, 404, { error: "Rota nao encontrada." });
  if (pathname.startsWith("/api/internal/") && !requireAdmin(request, response)) return;

  if (request.method === "POST" && pathname === "/api/internal/uploads") {
    const body = await readBody(request);
    const match = String(body.dataUrl || "").match(/^data:(image\/(png|jpeg|jpg|webp|gif));base64,(.+)$/);
    if (!match) return json(response, 400, { error: "Imagem invalida." });
    await mkdir(UPLOAD_DIR, { recursive: true });
    const ext = match[2] === "jpeg" ? "jpg" : match[2];
    const fileName = `${Date.now()}-${randomUUID().slice(0, 8)}.${ext}`;
    await writeFile(join(UPLOAD_DIR, fileName), Buffer.from(match[3], "base64"));
    return json(response, 201, { url: `/uploads/${fileName}` });
  }

  if (request.method === "POST" && pathname === "/api/internal/products") {
    const body = await readBody(request);
    const product = { id: `prod_${randomUUID().slice(0, 8)}`, slug: createSlug(body.slug || body.name), name: body.name, category: body.category, price: Number(body.price), compareAtPrice: body.compareAtPrice ? Number(body.compareAtPrice) : null, featured: body.featured === "on" || body.featured === true, image: body.image, gallery: String(body.gallery || "").split(/\r?\n/).map((url) => url.trim()).filter(Boolean), shortDescription: body.shortDescription, description: body.description, digitalDeliveryUrl: body.digitalDeliveryUrl || "", active: body.active === "on" || body.active === true };
    store.products.push(product);
    await writeStore(store);
    return json(response, 201, { product });
  }

  const productUpdate = pathname.match(/^\/api\/internal\/products\/([^/]+)$/);
  if (request.method === "POST" && productUpdate) {
    const product = store.products.find((entry) => entry.id === decodeURIComponent(productUpdate[1]));
    if (!product) return json(response, 404, { error: "Produto nao encontrado." });
    const body = await readBody(request);
    product.name = body.name || product.name;
    product.category = body.category || product.category;
    product.price = Number(body.price || product.price);
    product.compareAtPrice = body.compareAtPrice ? Number(body.compareAtPrice) : null;
    product.image = body.image || product.image;
    product.shortDescription = body.shortDescription || product.shortDescription;
    product.description = body.description || product.description;
    product.digitalDeliveryUrl = body.digitalDeliveryUrl || "";
    product.featured = body.featured === "on" || body.featured === true;
    product.active = body.active === "on" || body.active === true;
    await writeStore(store);
    return json(response, 200, { product });
  }

  const productHide = pathname.match(/^\/api\/internal\/products\/([^/]+)\/hide$/);
  if (request.method === "POST" && productHide) {
    const product = store.products.find((entry) => entry.id === decodeURIComponent(productHide[1]));
    if (!product) return json(response, 404, { error: "Produto nao encontrado." });
    product.active = false;
    await writeStore(store);
    return json(response, 200, { product });
  }

  const orderStatus = pathname.match(/^\/api\/internal\/orders\/([^/]+)\/status$/);
  if (request.method === "POST" && orderStatus) {
    const order = store.orders.find((entry) => entry.id === decodeURIComponent(orderStatus[1]));
    if (!order) return json(response, 404, { error: "Pedido nao encontrado." });
    const body = await readBody(request);
    if (!["pending", "paid", "delivered", "canceled"].includes(body.status)) return json(response, 400, { error: "Status invalido." });
    order.status = body.status;
    order.deliveryToken = order.deliveryToken || randomUUID();
    await writeStore(store);
    return json(response, 200, { order });
  }

  if (request.method === "POST" && pathname === "/api/webhooks/mercado-pago") {
    const body = await readBody(request);
    const paymentId = body?.data?.id || body?.id || new URL(request.url, `http://${request.headers.host}`).searchParams.get("data.id");
    const payment = await getMercadoPagoPayment(paymentId);
    const orderId = payment?.external_reference;
    if (payment && orderId) {
      const order = store.orders.find((entry) => entry.id === orderId);
      if (order) {
        order.status = mapMercadoPagoStatus(payment.status);
        order.paymentProvider = "mercado-pago";
        order.paymentId = String(payment.id || paymentId || "");
        order.paymentPayload = payment;
        order.deliveryToken = order.deliveryToken || randomUUID();
        await writeStore(store);
      }
    }
    return json(response, 200, { received: true });
  }
  return json(response, 404, { error: "Rota nao encontrada." });
}
async function handleRequest(request, response) {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);
    if (url.pathname === "/health") return json(response, 200, { ok: true });
    if (url.pathname.startsWith("/api/")) return handleApi(request, response, url.pathname);
    if (url.pathname === "/app.js") return send(response, 200, await readFile(join(process.cwd(), "src", "app.js"), "utf8"), "application/javascript; charset=utf-8");
    if (url.pathname.startsWith("/uploads/")) {
      const fileName = decodeURIComponent(url.pathname.replace("/uploads/", "")).replace(/[^a-zA-Z0-9._-]/g, "");
      const ext = fileName.split(".").pop()?.toLowerCase();
      const type = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : ext === "gif" ? "image/gif" : "image/jpeg";
      return send(response, 200, await readFile(join(UPLOAD_DIR, fileName)), type);
    }
    const store = await readStore();
    if (isAdminHost(request)) {
      if (url.pathname === "/" || url.pathname === ADMIN_PATH) return send(response, 200, isAdmin(request) ? adminPage(store) : adminLoginPage(store));
      return send(response, 404, layout(store, "Nao encontrado", "<main><h1>Pagina nao encontrada</h1></main>"));
    }
    if (url.pathname === "/") return send(response, 200, homePage(store));
    if (url.pathname === "/cart") return send(response, 200, cartPage(store));
    if (url.pathname === "/admin") return send(response, 404, layout(store, "Nao encontrado", "<main><h1>Pagina nao encontrada</h1></main>"));
    if (url.pathname === ADMIN_PATH) return send(response, 404, layout(store, "Nao encontrado", "<main><h1>Pagina nao encontrada</h1></main>"));
    if (url.pathname.startsWith("/entrega/")) {
      const [, , orderId, token] = url.pathname.split("/");
      return send(response, 200, deliveryPage(store, decodeURIComponent(orderId || ""), decodeURIComponent(token || "")));
    }
    if (url.pathname.startsWith("/produto/")) {
      const page = productPage(store, decodeURIComponent(url.pathname.replace("/produto/", "")));
      return page ? send(response, 200, page) : send(response, 404, layout(store, "Nao encontrado", "<main><h1>Produto nao encontrado</h1></main>"));
    }
    return send(response, 404, layout(store, "Nao encontrado", "<main><h1>Pagina nao encontrada</h1></main>"));
  } catch (error) {
    console.error(error);
    return json(response, 500, { error: "Erro interno no servidor." });
  }
}

createServer(handleRequest).listen(PORT, HOST, () => {
  console.log(`Meu Mimo MVP rodando em http://${HOST}:${PORT}`);
});






















