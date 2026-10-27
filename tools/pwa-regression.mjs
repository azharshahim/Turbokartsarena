/** Real service-worker tests over HTTP, including a GitHub Pages project path. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolve, extname, sep } from 'node:path';
import { chromium } from 'playwright';

const root = resolve('.');
const prefix = '/Turbokartsarena/';
let nextWorker = false;
const types = { '.html': 'text/html', '.js': 'text/javascript', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (!pathname.startsWith(prefix)) { res.writeHead(404).end(); return; }
    const relative = pathname.slice(prefix.length) || 'index.html';
    const path = resolve(root, relative.endsWith('/') ? `${relative}index.html` : relative);
    if (!path.startsWith(root + sep)) { res.writeHead(403).end(); return; }
    let body = await readFile(path);
    if (nextWorker && relative === 'service-worker.js') {
      body = Buffer.from(body.toString().replace(/(const CACHE_VERSION = '[^']*)'/, "$1-next'"));
    }
    res.writeHead(200, { 'Content-Type': types[extname(path)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(body);
  } catch { res.writeHead(404).end(); }
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const base = `http://127.0.0.1:${server.address().port}${prefix}`;
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const profile = await mkdtemp(join(tmpdir(), 'tka-pwa-'));
const context = await chromium.launchPersistentContext(profile, {
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  viewport: { width: 915, height: 412 }, isMobile: true, hasTouch: true,
});
try {
  let page = await context.newPage();
  const errors = [];
  context.on('weberror', (error) => errors.push(error.error().message));
  await page.goto(base);
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  const manifestURL = await page.locator('link[rel="manifest"]').getAttribute('href');
  const response = await context.request.get(new URL(manifestURL, base).href);
  assert.match(response.headers()['content-type'], /application\/manifest\+json/);
  const manifest = await response.json();
  assert.equal(new URL(manifest.start_url, response.url()).href, `${base}index.html`);
  assert.equal(new URL(manifest.scope, response.url()).href, base);
  assert.equal(new URL(manifest.id, response.url()).href, base);
  assert.equal(manifest.display, 'standalone');
  for (const size of [192, 512]) {
    const icon = manifest.icons.find((entry) => entry.sizes === `${size}x${size}`);
    assert.ok(icon, `missing ${size}px icon`);
    const png = await context.request.get(new URL(icon.src, response.url()).href);
    assert.equal(png.status(), 200);
    assert.match(png.headers()['content-type'], /image\/png/);
    const bytes = await png.body();
    assert.equal(bytes.subarray(1, 4).toString(), 'PNG');
    assert.equal(bytes.readUInt32BE(16), size);
    assert.equal(bytes.readUInt32BE(20), size);
  }
  const cdp = await context.newCDPSession(page);
  const parsed = await cdp.send('Page.getAppManifest');
  assert.deepEqual(parsed.errors, []);
  assert.ok(parsed.data.includes('Turbo Karts Arena'));
  const installability = await cdp.send('Page.getInstallabilityErrors');
  assert.deepEqual(installability.installabilityErrors, [], 'Chromium installability errors');
  console.log('PASS: scoped manifest, PNG dimensions, Chromium installability checks.');

  await page.evaluate(async () => {
    await caches.open('unrelated-app-cache');
    await caches.open('turbo-karts-arena:https://other.example/:keep');
  });
  const initialKeys = await page.evaluate(() => caches.keys());
  const ownPrefix = `turbo-karts-arena:${base}:`;
  const initialCache = initialKeys.find((key) => key.startsWith(ownPrefix));
  assert.ok(initialCache);
  assert.equal(await page.evaluate(async (name) => (await (await caches.open(name)).keys()).length, initialCache), 6);

  await context.setOffline(true);
  // Cold navigation from a closed tab, including a query string used by launch URLs.
  await page.close();
  page = await context.newPage();
  await page.goto(`${base}index.html?installed=1`);
  await page.waitForFunction(() => !!window.__tka);
  assert.ok(await page.locator('#playBtn').isVisible());
  for (const path of ['manifest.webmanifest', 'icon.svg', 'icons/icon-192.png', 'icons/icon-512.png']) {
    assert.equal(await page.evaluate(async (path) => (await fetch(path)).status, path), 200);
  }
  // Unknown files must fail offline, rather than receiving index.html as JS/data.
  assert.equal(await page.evaluate(async () => {
    try { await fetch('./missing-script.js'); return false; } catch { return true; }
  }), true);
  await page.evaluate(() => window.__tka.start({ circuit: 0, quality: 'low' }));
  await page.waitForFunction(() => !!window.__tka.engine(), { timeout: 30000 });
  const race = await page.evaluate(() => {
    window.__tka.pauseLoop();
    window.__tka.skipCountdown();
    window.__tka.step(120, 16.67);
    const engine = window.__tka.engine();
    return { phase: engine.race.phase, time: engine.race.raceTime };
  });
  assert.equal(race.phase, 'racing');
  assert.ok(race.time > 1);
  await page.evaluate(() => window.__tka.quit());
  console.log('PASS: cold offline launch, cached icons/manifest, offline playable race, no HTML fallback for missing assets.');

  await context.setOffline(false);
  nextWorker = true;
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    await registration.update();
  });
  await page.waitForFunction(async () => !!(await navigator.serviceWorker.getRegistration()).waiting);
  assert.ok((await page.evaluate(() => caches.keys())).includes(initialCache), 'update removed the active cache during a session');
  await page.close();
  page = await context.newPage();
  await page.goto(base);
  await page.waitForFunction(async ({ ownPrefix, initialCache }) => {
    const keys = await caches.keys();
    return keys.some((key) => key.startsWith(ownPrefix) && key.endsWith('-next')) && !keys.includes(initialCache);
  }, { ownPrefix, initialCache });
  const keys = await page.evaluate(() => caches.keys());
  assert.ok(keys.includes('unrelated-app-cache'));
  assert.ok(keys.includes('turbo-karts-arena:https://other.example/:keep'));
  await context.setOffline(true);
  await page.reload();
  await page.waitForFunction(() => !!window.__tka);
  console.log('PASS: update waits for old tabs to close, updated offline shell works, unrelated caches preserved.');
  await context.setOffline(false);

  // Both generated distributions must also carry a self-contained PWA shell.
  for (const directory of ['preview/dist/', 'dist/']) {
    const isolated = await browser.newContext();
    const entry = await isolated.newPage();
    await entry.goto(`${base}${directory}`);
    await entry.waitForFunction(() => !!navigator.serviceWorker.controller);
    await isolated.setOffline(true);
    await entry.reload();
    await entry.waitForFunction(() => !!window.__tka);
    console.log(`PASS: ${directory} loads its own worker and game bundle offline.`);
    await isolated.close();
  }
  assert.deepEqual(errors, []);
  await context.close();
} finally {
  await context.close();
  await browser.close();
  await rm(profile, { recursive: true, force: true });
  await new Promise((done) => server.close(done));
}
