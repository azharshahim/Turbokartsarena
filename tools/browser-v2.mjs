import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, stat, mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { performance } from 'node:perf_hooks';
import { chromium } from 'playwright';
const root = resolve('.'),
  types = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.webmanifest': 'application/manifest+json',
  };
const server = createServer(async (req, res) => {
  try {
    let path = resolve(root, '.' + new URL(req.url, 'http://localhost').pathname);
    if (path !== root && !path.startsWith(root + sep)) {
      res.writeHead(403).end();
      return;
    }
    if ((await stat(path)).isDirectory()) path += '/index.html';
    res.writeHead(200, { 'Content-Type': types[extname(path)] ?? 'application/octet-stream' });
    res.end(await readFile(path));
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const results = [];
try {
  const context = await browser.newContext({
    viewport: { width: 915, height: 412 },
    isMobile: true,
    hasTouch: true,
    serviceWorkers: 'block',
  });
  const page = await context.newPage();
  page.setDefaultTimeout(60000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);
  await page.waitForFunction(() => !!window.__tka);
  await mkdir('.preview/v2-captures', { recursive: true });
  assert.equal(await page.evaluate(() => window.__tka.drivers.length), 12);
  for (let i = 0; i < 12; i++) {
    assert.equal(
      await page.locator('#driverName').textContent(),
      await page.evaluate((i) => window.__tka.drivers[i].name, i),
    );
    await page.locator('#driverNext').click();
  }
  await page.locator('#qualityToggle').click(); // Auto -> Low for mobile budgets.
  await page.locator('#difficultyToggle').click(); // Arcade -> Expert.
  assert.match(await page.locator('#difficultyToggle').textContent(), /Expert/);
  for (let i = 0; i < 8; i++) {
    const name = await page.evaluate((i) => window.__tka.vehicles[i].name, i);
    assert.equal(await page.locator('#vehicleName').textContent(), name);
    await page.screenshot({ path: `.preview/v2-captures/garage-${i}.png` });
    // Click the real start control, after selecting real menu entries.
    await page.locator('#playBtn').click();
    await page.waitForFunction(() => !!window.__tka.engine(), { timeout: 60000 });
    const start = performance.now();
    const data = await page.evaluate(() => {
      const t = window.__tka,
        e = t.engine();
      t.pauseLoop();
      t.skipCountdown();
      t.setAutopilot(true);
      t.step(8, 16.67, true);
      const positions = e.race.karts.map((k) => ({ x: k.state.x, z: k.state.z }));
      return {
        vehicle: e.player.profile.vehicleId,
        circuit: e.circuit.id,
        drivers: e.race.karts.length,
        aiSpeed: e.race.aiSpeed,
        stats: e.stats,
        positions,
        hazards: e.roadside.hazards.length,
        model: e.scene.children.some((o) => o.userData.vehicleId === e.player.profile.vehicleId),
      };
    });
    const elapsed = performance.now() - start;
    assert.equal(data.vehicle, await page.evaluate((i) => window.__tka.vehicles[i].id, i));
    assert.equal(data.circuit, await page.evaluate((i) => window.__tka.circuits[i].id, i));
    assert.equal(data.aiSpeed, 1.06);
    assert.ok(data.model);
    assert.ok(data.stats.drawCalls > 0 && data.stats.triangles > 1000);
    assert.ok(
      data.stats.drawCalls <= 220 && data.stats.triangles < 250000,
      'low quality rendering budget exceeded',
    );
    assert.ok(data.hazards > 0);
    assert.ok(data.positions.every((p) => Number.isFinite(p.x) && Number.isFinite(p.z)));
    await page.dispatchEvent('#leftBtn', 'pointerdown', { pointerId: 101, pointerType: 'touch', button: 0 });
    await page.dispatchEvent('#driftBtn', 'pointerdown', { pointerId: 102, pointerType: 'touch', button: 0 });
    assert.deepEqual(await page.evaluate(() => [window.__tka.currentSteer(), window.__tka.currentDrift()]), [
      -1,
      true,
    ]);
    await page.dispatchEvent('#leftBtn', 'pointerup', { pointerId: 101, pointerType: 'touch', button: 0 });
    assert.deepEqual(await page.evaluate(() => [window.__tka.currentSteer(), window.__tka.currentDrift()]), [
      0,
      true,
    ]);
    await page.dispatchEvent('#driftBtn', 'pointercancel', {
      pointerId: 102,
      pointerType: 'touch',
      button: 0,
    });
    assert.equal(await page.evaluate(() => window.__tka.currentDrift()), false);
    // Verify a visible warning is tied to a real feature's distance.
    const label = await page.evaluate(() => {
      const t = window.__tka,
        e = t.engine(),
        hazard = e.roadside.hazards[0];
      e.player.state.s = (hazard.s - 25 + e.race.track.length) % e.race.track.length;
      t.updateHud();
      return e.stats.hazard.hazard.label;
    });
    assert.ok((await page.locator('#hazardWarning').textContent()).includes(label));
    await page.screenshot({ path: `.preview/v2-captures/race-${i}.png` });
    results.push({
      vehicle: name,
      circuit: data.circuit,
      quality: 'low',
      drawCalls: data.stats.drawCalls,
      triangles: data.stats.triangles,
      softwareMsPerFrame: +(elapsed / 8).toFixed(1),
    });
    console.log(
      `PASS ${name} / ${data.circuit}: model rendered, live warning, Expert AI and finite simulation.`,
    );
    await page.locator('#pauseBtn').click();
    const frozenTime = await page.evaluate(() => window.__tka.engine().race.raceTime);
    await page.evaluate(() => window.__tka.step(10, 16.67));
    assert.equal(await page.evaluate(() => window.__tka.engine().race.raceTime), frozenTime);
    await page.locator('#resumeBtn').click();
    await page.evaluate(() => {
      window.__tka.pauseLoop();
      window.__tka.step(2, 16.67);
    });
    assert.ok(await page.evaluate((t) => window.__tka.engine().race.raceTime > t, frozenTime));
    await page.locator('#pauseBtn').click();
    await page.locator('#restartBtn').click();
    await page.evaluate(() => window.__tka.pauseLoop());
    assert.equal(await page.evaluate(() => window.__tka.engine().race.phase), 'countdown');
    assert.equal(await page.evaluate(() => window.__tka.engine().player.profile.vehicleId), data.vehicle);
    await page.evaluate(() => window.__tka.quit());
    if (i < 7) {
      await page.locator('#vehicleNext').click();
      await page.locator('#circNext').click();
    }
  }
  await page.setViewportSize({ width: 412, height: 915 });
  assert.equal(await page.evaluate(() => document.body.scrollWidth <= innerWidth), true);
  assert.ok(await page.locator('#playBtn').isVisible());
  await page.screenshot({ path: '.preview/v2-captures/portrait.png' });
  assert.deepEqual(errors, []);
  await context.close();
  await writeFile(
    '.preview/v2-performance.json',
    JSON.stringify(
      {
        renderer: 'Chromium / ANGLE SwiftShader software rendering, cloud CPU; not Android performance',
        results,
      },
      null,
      2,
    ) + '\n',
  );
  console.log(
    'PASS 12 drivers, 8 vehicle/circuit render cases, all menu controls, mobile layout, zero browser errors.',
  );
} finally {
  await browser.close();
  await new Promise((done) => server.close(done));
}
