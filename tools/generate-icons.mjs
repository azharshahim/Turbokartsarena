/** Rasterize the existing original SVG with Chromium. No external artwork. */
import { chromium } from 'playwright';
import { mkdir, readFile } from 'node:fs/promises';
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
});
try {
  await mkdir('icons', { recursive: true });
  const svg = await readFile('icon.svg', 'utf8');
  for (const size of [192, 512]) {
    const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    await page.setContent(`<style>html,body{margin:0;background:#070a16}svg{display:block;width:100vw;height:100vh}</style>${svg}`);
    await page.screenshot({ path: `icons/icon-${size}.png` });
    await page.close();
  }
} finally {
  await browser.close();
}
