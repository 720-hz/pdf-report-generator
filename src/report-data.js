// Stage 2: the boring SQL aggregation. Nothing fancy — COUNT, SUM, AVG,
// GROUP BY — which is the point: a report is mostly arithmetic over rows
// you already have, not a new subsystem.
const db = require("./db");

const TREND_DAYS = 14;

/** Half-open [start, end) UTC day boundary for a "YYYY-MM-DD" date string. */
function dayBounds(dateStr) {
  const start = new Date(`${dateStr}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime())) {
    throw new Error(`Invalid date: ${dateStr}`);
  }
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return { start: start.toISOString(), end: end.toISOString() };
}

/**
 * Pull every number the report needs for a single calendar day, as one
 * plain object. Revenue only counts 'completed' orders — refunded and
 * cancelled orders are shown separately, not folded into revenue.
 */
function getReportData(dateStr) {
  const { start, end } = dayBounds(dateStr);

  const summary = db
    .prepare(
      `SELECT
         COUNT(DISTINCT o.id) FILTER (WHERE o.status = 'completed') AS completed_orders,
         COUNT(DISTINCT o.id) FILTER (WHERE o.status = 'refunded') AS refunded_orders,
         COUNT(DISTINCT o.id) FILTER (WHERE o.status = 'cancelled') AS cancelled_orders,
         COALESCE(SUM(oi.quantity * oi.unit_price_cents) FILTER (WHERE o.status = 'completed'), 0) AS revenue_cents,
         COALESCE(SUM(oi.quantity) FILTER (WHERE o.status = 'completed'), 0) AS units_sold
       FROM orders o
       LEFT JOIN order_items oi ON oi.order_id = o.id
       WHERE o.created_at >= ? AND o.created_at < ?`
    )
    .get(start, end);

  const revenueByCategory = db
    .prepare(
      `SELECT
         p.category AS category,
         SUM(oi.quantity * oi.unit_price_cents) AS revenue_cents,
         SUM(oi.quantity) AS units_sold
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       JOIN products p ON p.id = oi.product_id
       WHERE o.status = 'completed' AND o.created_at >= ? AND o.created_at < ?
       GROUP BY p.category
       ORDER BY revenue_cents DESC`
    )
    .all(start, end);

  const topProducts = db
    .prepare(
      `SELECT
         p.name AS name,
         p.category AS category,
         SUM(oi.quantity) AS units_sold,
         SUM(oi.quantity * oi.unit_price_cents) AS revenue_cents
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       JOIN products p ON p.id = oi.product_id
       WHERE o.status = 'completed' AND o.created_at >= ? AND o.created_at < ?
       GROUP BY p.id
       ORDER BY revenue_cents DESC
       LIMIT 5`
    )
    .all(start, end);

  const topCustomers = db
    .prepare(
      `SELECT
         c.name AS name,
         c.email AS email,
         COUNT(DISTINCT o.id) AS order_count,
         SUM(oi.quantity * oi.unit_price_cents) AS revenue_cents
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       JOIN customers c ON c.id = o.customer_id
       WHERE o.status = 'completed' AND o.created_at >= ? AND o.created_at < ?
       GROUP BY c.id
       ORDER BY revenue_cents DESC
       LIMIT 5`
    )
    .all(start, end);

  const trendStart = new Date(start);
  trendStart.setUTCDate(trendStart.getUTCDate() - (TREND_DAYS - 1));
  const dailyTrendRows = db
    .prepare(
      `SELECT
         date(o.created_at) AS day,
         COALESCE(SUM(oi.quantity * oi.unit_price_cents), 0) AS revenue_cents
       FROM orders o
       LEFT JOIN order_items oi ON oi.order_id = o.id AND o.status = 'completed'
       WHERE o.status = 'completed' AND o.created_at >= ? AND o.created_at < ?
       GROUP BY day
       ORDER BY day ASC`
    )
    .all(trendStart.toISOString(), end);

  // Fill in zero-revenue days so the trend chart/table has no gaps.
  const trendByDay = new Map(dailyTrendRows.map((r) => [r.day, r.revenue_cents]));
  const dailyTrend = [];
  for (let i = TREND_DAYS - 1; i >= 0; i--) {
    const d = new Date(`${dateStr}T00:00:00.000Z`);
    d.setUTCDate(d.getUTCDate() - i);
    const key = d.toISOString().slice(0, 10);
    dailyTrend.push({ day: key, revenue_cents: trendByDay.get(key) ?? 0 });
  }

  return {
    date: dateStr,
    summary: {
      completedOrders: summary.completed_orders,
      refundedOrders: summary.refunded_orders,
      cancelledOrders: summary.cancelled_orders,
      revenueCents: summary.revenue_cents,
      unitsSold: summary.units_sold,
      averageOrderValueCents:
        summary.completed_orders > 0
          ? Math.round(summary.revenue_cents / summary.completed_orders)
          : 0,
    },
    revenueByCategory,
    topProducts,
    topCustomers,
    dailyTrend,
  };
}

module.exports = { getReportData, dayBounds };
