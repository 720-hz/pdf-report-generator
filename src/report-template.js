// Stage 3: turn the aggregated numbers into an HTML document built to be
// printed, not browsed. The one real trap here is table rows splitting
// across a page break mid-row — fixed below with `break-inside: avoid` on
// every <tr> and a repeating <thead> (its default `display: table-header-group`
// is what makes Chromium redraw the header on each new page).
const { getFontFaceCss } = require("./fonts");

function formatMoney(cents) {
  return `$${(cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatDateLong(dateStr) {
  return new Date(`${dateStr}T00:00:00.000Z`).toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderTrendBars(dailyTrend) {
  const max = Math.max(1, ...dailyTrend.map((d) => d.revenue_cents));
  return dailyTrend
    .map((d) => {
      const pct = Math.round((d.revenue_cents / max) * 100);
      const short = d.day.slice(5); // MM-DD
      return `
        <div class="trend-col">
          <div class="trend-bar-track">
            <div class="trend-bar" style="height:${pct}%"></div>
          </div>
          <div class="trend-label">${short}</div>
        </div>`;
    })
    .join("");
}

function renderReportHtml(data, { generatedAt } = {}) {
  const { date, summary, revenueByCategory, topProducts, topCustomers, dailyTrend } = data;
  const generatedLabel = new Date(generatedAt ?? Date.now()).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  });

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Daily Sales Report — ${date}</title>
<style>
${getFontFaceCss()}

:root {
  --main: #2b2e6b;
  --text: #14161a;
  --bg: #fafaf7;
  --accent: #35d0a0;
  --border: #e3e2db;
  --muted: #6a6d78;
}

* { box-sizing: border-box; }

@page {
  size: A4;
  margin: 20mm 16mm 18mm 16mm;
}

body {
  margin: 0;
  font-family: "Inter", "Helvetica Neue", Arial, sans-serif;
  font-size: 10.5px;
  color: var(--text);
  background: var(--bg);
}

h1, h2, h3 {
  font-family: "Space Grotesk", "Inter", sans-serif;
  margin: 0;
  color: var(--main);
}

.header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  border-bottom: 2px solid var(--main);
  padding-bottom: 10px;
  margin-bottom: 18px;
}

.header h1 { font-size: 20px; font-weight: 700; }
.header .subtitle { color: var(--muted); font-size: 11px; margin-top: 4px; }

.generated-pill {
  font-family: "Space Grotesk", sans-serif;
  font-size: 8.5px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: #0e2420;
  background: var(--accent);
  padding: 4px 9px;
  border-radius: 999px;
  white-space: nowrap;
}

.summary-grid {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 10px;
  margin-bottom: 20px;
}

.stat-card {
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 10px 11px;
  break-inside: avoid;
}

.stat-card .label {
  font-size: 8px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--muted);
  margin-bottom: 5px;
}

.stat-card .value {
  font-family: "Space Grotesk", sans-serif;
  font-size: 16px;
  font-weight: 700;
  color: var(--main);
}

section { margin-bottom: 20px; }

section h2 {
  font-size: 12.5px;
  font-weight: 600;
  margin-bottom: 8px;
  padding-bottom: 4px;
  border-bottom: 1px solid var(--border);
}

table {
  width: 100%;
  border-collapse: collapse;
}

thead { display: table-header-group; } /* repeat header on each printed page */
tfoot { display: table-footer-group; }

th {
  text-align: left;
  font-size: 8.5px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--muted);
  font-weight: 600;
  padding: 5px 8px;
  border-bottom: 1px solid var(--main);
}

th.num, td.num { text-align: right; }

td {
  padding: 5px 8px;
  border-bottom: 1px solid var(--border);
}

/* The page-break trap: without this, a <tr> can be sliced in half across
   a page boundary, printing its top half on one page and the rest on the
   next. break-inside: avoid keeps every row intact. */
tr { break-inside: avoid; }

tbody tr:nth-child(odd) { background: #f4f3ee; }

.trend-chart {
  display: flex;
  align-items: flex-end;
  gap: 4px;
  height: 90px;
  padding: 8px 4px 0;
  border-bottom: 1px solid var(--border);
  break-inside: avoid;
}

.trend-col {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  height: 100%;
}

.trend-bar-track {
  flex: 1;
  width: 100%;
  display: flex;
  align-items: flex-end;
  justify-content: center;
}

.trend-bar {
  width: 60%;
  background: var(--main);
  border-radius: 2px 2px 0 0;
  min-height: 2px;
}

.trend-label {
  font-size: 7px;
  color: var(--muted);
  margin-top: 3px;
  writing-mode: vertical-rl;
  transform: rotate(180deg);
  height: 22px;
}

.empty-note {
  color: var(--muted);
  font-size: 10px;
  font-style: italic;
  padding: 8px 0;
}

.footer-note {
  color: var(--muted);
  font-size: 8.5px;
  margin-top: 6px;
}
</style>
</head>
<body>
  <div class="header">
    <div>
      <h1>Daily Sales Report</h1>
      <div class="subtitle">The Little Shop &middot; ${formatDateLong(date)}</div>
    </div>
    <div class="generated-pill">Generated ${escapeHtml(generatedLabel)} UTC</div>
  </div>

  <div class="summary-grid">
    <div class="stat-card">
      <div class="label">Revenue</div>
      <div class="value">${formatMoney(summary.revenueCents)}</div>
    </div>
    <div class="stat-card">
      <div class="label">Completed orders</div>
      <div class="value">${summary.completedOrders}</div>
    </div>
    <div class="stat-card">
      <div class="label">Avg order value</div>
      <div class="value">${formatMoney(summary.averageOrderValueCents)}</div>
    </div>
    <div class="stat-card">
      <div class="label">Units sold</div>
      <div class="value">${summary.unitsSold}</div>
    </div>
    <div class="stat-card">
      <div class="label">Refunded / cancelled</div>
      <div class="value">${summary.refundedOrders} / ${summary.cancelledOrders}</div>
    </div>
  </div>

  <section>
    <h2>14-day revenue trend (through ${date})</h2>
    <div class="trend-chart">
      ${renderTrendBars(dailyTrend)}
    </div>
  </section>

  <section>
    <h2>Revenue by category</h2>
    ${
      revenueByCategory.length
        ? `<table>
      <thead><tr><th>Category</th><th class="num">Units sold</th><th class="num">Revenue</th></tr></thead>
      <tbody>
        ${revenueByCategory
          .map(
            (r) => `<tr><td>${escapeHtml(r.category)}</td><td class="num">${r.units_sold}</td><td class="num">${formatMoney(r.revenue_cents)}</td></tr>`
          )
          .join("")}
      </tbody>
    </table>`
        : `<div class="empty-note">No completed orders on ${date}.</div>`
    }
  </section>

  <section>
    <h2>Top 5 products</h2>
    ${
      topProducts.length
        ? `<table>
      <thead><tr><th>Product</th><th>Category</th><th class="num">Units</th><th class="num">Revenue</th></tr></thead>
      <tbody>
        ${topProducts
          .map(
            (p) => `<tr><td>${escapeHtml(p.name)}</td><td>${escapeHtml(p.category)}</td><td class="num">${p.units_sold}</td><td class="num">${formatMoney(p.revenue_cents)}</td></tr>`
          )
          .join("")}
      </tbody>
    </table>`
        : `<div class="empty-note">No completed orders on ${date}.</div>`
    }
  </section>

  <section>
    <h2>Top 5 customers</h2>
    ${
      topCustomers.length
        ? `<table>
      <thead><tr><th>Customer</th><th>Email</th><th class="num">Orders</th><th class="num">Revenue</th></tr></thead>
      <tbody>
        ${topCustomers
          .map(
            (c) => `<tr><td>${escapeHtml(c.name)}</td><td>${escapeHtml(c.email)}</td><td class="num">${c.order_count}</td><td class="num">${formatMoney(c.revenue_cents)}</td></tr>`
          )
          .join("")}
      </tbody>
    </table>`
        : `<div class="empty-note">No completed orders on ${date}.</div>`
    }
  </section>

  <div class="footer-note">pdf-report-generator &middot; SQLite aggregation, rendered with Playwright</div>
</body>
</html>`;
}

module.exports = { renderReportHtml, formatMoney, formatDateLong };
