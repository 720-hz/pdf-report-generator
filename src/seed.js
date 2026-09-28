// Stage 1: data worth reporting on — "the little shop."
//
// Idempotent by design: running this twice leaves you with exactly one
// clean copy of the data, never two. It deletes every row first (in
// dependency order), then re-inserts from the same seeded RNG, so the
// dataset is also deterministic run to run — useful when you want a
// report's numbers to be reproducible while you're building the PDF layout.
const db = require("./db");

// mulberry32 — tiny seeded PRNG so re-seeding produces identical data.
function mulberry32(seed) {
  let a = seed;
  return function rand() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20260928);
const randInt = (min, max) => Math.floor(rand() * (max - min + 1)) + min;
const pick = (arr) => arr[randInt(0, arr.length - 1)];

const FIRST_NAMES = [
  "Ava", "Liam", "Noor", "Kenji", "Zara", "Mateo", "Priya", "Owen",
  "Layla", "Finn", "Amara", "Theo", "Nina", "Jonas", "Sofia", "Eli",
  "Mira", "Leo", "Yara", "Arjun", "Ines", "Oscar", "Tessa", "Malik",
  "Freya", "Ravi", "Elena", "Sam", "Dara", "Kofi",
];
const LAST_NAMES = [
  "Nakamura", "Osei", "Larsson", "Ferreira", "Khan", "Novak", "Mercer",
  "Alvarez", "Petrov", "Singh", "Dubois", "Haas", "Rossi", "Adeyemi",
  "Kowalski",
];

const PRODUCTS = [
  { name: "Wool Desk Mat", category: "Office", price_cents: 3400 },
  { name: "Ceramic Pour-Over Kettle", category: "Kitchen", price_cents: 5200 },
  { name: "Brass Desk Lamp", category: "Office", price_cents: 8900 },
  { name: "Canvas Field Tote", category: "Outdoors", price_cents: 4600 },
  { name: "Enamel Camp Mug", category: "Outdoors", price_cents: 1800 },
  { name: "Fountain Pen, Fine Nib", category: "Stationery", price_cents: 2600 },
  { name: "Dot-Grid Notebook", category: "Stationery", price_cents: 1400 },
  { name: "Cast Iron Trivet", category: "Kitchen", price_cents: 2200 },
  { name: "Linen Tea Towel Set", category: "Kitchen", price_cents: 2400 },
  { name: "Walnut Pen Tray", category: "Office", price_cents: 3800 },
  { name: "Merino Throw Blanket", category: "Home", price_cents: 9800 },
  { name: "Soy Candle, Cedar", category: "Home", price_cents: 2800 },
  { name: "Recycled Steel Water Bottle", category: "Outdoors", price_cents: 3200 },
  { name: "Leather Cable Roll", category: "Office", price_cents: 2000 },
  { name: "Stoneware Mug", category: "Kitchen", price_cents: 1900 },
];

const CUSTOMER_COUNT = 32;
const DAYS_OF_HISTORY = 60;
const ORDERS_PER_DAY_RANGE = [3, 11];
const STATUS_WEIGHTS = [
  ["completed", 20],
  ["completed", 20],
  ["completed", 20],
  ["completed", 20],
  ["refunded", 2],
  ["cancelled", 3],
];
function weightedStatus() {
  const total = STATUS_WEIGHTS.reduce((s, [, w]) => s + w, 0);
  let r = rand() * total;
  for (const [status, w] of STATUS_WEIGHTS) {
    if (r < w) return status;
    r -= w;
  }
  return "completed";
}

function isoDaysAgo(daysAgo, hour, minute) {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - daysAgo);
  d.setUTCHours(hour, minute, 0, 0);
  return d.toISOString();
}

function seed() {
  console.log(`Seeding ${db === null ? "" : ""}shop.db ...`);

  // Delete-first: makes this script safe to re-run any number of times.
  db.exec("DELETE FROM order_items;");
  db.exec("DELETE FROM orders;");
  db.exec("DELETE FROM products;");
  db.exec("DELETE FROM customers;");
  db.exec("DELETE FROM reports;");
  db.exec(
    "DELETE FROM sqlite_sequence WHERE name IN ('order_items','orders','products','customers','reports');"
  );

  const insertCustomer = db.prepare(
    "INSERT INTO customers (name, email, created_at) VALUES (?, ?, ?)"
  );
  const customerIds = [];
  const usedNames = new Set();
  for (let i = 0; i < CUSTOMER_COUNT; i++) {
    let name;
    do {
      name = `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`;
    } while (usedNames.has(name));
    usedNames.add(name);
    const email = `${name.toLowerCase().replace(/\s+/g, ".")}@example.com`;
    const createdAt = isoDaysAgo(randInt(30, 400), randInt(0, 23), randInt(0, 59));
    const info = insertCustomer.run(name, email, createdAt);
    customerIds.push(Number(info.lastInsertRowid));
  }

  const insertProduct = db.prepare(
    "INSERT INTO products (name, category, price_cents) VALUES (?, ?, ?)"
  );
  const productIds = [];
  for (const p of PRODUCTS) {
    const info = insertProduct.run(p.name, p.category, p.price_cents);
    productIds.push(Number(info.lastInsertRowid));
  }

  const insertOrder = db.prepare(
    "INSERT INTO orders (customer_id, status, created_at) VALUES (?, ?, ?)"
  );
  const insertItem = db.prepare(
    "INSERT INTO order_items (order_id, product_id, quantity, unit_price_cents) VALUES (?, ?, ?, ?)"
  );

  let orderCount = 0;
  let itemCount = 0;

  // Walk backward from today so day 0 (today) always has at least a
  // few orders — otherwise "generate today's report" would be an
  // empty report on the very first run, which is a bad first impression.
  for (let daysAgo = DAYS_OF_HISTORY; daysAgo >= 0; daysAgo--) {
    const ordersToday = randInt(...ORDERS_PER_DAY_RANGE);
    for (let o = 0; o < ordersToday; o++) {
      const customerId = pick(customerIds);
      const status = weightedStatus();
      const createdAt = isoDaysAgo(daysAgo, randInt(8, 21), randInt(0, 59));
      const orderInfo = insertOrder.run(customerId, status, createdAt);
      const orderId = Number(orderInfo.lastInsertRowid);
      orderCount++;

      const itemsInOrder = randInt(1, 4);
      const usedProducts = new Set();
      for (let li = 0; li < itemsInOrder; li++) {
        let productId;
        do {
          productId = pick(productIds);
        } while (usedProducts.has(productId));
        usedProducts.add(productId);
        const product = PRODUCTS[productIds.indexOf(productId)];
        const quantity = randInt(1, 3);
        insertItem.run(orderId, productId, quantity, product.price_cents);
        itemCount++;
      }
    }
  }

  console.log(
    `Seeded ${customerIds.length} customers, ${productIds.length} products, ${orderCount} orders, ${itemCount} order items.`
  );
}

seed();
