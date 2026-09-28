// Stage 3 (rendering half): HTML string -> PDF file on disk, via a
// headless Chromium instance. Playwright is overkill-looking for "print a
// page" but it's exactly the right tool: real layout engine, real CSS
// print support (page-break control, repeating <thead>), no separate
// PDF-drawing API to hand-roll tables and pagination in.
const { chromium } = require("playwright");

const FOOTER_TEMPLATE = `
<div style="width:100%; font-family: Inter, sans-serif; font-size: 7.5px; color: #6a6d78; padding: 0 16mm; display: flex; justify-content: space-between;">
  <span>pdf-report-generator</span>
  <span class="pageNumber"></span>&nbsp;/&nbsp;<span class="totalPages"></span>
</div>`;

// This sandbox ships a pinned Chromium build at /opt/pw-browsers/chromium
// (see PLAYWRIGHT_BROWSERS_PATH) that doesn't always match the revision the
// installed Playwright package expects, so `chromium.launch()` alone can
// look for a browser binary that isn't there. Pointing executablePath at
// the pre-installed build sidesteps that without a `playwright install`
// download. Outside this sandbox, dropping this option and running
// `npx playwright install chromium` once is the normal path.
const PINNED_CHROMIUM = "/opt/pw-browsers/chromium";
const fs = require("node:fs");

let browserPromise = null;
function getBrowser() {
  if (!browserPromise) {
    const opts = { headless: true };
    if (fs.existsSync(PINNED_CHROMIUM)) {
      opts.executablePath = PINNED_CHROMIUM;
    }
    browserPromise = chromium.launch(opts);
  }
  return browserPromise;
}

/**
 * Render an HTML string to a PDF file at `outputPath`.
 * Reuses a single browser instance across calls (each render gets its own
 * page/tab) so repeated report generation doesn't pay Chromium's cold-start
 * cost every time.
 */
async function renderHtmlToPdf(html, outputPath) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: "networkidle" });
    await page.pdf({
      path: outputPath,
      format: "A4",
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: "<span></span>", // empty — @page margin + in-document header handles it
      footerTemplate: FOOTER_TEMPLATE,
      margin: { top: "20mm", right: "16mm", bottom: "18mm", left: "16mm" },
    });
  } finally {
    await page.close();
  }
  return outputPath;
}

async function closeBrowser() {
  if (browserPromise) {
    const browser = await browserPromise;
    await browser.close();
    browserPromise = null;
  }
}

module.exports = { renderHtmlToPdf, closeBrowser };
