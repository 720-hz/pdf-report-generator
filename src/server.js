// Stage 4: serve it. Everything the brief calls for happens on demand,
// synchronously, inside a plain request handler — no background job. That's
// a deliberate choice, not a shortcut: the "Bring in A7" stretch goal is
// exactly the exercise of moving this call behind a queue once report
// generation gets slow enough that a client would feel the wait.
const express = require("express");
const path = require("node:path");
const fs = require("node:fs");
const {
  generateReport,
  listReports,
  getReportMeta,
  getReportFilePath,
  todayUtc,
} = require("./report-service");
const { closeBrowser } = require("./render");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

// POST /reports — generate today's report, or a specific { date }.
// Idempotent by default: calling this twice for the same date returns the
// same report (200) instead of generating a duplicate. Pass { force: true }
// to force a fresh render for that date.
app.post("/reports", async (req, res, next) => {
  try {
    const date = req.body?.date ?? todayUtc();
    const force = req.body?.force === true;
    const { report, created } = await generateReport(date, { force });
    res.status(created ? 201 : 200).json(report);
  } catch (err) {
    next(err);
  }
});

// GET /reports — list every report generated so far (metadata + link only).
app.get("/reports", (_req, res) => {
  res.json(listReports());
});

// GET /reports/:id — metadata for one report, including a link to the PDF.
app.get("/reports/:id", (req, res) => {
  const id = Number(req.params.id);
  const report = Number.isInteger(id) ? getReportMeta(id) : null;
  if (!report) return res.status(404).json({ error: "Report not found." });
  res.json(report);
});

// GET /reports/:id/pdf — the only route that ever sends file bytes. Everything
// else deals in ids and links, per the "store and link" rule.
app.get("/reports/:id/pdf", (req, res) => {
  const id = Number(req.params.id);
  const filePath = Number.isInteger(id) ? getReportFilePath(id) : null;
  if (!filePath || !fs.existsSync(filePath)) {
    return res.status(404).json({ error: "Report not found." });
  }
  res.sendFile(path.resolve(filePath), {
    headers: { "Content-Type": "application/pdf" },
  });
});

app.use((req, res) => {
  res.status(404).json({ error: `No route for ${req.method} ${req.path}` });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  const status = err.statusCode ?? 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: err.message ?? "Internal server error." });
});

if (require.main === module) {
  const server = app.listen(PORT, () => {
    console.log(`pdf-report-generator listening on http://localhost:${PORT}`);
  });

  const shutdown = async () => {
    console.log("\nShutting down...");
    server.close();
    await closeBrowser();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

module.exports = app;
