/**
 * Mission nº12 — audit navigateur des commandes en paysage Android.
 *
 * Complète `browser-mission11.mjs` (qui valide les comportements) par un audit
 * de CONFORT sur plusieurs écrans réels de téléphones Samsung, puis vérifie que
 * les commandes survivent à une pause et à un changement d'orientation.
 *
 * Mesures faites sur le VRAI DOM (getBoundingClientRect), pas sur un modèle.
 * ⚠️ Chromium en rendu logiciel : ceci ne mesure ni les FPS ni le ressenti.
 */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const target = process.env.BROWSER_TEST_URL || pathToFileURL(resolve('index.html')).href;
const reportDir = process.env.AUDIT_DIR || '.preview/android-layout';
mkdirSync(reportDir, { recursive: true });

/** Paysages réels (CSS px) : Galaxy S23/S24, A-series, S Ultra, tablette. */
const VIEWPORTS = [
  { name: 'S23/S24 paysage', width: 915, height: 412, dpr: 2.6, notch: 34 },
  { name: 'Galaxy A54 paysage', width: 851, height: 393, dpr: 2.6, notch: 32 },
  { name: 'Petit écran paysage', width: 800, height: 360, dpr: 2, notch: 24 },
  { name: 'S Ultra paysage', width: 960, height: 412, dpr: 3.5, notch: 38 },
  { name: 'Tablette paysage', width: 1280, height: 800, dpr: 2, notch: 0 },
];

const CONTROL_IDS = ['leftBtn', 'rightBtn', 'fireBtn', 'turboBtn', 'brakeBtn', 'driftBtn', 'pauseBtn'];
const HUD_IDS = ['minimap', 'places', 'speedo', 'accelBtn'];
const MIN_TARGET = 44;
const MIN_EDGE = 8;

const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--allow-file-access-from-files'],
});

const results = [];
try {
  const context = await browser.newContext({ viewport: { width: 915, height: 412 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto(target, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__tka);

  /** Mesure les zones et détecte les chevauchements et les bords trop proches. */
  const measure = () =>
    page.evaluate(({ controlIds, hudIds }) => {
      const box = (id) => {
        const element = document.getElementById(id);
        if (!element) return null;
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return {
          id,
          x: +rect.x.toFixed(1),
          y: +rect.y.toFixed(1),
          width: +rect.width.toFixed(1),
          height: +rect.height.toFixed(1),
          right: +rect.right.toFixed(1),
          bottom: +rect.bottom.toFixed(1),
          visible: rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden',
        };
      };
      return {
        width: innerWidth,
        height: innerHeight,
        portrait: innerHeight > innerWidth,
        controls: controlIds.map(box).filter(Boolean),
        hud: hudIds.map(box).filter(Boolean),
        touchAction: getComputedStyle(document.getElementById('leftBtn')).touchAction,
      };
    }, { controlIds: CONTROL_IDS, hudIds: HUD_IDS });

  const overlaps = (a, b) => a.x < b.right && b.x < a.right && a.y < b.bottom && b.y < a.bottom;

  for (const viewport of VIEWPORTS) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.evaluate(() => window.__tka.quit());
    await page.waitForTimeout(120);
    await page.evaluate((quality) => window.__tka.start({ circuit: 0, quality }), 'low');
    await page.waitForFunction(() => !!window.__tka.engine(), { timeout: 30000 });
    await page.evaluate(() => {
      window.__tka.pauseLoop();
      window.__tka.skipCountdown();
      window.__tka.step(30, 16.67);
    });

    const layout = await measure();
    const visible = layout.controls.filter((c) => c.visible);
    const problems = [];

    assert.equal(visible.length, CONTROL_IDS.length, `${viewport.name} : ${visible.length}/${CONTROL_IDS.length} commandes visibles`);
    for (const control of visible) {
      if (control.width < MIN_TARGET || control.height < MIN_TARGET) {
        problems.push(`${control.id} trop petit (${control.width}×${control.height})`);
      }
      const margins = [control.x, control.y, layout.width - control.right, layout.height - control.bottom];
      if (Math.min(...margins) < MIN_EDGE) problems.push(`${control.id} trop près du bord (${Math.min(...margins).toFixed(1)} px)`);
    }
    for (let i = 0; i < visible.length; i += 1) {
      for (let j = i + 1; j < visible.length; j += 1) {
        if (overlaps(visible[i], visible[j])) problems.push(`${visible[i].id} chevauche ${visible[j].id}`);
      }
    }
    // Les zones tactiles ne doivent pas recouvrir une information utile du HUD.
    for (const control of visible) {
      for (const hud of layout.hud.filter((h) => h.visible)) {
        if (overlaps(control, hud)) problems.push(`${control.id} masque ${hud.id}`);
      }
    }
    // Le cluster de direction et le cluster d'actions ne se croisent pas.
    const left = visible.find((c) => c.id === 'leftBtn');
    const right = visible.find((c) => c.id === 'rightBtn');
    const turbo = visible.find((c) => c.id === 'turboBtn');
    if (left && turbo && left.right > turbo.x - 100) problems.push('les clusters de pouce se rapprochent trop');

    assert.deepEqual(problems, [], `${viewport.name} : ${problems.join(' ; ')}`);
    assert.equal(layout.touchAction, 'none', `${viewport.name} : touch-action doit bloquer le zoom`);

    results.push({
      viewport: viewport.name,
      screen: `${layout.width}×${layout.height}`,
      status: 'PASS',
      controls: Object.fromEntries(visible.map((c) => [c.id, `${c.width}×${c.height}@${c.x},${c.y}`])),
    });

    if (viewport.name === 'S23/S24 paysage') {
      // Pause → reprise : les commandes restent opérationnelles.
      await page.evaluate(() => window.__tka.resumeLoop());
      await page.locator('#pauseBtn').click();
      await page.waitForTimeout(150);
      assert.equal(await page.locator('#pause').isVisible(), true, 'pause non affichée');
      await page.locator('#resumeBtn').click();
      await page.waitForTimeout(150);
      await page.evaluate(() => window.__tka.pauseLoop());
      await page.locator('#leftBtn').dispatchEvent('pointerdown', { pointerId: 1, pointerType: 'touch', isPrimary: true });
      await page.waitForTimeout(60);
      const steerAfterPause = await page.evaluate(() => window.__tka.currentSteer());
      await page.locator('#leftBtn').dispatchEvent('pointerup', { pointerId: 1, pointerType: 'touch', isPrimary: true });
      assert.equal(steerAfterPause, -1, 'direction inopérante après une pause');

      // Rotation paysage → portrait → paysage : géométrie recalculée, commandes vivantes.
      await page.setViewportSize({ width: 412, height: 915 });
      await page.waitForTimeout(250);
      const portrait = await measure();
      assert.equal(portrait.portrait, true, 'rotation portrait non détectée');
      await page.setViewportSize({ width: 915, height: 412 });
      await page.waitForTimeout(250);
      const back = await measure();
      const backVisible = back.controls.filter((c) => c.visible);
      assert.equal(backVisible.length, CONTROL_IDS.length, 'commandes perdues après retour en paysage');
      for (const control of backVisible) {
        assert.ok(control.width >= MIN_TARGET && control.height >= MIN_TARGET, `${control.id} trop petit après rotation`);
      }
      await page.locator('#rightBtn').dispatchEvent('pointerdown', { pointerId: 2, pointerType: 'touch', isPrimary: true });
      await page.waitForTimeout(60);
      assert.equal(await page.evaluate(() => window.__tka.currentSteer()), 1, 'direction inopérante après rotation');
      await page.locator('#rightBtn').dispatchEvent('pointerup', { pointerId: 2, pointerType: 'touch', isPrimary: true });

      // Deux doigts simultanés sur des zones différentes.
      await page.locator('#rightBtn').dispatchEvent('pointerdown', { pointerId: 3, pointerType: 'touch', isPrimary: true });
      await page.locator('#driftBtn').dispatchEvent('pointerdown', { pointerId: 4, pointerType: 'touch' });
      await page.waitForTimeout(80);
      const combined = await page.evaluate(() => ({ steer: window.__tka.currentSteer(), drift: window.__tka.currentDrift() }));
      await page.locator('#rightBtn').dispatchEvent('pointerup', { pointerId: 3, pointerType: 'touch', isPrimary: true });
      await page.locator('#driftBtn').dispatchEvent('pointerup', { pointerId: 4, pointerType: 'touch' });
      assert.deepEqual(combined, { steer: 1, drift: true }, 'multi-touch simultané cassé');

      // Le bouton TIR est présent, lisible et n'échoue pas au clic.
      await page.locator('#fireBtn').click();
      await page.waitForTimeout(80);

      // Accélération manuelle : le bouton GAZ apparaît sans chevaucher les autres zones.
      await page.evaluate(() => window.__tka.cycleThrottleMode());
      await page.waitForTimeout(150);
      assert.equal(await page.evaluate(() => window.__tka.controls().throttleMode), 'manual', 'mode manuel non appliqué');
      const manual = await page.evaluate(() => {
        const ids = ['leftBtn', 'rightBtn', 'accelBtn', 'fireBtn', 'turboBtn', 'brakeBtn', 'driftBtn'];
        return ids.map((id) => {
          const element = document.getElementById(id);
          const rect = element.getBoundingClientRect();
          return { id, x: rect.x, y: rect.y, width: rect.width, height: rect.height, right: rect.right, bottom: rect.bottom, visible: rect.width > 0 && rect.height > 0 };
        }).filter((c) => c.visible);
      });
      assert.equal(manual.length, 7, 'bouton GAZ absent en mode manuel');
      for (const control of manual) {
        assert.ok(control.width >= MIN_TARGET && control.height >= MIN_TARGET, `${control.id} trop petit en mode manuel (${control.width.toFixed(0)}×${control.height.toFixed(0)})`);
      }
      for (let i = 0; i < manual.length; i += 1) {
        for (let j = i + 1; j < manual.length; j += 1) {
          assert.ok(!overlaps(manual[i], manual[j]), `${manual[i].id} chevauche ${manual[j].id} en mode manuel`);
        }
      }
      await page.evaluate(() => window.__tka.cycleThrottleMode());
    }
  }

  assert.deepEqual(errors, [], `erreurs navigateur : ${errors.join(' ; ')}`);

  writeFileSync(`${reportDir}/landscape-audit.json`, JSON.stringify({ results, errors }, null, 2));
  console.log(JSON.stringify(results, null, 1));
  console.log('\nPASS Mission 12 (navigateur) : commandes confortables sur 5 écrans paysage, pause et rotation validées.');
} finally {
  await browser.close();
}
