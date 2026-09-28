// Stages 4 & 5 combined: orchestrates "get me today's report" into
// query -> render -> store, and is where the idempotency rule lives.
//
// The core artifact-handling rule from the brief: store and link, don't
// pass 20MB around. The PDF is written once to reports/ on disk; every
// caller after that gets a small JSON pointer (id + url), never the file
// bytes themselves. Only the dedicated /reports/:id/pdf route ever streams
// the actual file.
const fs = require("node:fs");
const path = require("node:path");
const db = require("./db");
const { getReportData } = require("./report-data");
const { renderReportHtml } = require("./report-template");
const { renderHtmlToPdf } = require("./render");

const REPORTS_DIR = path.join(__dirname, "..", "reports");
if (!fs.existsSync(REPORTS_DIR)) fs.mkdirSync(REPORTS_DIR, { recursive: true });

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidDate(dateStr) {
  if (!DATE_RE.test(dateStr)) return false;
  const d = new Date(`${dateStr}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === dateStr;
}

function todayUtc() {
  return new Date().toISOString().slice(0, 10);
}

function findByDate(dateStr) {
  return db.prepare("SELECT * FROM reports WHERE report_date = ?").get(dateStr);
}

function findById(id) {
  return db.prepare("SELECT * FROM reports WHERE id = ?").get(id);
}

function toPublicShape(row) {
  return {
    id: row.id,
    date: row.report_date,
    revenueCents: row.total_revenue_cents,
    orderCount: row.order_count,
    generatedAt: row.generated_at,
    pdfUrl: `/reports/${row.id}/pdf`,
  };
}

async function writeReportFile(dateStr) {
  const data = getReportData(dateStr);
  const generatedAt = Date.now();
  const html = renderReportHtml(data, { generatedAt });
  const filePath = path.join(REPORTS_DIR, `report-${dateStr}.pdf`);
  await renderHtmlToPdf(html, filePath);
  return { data, filePath, generatedAt };
}

/**
 * Generate (or return) the report for a date.
 *
 * "Ask twice, get one": calling this twice for the same date with the
 * same `force` value never produces two files or two rows — the second
 * call is a no-op that returns what the first one already made.
 *
 *   - no existing report            -> render + store  -> { created: true }
 *   - existing report, force=false  -> return as-is     -> { created: false }
 *   - existing report, force=true   -> re-render, overwrite same row/file
 *                                      -> { created: false, regenerated: true }
 */
async function generateReport(dateStr, { force = false } = {}) {
  if (!isValidDate(dateStr)) {
    const err = new Error(`Invalid date "${dateStr}" — expected YYYY-MM-DD.`);
    err.statusCode = 400;
    throw err;
  }

  const existing = findByDate(dateStr);
  if (existing && !force) {
    return { report: toPublicShape(existing), created: false, regenerated: false };
  }

  const { data, filePath, generatedAt } = await writeReportFile(dateStr);
  const generatedAtIso = new Date(generatedAt).toISOString();

  if (existing) {
    db.prepare(
      `UPDATE reports
       SET file_path = ?, total_revenue_cents = ?, order_count = ?, generated_at = ?
       WHERE id = ?`
    ).run(filePath, data.summary.revenueCents, data.summary.completedOrders, generatedAtIso, existing.id);
    const updated = findById(existing.id);
    return { report: toPublicShape(updated), created: false, regenerated: true };
  }

  const info = db
    .prepare(
      `INSERT INTO reports (report_date, file_path, total_revenue_cents, order_count, generated_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(dateStr, filePath, data.summary.revenueCents, data.summary.completedOrders, generatedAtIso);
  const created = findById(Number(info.lastInsertRowid));
  return { report: toPublicShape(created), created: true, regenerated: false };
}

function listReports() {
  const rows = db.prepare("SELECT * FROM reports ORDER BY report_date DESC").all();
  return rows.map(toPublicShape);
}

function getReportMeta(id) {
  const row = findById(id);
  return row ? toPublicShape(row) : null;
}

function getReportFilePath(id) {
  const row = findById(id);
  return row ? row.file_path : null;
}

module.exports = {
  generateReport,
  listReports,
  getReportMeta,
  getReportFilePath,
  isValidDate,
  todayUtc,
};
