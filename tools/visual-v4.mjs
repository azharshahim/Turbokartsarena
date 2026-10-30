/** Genuine game renders, same viewport/inputs on the published V3 and working V4.
 * Run after building both trees. Gift closeup uses the engine's actual scene and camera.
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, stat, mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import assert from 'node:assert/strict';
const root = resolve('.');
const server = createServer(async (req, res) => {
  try {
    let file = resolve(root, '.' + new URL(req.url, 'http://localhost').pathname);
    if (!file.startsWith(root + sep)) { res.writeHead(403).end(); return; }
    if ((await stat(file)).isDirectory()) file += '/index.html';
    res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' })[extname(file)] ?? 'application/octet-stream');
    res.end(await readFile(file));
  } catch { res.writeHead(404).end(); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
let browser;
const manifest = [];
try {
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  for (const [version, path] of [['v3', '/.preview/v3/index.html'], ['v4', '/index.html']]) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await mkdir(`.preview/comparison/${version}`, { recursive: true });
    const go = async () => { await page.goto(`http://127.0.0.1:${server.address().port}${path}`); await page.waitForFunction(() => !!window.__tka); };
    const shot = async name => {
      await page.screenshot({ path: `.preview/comparison/${version}/${name}.png`, timeout: 60000 });
      manifest.push({ version, subject: name, renderer: 'actual Three.js game / showroom, SwiftShader', viewport: '1280x800' });
    };
    await go(); await shot('accueil');
    await page.locator('#garageCanvas').scrollIntoViewIfNeeded();
    await page.locator('#garageCanvas').screenshot({ path: `.preview/comparison/${version}/kart.png` });
    for (let i = 0; i < 4; i++) await page.click('#vehicleNext');
    await page.waitForTimeout(200);
    await page.locator('#garageCanvas').screenshot({ path: `.preview/comparison/${version}/moto.png` });
    if (version === 'v4') {
      await page.click('#openGarage');
      await page.waitForTimeout(200); await shot('garage');
      await page.getByRole('button', { name: 'BOUTIQUE', exact: true }).click();
      await page.getByRole('button', { name: /^Falcon K2/ }).click();
      assert.match(await page.locator('#premiumName').textContent(), /Falcon/);
      assert.equal(await page.locator('#premiumBuy').isDisabled(), true, 'insufficient coins');
      await page.getByRole('button', { name: 'MES VÉHICULES', exact: true }).click();
      await page.getByRole('button', { name: /^Apex R4/ }).click();
      await page.getByRole('button', { name: 'AMÉLIORATIONS', exact: true }).click();
      assert.equal(await page.locator('#premiumList button').count(), 7);
      await page.locator('#premiumList button').first().click();
      assert.match(await page.locator('#premiumList button').first().textContent(), /1\/5/);
      await page.click('#closeGarage');
    } else await shot('garage');
    for (const [name, circuit] of [['desert', 5], ['tropical', 10], ['neige', 8], ['cadeau', 0], ['volcanique', 11], ['urbain', 4]]) {
      await go();
      await page.evaluate(circuit => window.__tka.start({ circuit, vehicle: 0, quality: 'ultra' }), circuit);
      await page.waitForFunction(() => !!window.__tka.engine());
      await page.evaluate(() => {
        window.__tka.pauseLoop(); window.__tka.skipCountdown();
        window.__tka.setAutopilot(true); window.__tka.step(180, 16.67);
      });
      if (name === 'cadeau') await page.evaluate(() => {
        const e = window.__tka.engine(), gift = e.giftMeshes[0];
        if (!gift) throw new Error('No actual gift mesh');
        gift.visible = true;
        e.camera.position.copy(gift.position).add({ x: 3, y: 2, z: 4 });
        e.camera.lookAt(gift.position);
        e.renderer.render(e.scene, e.camera);
      });
      assert.ok(await page.evaluate(() => window.__tka.engine().renderer.info.render.triangles > 0), `${version}/${name}: actual triangles rendered`);
      await shot(name);
    }
    assert.deepEqual(errors, [], `${version}: browser exceptions`);
    await context.close();
  }
  await writeFile('.preview/comparison/manifest.json', JSON.stringify(manifest, null, 2));
  console.log('Captures comparatives enregistrées ; revue visuelle humaine encore nécessaire.');
} finally { await browser?.close(); await new Promise(done => server.close(done)); }
