import { chromium } from 'playwright';
const url = 'http://127.0.0.1:5173/preview/dist/index.html';
const W = Number(process.env.W ?? 960), H = Number(process.env.H ?? 540);
const browser = await chromium.launch({ args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: W, height: H } });
const errs = [];
page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
page.on('pageerror', e => errs.push(e.message));
await page.goto(url, { waitUntil: 'networkidle' });
for (const j of JSON.parse(process.argv[2])) {
  await page.evaluate((c) => window.__tka.start(c), j.cfg);
  await page.waitForTimeout(500);
  await page.evaluate((auto) => {
    window.__tka.pauseLoop();
    window.__tka.skipCountdown();
    window.__tka.setAutopilot(auto);
  }, j.auto !== false);
  await page.evaluate((n) => window.__tka.step(n, 16.7), j.frames ?? 240);
  await page.waitForTimeout(200);
  await page.screenshot({ path: j.out, timeout: 60000 });
  console.log(j.out, JSON.stringify(await page.evaluate(() => window.__tka.engine()?.stats ?? null)));
}
if (errs.length) console.log('ERREURS:\n' + errs.slice(0, 6).join('\n'));
await browser.close();
