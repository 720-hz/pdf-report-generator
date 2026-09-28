// Brand fonts (Space Grotesk / Inter) embedded as base64 data URIs so the
// PDF renders correctly with zero network access — Playwright's headless
// Chromium here can't reach fonts.googleapis.com (sandbox network policy),
// and even where it can, a report generator shouldn't depend on a
// third-party font CDN being up at render time. @fontsource ships the
// static woff2 files locally; we just inline them once and cache the CSS.
const fs = require("node:fs");
const path = require("node:path");

const FONT_FILES = [
  { family: "Inter", weight: 400, pkg: "inter", file: "inter-latin-400-normal.woff2" },
  { family: "Inter", weight: 500, pkg: "inter", file: "inter-latin-500-normal.woff2" },
  { family: "Inter", weight: 600, pkg: "inter", file: "inter-latin-600-normal.woff2" },
  {
    family: "Space Grotesk",
    weight: 600,
    pkg: "space-grotesk",
    file: "space-grotesk-latin-600-normal.woff2",
  },
  {
    family: "Space Grotesk",
    weight: 700,
    pkg: "space-grotesk",
    file: "space-grotesk-latin-700-normal.woff2",
  },
];

let cachedCss = null;

function getFontFaceCss() {
  if (cachedCss) return cachedCss;

  const faces = FONT_FILES.map(({ family, weight, pkg, file }) => {
    const filePath = path.join(
      __dirname,
      "..",
      "node_modules",
      "@fontsource",
      pkg,
      "files",
      file
    );
    const base64 = fs.readFileSync(filePath).toString("base64");
    return `
@font-face {
  font-family: "${family}";
  font-style: normal;
  font-weight: ${weight};
  font-display: swap;
  src: url(data:font/woff2;base64,${base64}) format("woff2");
}`;
  });

  cachedCss = faces.join("\n");
  return cachedCss;
}

module.exports = { getFontFaceCss };
