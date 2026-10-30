/** Targeted Chrome Android startup/lifecycle regressions. Software WebGL plus
 * injected failures is NOT a physical Samsung GPU or memory-limit test. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, stat, mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { chromium } from 'playwright';
const root = resolve('.'), output = '.preview/android-startup';
const types = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (!url.pathname.startsWith('/Turbokartsarena/')) { res.writeHead(404).end(); return; }
    let file = resolve(root, url.pathname.slice('/Turbokartsarena/'.length) || 'index.html');
    if (!file.startsWith(root + sep)) { res.writeHead(403).end(); return; }
    if ((await stat(file)).isDirectory()) file += '/index.html';
    res.setHeader('Content-Type', types[extname(file)] ?? 'application/octet-stream');
    res.end(await readFile(file));
  } catch { res.writeHead(404).end(); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
await mkdir(output, { recursive: true });
const report = { device: 'Chromium, touch 360×780 / 915×412, DPR3, software GPU, CPU throttle ×4 during startup', physicalSamsung: false, cases: [], pageErrors: [], failedRequests: [] };
let browser;
try {
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const context = await browser.newContext({ viewport: { width: 360, height: 780 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, serviceWorkers: 'block', reducedMotion: 'reduce' });
  const page = await context.newPage(); page.setDefaultTimeout(60000);
  const consoleErrors = [];
  page.on('pageerror', e => report.pageErrors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('requestfailed', r => report.failedRequests.push(r.url()));
  await page.addInitScript(() => {
    window.__probe = { writes: 0, msaaFloat: [] };
    for (const k of ['width', 'height']) {
      const d = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, k);
      Object.defineProperty(HTMLCanvasElement.prototype, k, { ...d, set(v) { if (this.id === 'garageCanvas') window.__probe.writes++; d.set.call(this, v); } });
    }
    const old = WebGL2RenderingContext.prototype.renderbufferStorageMultisample;
    WebGL2RenderingContext.prototype.renderbufferStorageMultisample = function(...args) {
      if (args[1] > 0 && args[2] === 34842) window.__probe.msaaFloat.push(args);
      return old.apply(this, args);
    };
  });
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  const base = `http://127.0.0.1:${server.address().port}/Turbokartsarena/`;
  await page.goto(base); await page.waitForFunction(() => !!window.__tka);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  await page.waitForTimeout(300);
  assert.equal(await page.locator('#loading').isVisible(), false);
  assert.equal(await page.locator('#renderFailure').count(), 0);
  assert.deepEqual(await page.evaluate(() => [window.__tka.circuits.length, window.__tka.vehicles.length, window.__tka.drivers.length]), [12, 14, 12]);
  const writes = await page.evaluate(() => window.__probe.writes);
  await page.waitForTimeout(350);
  assert.equal(await page.evaluate(() => window.__probe.writes), writes, 'stable layout must not reallocate canvas every frame');
  assert.deepEqual(await page.evaluate(() => window.__probe.msaaFloat), [], 'no multisampled half-float mirror');
  report.cases.push('Cold incognito-style context, throttled startup, 12/14/12 roster, menu ready, no repeated drawing-buffer writes or RGBA16F MSAA');
  for (const size of [{width:915,height:412},{width:360,height:780},{width:720,height:360},{width:915,height:412}]) {
    await page.setViewportSize(size);
    await page.evaluate(() => dispatchEvent(new Event('orientationchange')));
    await page.waitForTimeout(100);
  }
  await page.evaluate(() => { const c = document.getElementById('garageCanvas'); c.style.width = '0px'; c.style.height = '0px'; });
  await page.waitForTimeout(100);
  await page.evaluate(() => { const c = document.getElementById('garageCanvas'); c.style.removeProperty('width'); c.style.removeProperty('height'); });
  await page.locator('#openGarage').tap();
  assert.equal(await page.locator('#turboGarage').isVisible(), true);
  await page.screenshot({ path: `${output}/garage.png` });
  report.cases.push('Portrait/landscape and reduced display transitions; zero-sized hidden showroom; premium garage opens');
  await page.evaluate(() => {
    const gl = document.getElementById('garageCanvas').getContext('webgl2');
    window.__loss = gl.getExtension('WEBGL_lose_context'); window.__loss.loseContext();
  });
  await page.waitForFunction(() => window.__tkaBoot.snapshot().failure?.phase === 'contexte WebGL : garage');
  await page.screenshot({ path: `${output}/context-lost.png` });
  await page.waitForTimeout(250);
  await page.evaluate(() => window.__loss.restoreContext());
  await page.waitForFunction(() => !window.__tkaBoot.snapshot().failure);
  await page.waitForTimeout(150);
  await page.locator('#closeGarage').tap();
  report.cases.push('Actual WEBGL_lose_context loss/restoration in garage is reported and recovers');
  await page.evaluate(() => { window.__tka.state.quality = 'low'; });
  await page.locator('#playBtn').tap();
  await page.waitForFunction(() => !!window.__tka.engine());
  await page.evaluate(() => { window.__tka.pauseLoop(); window.__tka.skipCountdown(); window.__tka.step(60, 16.67); window.__tka.resumeLoop(); });
  const beforeSize = await page.evaluate(() => { const e = window.__tka.engine(); const size = [e.renderer.domElement.width, e.renderer.domElement.height, e.camera.aspect]; e.resize(0, 0); e.resize(NaN, Infinity); return { size, after: [e.renderer.domElement.width, e.renderer.domElement.height, e.camera.aspect] }; });
  assert.deepEqual(beforeSize.size, beforeSize.after, 'ignore invalid dimensions');
  await page.setViewportSize({ width: 2048, height: 1152 });
  await page.waitForTimeout(100);
  assert.ok(await page.evaluate(() => { const e = window.__tka.engine(); return e.renderer.domElement.width * e.renderer.domElement.height <= e.quality.maxPixels; }), 'pixel budget survives large resize');
  await page.setViewportSize({ width: 915, height: 412 }); await page.waitForTimeout(100);
  const left = await page.locator('#leftBtn').boundingBox();
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: left.x + left.width / 2, y: left.y + left.height / 2, id: 1 }] });
  assert.ok(await page.evaluate(() => window.__tka.currentSteer() < 0));
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  assert.equal(await page.evaluate(() => window.__tka.currentSteer()), 0);
  await page.evaluate(() => { const gl = window.__tka.engine().renderer.getContext(); window.__loss = gl.getExtension('WEBGL_lose_context'); window.__loss.loseContext(); });
  await page.waitForFunction(() => window.__tka.state.paused && !!window.__tkaBoot.snapshot().failure);
  await page.evaluate(() => window.__tka.togglePause(false));
  assert.equal(await page.evaluate(() => window.__tka.state.paused), true, 'cannot resume while GPU context is lost');
  const time = await page.evaluate(() => window.__tka.engine().race.raceTime);
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => window.__tka.engine().race.raceTime), time, 'race freezes on context loss');
  await page.evaluate(() => window.__loss.restoreContext());
  await page.waitForFunction(() => !window.__tkaBoot.snapshot().failure);
  assert.equal(await page.evaluate(() => window.__tka.state.paused), true);
  await page.locator('#resumeBtn').tap();
  await page.waitForFunction(time => window.__tka.engine().race.raceTime > time, time);
  assert.ok(await page.evaluate(() => window.__tka.engine().renderer.info.render.triangles > 0));
  await page.screenshot({ path: `${output}/race-restored.png` });
  report.cases.push('Race, real touch steering, bounded pixel budget on resize, context-loss pause and user-controlled restore/resume');
  assert.deepEqual(report.pageErrors, []); assert.deepEqual(report.failedRequests, []); assert.deepEqual(consoleErrors, []);
  await context.close();
  for (const failure of ['webgl-denied', 'shader-failure', 'module-download']) {
    const c = await browser.newContext({ viewport: { width: 915, height: 412 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
    const p = await c.newPage(); p.setDefaultTimeout(60000);
    if (failure === 'webgl-denied') await p.addInitScript(() => {
      const old = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function(kind, ...args) { if (String(kind).startsWith('webgl')) return null; return old.call(this, kind, ...args); };
    });
    if (failure === 'shader-failure') await p.addInitScript(() => {
      const old = WebGL2RenderingContext.prototype.shaderSource;
      WebGL2RenderingContext.prototype.shaderSource = function(shader, source) { return old.call(this, shader, source + '\nINTENTIONAL_TEST_SHADER_ERROR'); };
    });
    if (failure === 'module-download') await p.route('**/preview.js', r => r.abort());
    await p.goto(base + (failure === 'module-download' ? 'preview/dist/index.html' : 'index.html'));
    await p.waitForSelector('#renderFailure', { state: 'visible', timeout: 60000 });
    assert.equal(await p.locator('#loading').isVisible(), false);
    assert.equal(await p.locator('#retryRendering').isVisible(), true);
    assert.ok((await p.locator('#renderFailureDetails').textContent()).includes('phase'));
    if (failure === 'webgl-denied') { assert.equal(await p.locator('#vehicleName').textContent(), 'Apex R4'); await p.screenshot({ path: `${output}/webgl-denied.png` }); }
    report.cases.push(`${failure}: visible error, local diagnostic details and retry instead of permanent black loader (deliberately injected failure)`);
    await c.close();
  }
  report.status = 'PASS'; console.log(JSON.stringify(report, null, 2));
} catch (error) { report.status = 'FAIL'; report.error = String(error?.stack || error); console.error(error); process.exitCode = 1;
} finally { await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2)); await browser?.close(); await new Promise(done => server.close(done)); }
