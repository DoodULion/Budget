// Render scripts/icon.svg to the PNG icons in public/icons/ (uses Playwright's Chromium).
// Run: node scripts/render-icons.mjs
import { createRequire } from 'node:module';
// Playwright is not a project dependency; install it globally (npm i -g playwright) to rerun this.
const { chromium } = createRequire(import.meta.url)('playwright');
import { readFileSync } from 'node:fs';

const svg = readFileSync(new URL('./icon.svg', import.meta.url), 'utf8');
const out = new URL('../public/icons/', import.meta.url);
// Maskable icons keep the art inside the central 80% safe zone.
const sizes = [
  ['favicon-48.png', 48, 1],
  ['apple-touch-icon.png', 180, 1],
  ['icon-192.png', 192, 1],
  ['icon-512.png', 512, 1],
  ['icon-512-maskable.png', 512, 0.8],
];

const browser = await chromium.launch();
const page = await browser.newPage();
for (const [name, size, scale] of sizes) {
  await page.setViewportSize({ width: size, height: size });
  const inner = Math.round(size * scale);
  await page.setContent(
    `<body style="margin:0;background:#1f3a5f;display:grid;place-items:center;width:${size}px;height:${size}px">` +
      `<div style="width:${inner}px;height:${inner}px">${svg.replace('<svg ', `<svg width="${inner}" height="${inner}" `)}</div></body>`,
  );
  await page.screenshot({ path: new URL(name, out).pathname, omitBackground: false });
}
await browser.close();
