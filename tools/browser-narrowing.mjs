/** Narrow-road / HDR bloom regressions. Real rendered pixels, emulated touch;
 * software WebGL is not validation of a physical Samsung GPU. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, stat, mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { chromium } from 'playwright';
const root = resolve('.'), output = '.preview/narrowing';
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
const report = { physicalSamsung: false, viewport: '915×412, DPR2, Chromium Android UA/touch, SwiftShader', cases: [], pageErrors: [], failedRequests: [] };
let browser;
try {
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 915, height: 412 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36', serviceWorkers: 'block' });
  page.setDefaultTimeout(60000);
  page.on('pageerror', e => report.pageErrors.push(e.message));
  page.on('requestfailed', r => report.failedRequests.push(r.url()));
  await page.goto(`http://127.0.0.1:${server.address().port}/Turbokartsarena/`);
  await page.waitForFunction(() => !!window.__tka);
  await page.evaluate(() => window.__tka.start({ circuit: 0, quality: 'high' }));
  await page.waitForFunction(() => !!window.__tka.engine());
  await page.evaluate(() => {
    window.__tka.pauseLoop();
    const e = window.__tka.engine(); e.race.phase = 'racing'; e.race.countdown = 0;
    window.__resizeEvents = 0;
    addEventListener('resize', () => window.__resizeEvents++);
    // Inspect the scene's HDR target BEFORE bloom can spread a single NaN.
    const pass = e.postfx.composer.passes[0], original = pass.render;
    pass.render = function(renderer, write, read, ...args) {
      original.call(this, renderer, write, read, ...args);
      const gl = renderer.getContext(), w = Math.floor(read.width), h = Math.floor(read.height);
      const pixels = new Float32Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.FLOAT, pixels);
      let nonFinite = 0;
      for (let i = 0; i < pixels.length; i++) if (!Number.isFinite(pixels[i])) nonFinite++;
      window.__hdrProbe = { nonFinite, error: gl.getError(), status: gl.checkFramebufferStatus(gl.FRAMEBUFFER) };
    };
  });
  for (const mode of ['stable', 'down', 'up']) {
    const positions = mode === 'stable' ? [360, 408, 423, 78, 93, 498, 513, 738, 753] : [360, 408, 423];
    for (const s of positions) {
      const result = await page.evaluate(({ s, mode }) => {
        const t = window.__tka, e = t.engine(), track = e.race.track;
        // Controlled fixture, NOT a claim of a complete race driven on a phone.
        const p = track.worldAt(s, 0), heading = track.headingAt(s);
        e.player.reset({ ...p, heading }, track, e.race.raceTime);
        e.camYaw = heading; e.camPos.set(p.x - Math.sin(heading) * 6, p.y + 3, p.z - Math.cos(heading) * 6);
        e.elapsed = 1; e.resetFrameClock(); e.setInput({ throttle: 0, steer: 0, drift: false, brake: false });
        e.currentPixelRatio = 1.6; e.applyResolution();
        // Exercise the real adaptation branches deterministically, without a
        // window resize or changing any effects / passes / performance policy.
        e.resizeCooldown = mode === 'stable' ? 100 : 0;
        e.frameAvg = mode === 'down' ? 0.1 : mode === 'up' ? 0.001 : 1 / 60;
        e.frame(performance.now()); t.updateHud();
        const gl = e.renderer.getContext(), w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
        const pixels = new Uint8Array(w * h * 4); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        let black = 0, rightBlack = 0, rightTotal = 0;
        for (let i = 0; i < pixels.length; i += 4) {
          const dark = pixels[i] + pixels[i + 1] + pixels[i + 2] < 12;
          if (dark) black++;
          if (i / 4 % w > w / 2) { rightTotal++; if (dark) rightBlack++; }
        }
        const warning = document.getElementById('hazardWarning'), rect = warning.getBoundingClientRect();
        return { s, mode, warning: warning.textContent, warningBounds: [rect.width, rect.height],
          blackFraction: black / (w * h), rightBlackFraction: rightBlack / rightTotal, hdr: window.__hdrProbe,
          viewport: [...gl.getParameter(gl.VIEWPORT)], scissor: [...gl.getParameter(gl.SCISSOR_BOX)], scissorEnabled: gl.isEnabled(gl.SCISSOR_TEST),
          defaultFramebuffer: gl.getParameter(gl.FRAMEBUFFER_BINDING) === null, framebufferStatus: gl.checkFramebufferStatus(gl.FRAMEBUFFER),
          dimensions: [w, h], cssDimensions: [e.width, e.height], pixelRatio: e.currentPixelRatio, error: gl.getError(), resizeEvents: window.__resizeEvents,
          effects: e.postfx.composer.passes.map(p => p.enabled) };
      }, { s, mode });
      report.cases.push(result);
      if ([360, 408, 423].includes(s)) await page.screenshot({ path: `${output}/${mode}-${s}.png` });
      assert.equal(result.hdr.nonFinite, 0, `${mode}/${s}: finite scene HDR, before bloom`);
      assert.equal(result.hdr.error, 0);
      assert.equal(result.hdr.status, 36053, 'scene FBO complete');
      assert.ok(result.blackFraction < 0.25 && result.rightBlackFraction < 0.25, `${mode}/${s}: no black frame / surviving left strip`);
      assert.deepEqual(result.viewport, [0, 0, ...result.dimensions]);
      assert.equal(result.scissorEnabled, false);
      assert.equal(result.defaultFramebuffer, true);
      assert.equal(result.framebufferStatus, 36053);
      assert.equal(result.error, 0);
      assert.equal(result.resizeEvents, 0, 'no Chrome/window resize during the sequence');
      assert.deepEqual(result.cssDimensions, [915, 412]);
      assert.ok(result.effects.every(Boolean), 'all V4 postprocessing passes retained');
      assert.ok(mode === 'down' ? result.pixelRatio < 1.6 : mode === 'up' ? result.pixelRatio > 1.6 : result.pixelRatio === 1.6);
      if (s === 408) {
        assert.match(result.warning, /Rétrécissement/);
        assert.ok(result.warningBounds[0] < 915 * 0.8 && result.warningBounds[1] < 412 * 0.25, 'warning is not a full-screen covering');
      }
      if (s === 423) assert.doesNotMatch(result.warning, /Rétrécissement/, 'normal nearest-hazard change after passing');
    }
  }
  assert.deepEqual(report.pageErrors, []); assert.deepEqual(report.failedRequests, []);
  report.result = 'PASS';
  console.log('PASS — narrowing, finite HDR/bloom, complete frame through adaptive resolution, no window resize');
} finally {
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
  await browser?.close(); await new Promise(done => server.close(done));
}
