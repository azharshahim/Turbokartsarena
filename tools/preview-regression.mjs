/** Régressions navigateur : pause, reprise, commandes Pointer Events multi-doigts, géométrie responsive. */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--allow-file-access-from-files'],
});
const page = await browser.newPage({ viewport: { width: 915, height: 412 }, isMobile: true, hasTouch: true });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.route('**/*', (route) => route.request().url().startsWith('file://') ? route.continue() : route.abort());
await page.goto(pathToFileURL(resolve('index.html')).href, { waitUntil: 'load' });
await page.waitForFunction(() => !!window.__tka);
assert.equal(await page.locator('#pauseBtn').innerText().then((s) => s.includes('PAUSE')), true, 'bouton pause absent');
const controls = await page.evaluate(() => {
  const box = (id) => { const r = document.getElementById(id).getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; };
  return { left: box('leftBtn'), right: box('rightBtn'), drift: box('driftBtn'), brake: box('brakeBtn'), action: getComputedStyle(document.getElementById('leftBtn')).touchAction };
});
assert.ok(controls.left.x < controls.right.x && controls.right.x + controls.right.w < 0.45 * 915, 'direction buttons are not in the left thumb zone');
assert.ok(controls.drift.x > 0.65 * 915 && controls.brake.x > 0.5 * 915, 'action buttons are not on the right');
assert.equal(controls.action, 'none', 'touch-action should prevent page gestures over controls');

await page.evaluate(() => window.__tka.start({ circuit: 0, quality: 'low' }));
await page.waitForFunction(() => !!window.__tka.engine(), { timeout: 20000 });
await page.evaluate(() => {
  window.__tka.pauseLoop();
  window.__tka.skipCountdown();
  window.__tka.step(150, 16.67);
});
const beforePause = await page.evaluate(() => {
  const e = window.__tka.engine();
  return { time: e.race.raceTime, phase: e.race.phase, lap: e.player.state.lap, x: e.player.state.x, z: e.player.state.z };
});
assert.equal(beforePause.phase, 'racing', 'test did not reach racing phase');

// Real UI pause and a delayed verification: no Race.update, kart movement, timer or lap change.
await page.locator('#pauseBtn').click();
assert.equal(await page.evaluate(() => window.__tka.state.paused), true, 'pause button did not pause');
await page.waitForTimeout(250);
const frozen = await page.evaluate(() => {
  const e = window.__tka.engine();
  return { time: e.race.raceTime, lap: e.player.state.lap, x: e.player.state.x, z: e.player.state.z };
});
assert.equal(frozen.time, beforePause.time, 'race clock advanced while paused');
assert.equal(frozen.lap, beforePause.lap, 'lap changed while paused');
assert.equal(frozen.x, beforePause.x, 'player moved while paused');
assert.equal(frozen.z, beforePause.z, 'player moved while paused');

// Resume via the menu. It must preserve the same engine and race state.
await page.locator('#resumeBtn').click();
assert.equal(await page.evaluate(() => window.__tka.state.paused), false, 'resume did not unpause');
assert.ok(await page.evaluate(() => !!window.__tka.engine()), 'engine missing after resume');
await page.evaluate(() => { window.__tka.pauseLoop(); window.__tka.step(60, 16.67); });
const resumedTime = await page.evaluate(() => window.__tka.engine().race.raceTime);
assert.ok(resumedTime > beforePause.time + 0.7, 'race clock did not advance after resume');

// Simultaneous pointers and independent releases (left/right + drift/brake).
await page.dispatchEvent('#leftBtn', 'pointerdown', { pointerId: 31, pointerType: 'touch', isPrimary: true, button: 0 });
await page.dispatchEvent('#driftBtn', 'pointerdown', { pointerId: 32, pointerType: 'touch', isPrimary: false, button: 0 });
assert.equal(await page.evaluate(() => window.__tka.currentSteer()), -1, 'left pointer not held');
assert.equal(await page.evaluate(() => window.__tka.currentDrift()), true, 'drift pointer not held simultaneously');
await page.dispatchEvent('#leftBtn', 'pointerup', { pointerId: 31, pointerType: 'touch', button: 0 });
assert.equal(await page.evaluate(() => window.__tka.currentSteer()), 0, 'left release not applied');
assert.equal(await page.evaluate(() => window.__tka.currentDrift()), true, 'left release incorrectly released drift');
await page.dispatchEvent('#driftBtn', 'pointercancel', { pointerId: 32, pointerType: 'touch', button: 0 });
assert.equal(await page.evaluate(() => window.__tka.currentDrift()), false, 'pointercancel left drift stuck');
await page.dispatchEvent('#leftBtn', 'pointerdown', { pointerId: 41, pointerType: 'touch', isPrimary: true, button: 0 });
await page.dispatchEvent('#rightBtn', 'pointerdown', { pointerId: 42, pointerType: 'touch', isPrimary: false, button: 0 });
assert.equal(await page.evaluate(() => window.__tka.currentSteer()), 0, 'opposite thumbs should neutralize steering');
await page.dispatchEvent('#leftBtn', 'pointerup', { pointerId: 41, pointerType: 'touch', button: 0 });
assert.equal(await page.evaluate(() => window.__tka.currentSteer()), 1, 'releasing left incorrectly cleared still-held right');
await page.dispatchEvent('#rightBtn', 'pointerup', { pointerId: 42, pointerType: 'touch', button: 0 });
assert.equal(await page.evaluate(() => window.__tka.currentSteer()), 0, 'right release not applied');

// Keyboard steer/drift coexist, and pause clears keys held before the pause.
await page.keyboard.down('ArrowLeft');
await page.keyboard.down(' ');
assert.equal(await page.evaluate(() => window.__tka.currentSteer()), -1, 'keyboard left regressed');
assert.equal(await page.evaluate(() => window.__tka.currentDrift()), true, 'keyboard drift regressed');
await page.locator('#pauseBtn').click();
assert.equal(await page.evaluate(() => window.__tka.state.paused), true, 'HUD pause failed with held keyboard input');
assert.deepEqual(await page.evaluate(() => [window.__tka.currentSteer(), window.__tka.currentDrift(), window.__tka.currentBrake()]), [0, false, false], 'keyboard input survived pause');
await page.keyboard.up('ArrowLeft');
await page.keyboard.up(' ');
await page.locator('#resumeBtn').click();

// P still works, and a page background/visibility loss auto-pauses and neutralizes controls.
await page.keyboard.press('p');
assert.equal(await page.evaluate(() => window.__tka.state.paused), true, 'P did not pause');
await page.evaluate(() => {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
  document.dispatchEvent(new Event('visibilitychange'));
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
  document.dispatchEvent(new Event('visibilitychange'));
});
assert.equal(await page.evaluate(() => window.__tka.state.paused), true, 'page visibility unexpectedly auto-resumed the race');
await page.keyboard.press('p');
assert.equal(await page.evaluate(() => window.__tka.state.paused), false, 'P did not resume');
assert.deepEqual(await page.evaluate(() => [window.__tka.currentSteer(), window.__tka.currentDrift(), window.__tka.currentBrake()]), [0, false, false], 'held input survived pause/background');

// In portrait, the browser build asks the player to rotate; landscape stays unobstructed.
await page.setViewportSize({ width: 412, height: 915 });
assert.equal(await page.locator('#rotateNotice').evaluate((el) => getComputedStyle(el).display), 'flex', 'portrait rotation guidance missing');
await page.setViewportSize({ width: 915, height: 412 });
assert.equal(await page.locator('#rotateNotice').evaluate((el) => getComputedStyle(el).display), 'none', 'rotation notice should disappear in landscape');

// Restart from pause resets only when explicitly requested; main menu disposes the engine.
await page.locator('#pauseBtn').click();
await page.locator('#restartBtn').click();
assert.equal(await page.evaluate(() => window.__tka.state.paused), false, 'restart did not close pause');
assert.equal(await page.evaluate(() => window.__tka.engine().race.phase), 'countdown', 'restart did not restart countdown');
assert.ok(await page.evaluate(() => window.__tka.engine().race.raceTime) < 0.1, 'restart did not reset the race clock');

await page.evaluate(() => {
  window.__tka.pauseLoop();
  window.__tka.skipCountdown();
  window.__tka.engine().resetFrameClock();
  window.__tka.step(4, 16.67);
});

// Repeated pause/resume cycles must never stack duplicate requestAnimationFrame loops.
const cycleStats = await page.evaluate(async () => {
  const pausedRaf = [];
  const resumedRaf = [];
  for (let cycle = 0; cycle < 5; cycle++) {
    document.getElementById('pauseBtn').click();
    pausedRaf.push([window.__tka.state.paused, window.__tka.rafActive()]);
    document.getElementById('resumeBtn').click();
    resumedRaf.push([window.__tka.state.paused, window.__tka.rafActive()]);
  }
  const t0 = window.__tka.engine().race.raceTime;
  const p0 = performance.now();
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r))));
  const wallSec = (performance.now() - p0) / 1000;
  const simSec = window.__tka.engine().race.raceTime - t0;
  window.__tka.pauseLoop();
  return { pausedRaf, resumedRaf, wallSec, simSec };
});
for (let cycle = 0; cycle < 5; cycle++) {
  assert.deepEqual(cycleStats.pausedRaf[cycle], [true, false], `cycle ${cycle}: pause left rAF active`);
  assert.deepEqual(cycleStats.resumedRaf[cycle], [false, true], `cycle ${cycle}: resume did not arm rAF`);
}
assert.ok(cycleStats.simSec <= Math.max(0.25, cycleStats.wallSec * 1.5), `duplicate rAF suspected: sim=${cycleStats.simSec.toFixed(3)}s wall=${cycleStats.wallSec.toFixed(3)}s`);

// Global touchcancel, Shift+letter keyup case mismatch, and window blur/focus must leave controls neutral.
await page.dispatchEvent('#leftBtn', 'pointerdown', { pointerId: 51, pointerType: 'touch', isPrimary: true, button: 0 });
await page.dispatchEvent('#driftBtn', 'pointerdown', { pointerId: 52, pointerType: 'touch', isPrimary: false, button: 0 });
assert.deepEqual(await page.evaluate(() => [window.__tka.currentSteer(), window.__tka.currentDrift()]), [-1, true]);
await page.evaluate(() => window.dispatchEvent(new Event('touchcancel')));
assert.deepEqual(
  await page.evaluate(() => [
    window.__tka.currentSteer(),
    window.__tka.currentDrift(),
    document.getElementById('leftBtn').classList.contains('active'),
    document.getElementById('driftBtn').classList.contains('active'),
  ]),
  [0, false, false, false],
  'window touchcancel did not clear active pointers and visual classes',
);

await page.evaluate(() => {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift' }));
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'D' }));
  window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Shift' }));
  window.dispatchEvent(new KeyboardEvent('keyup', { key: 'd' }));
});
assert.deepEqual(
  await page.evaluate(() => [window.__tka.currentSteer(), window.__tka.currentDrift(), window.__tka.keys.size]),
  [0, false, 0],
  'Shift+D followed by Shift release left uppercase key stuck',
);

await page.dispatchEvent('#rightBtn', 'pointerdown', { pointerId: 61, pointerType: 'touch', isPrimary: true, button: 0 });
await page.dispatchEvent('#brakeBtn', 'pointerdown', { pointerId: 62, pointerType: 'touch', isPrimary: false, button: 0 });
await page.evaluate(() => window.dispatchEvent(new Event('blur')));
assert.equal(await page.evaluate(() => window.__tka.state.paused), true, 'window blur did not pause');
assert.deepEqual(await page.evaluate(() => [window.__tka.currentSteer(), window.__tka.currentBrake()]), [0, false], 'blur left controls active');
await page.evaluate(() => window.dispatchEvent(new Event('focus')));
assert.equal(await page.evaluate(() => window.__tka.state.paused), true, 'window focus unexpectedly resumed');
await page.locator('#resumeBtn').click();
await page.evaluate(() => window.__tka.pauseLoop());

// Finishing, pausing before 1400ms, and clicking Restart must NOT trigger stale showResults() 1.4s later.
await page.evaluate(() => {
  window.__tka.pauseLoop();
  window.__tka.setAutopilot(true);
  const eng = window.__tka.engine();
  const st = eng.player.state;
  st.lap = 2;
  st.totalDistance = eng.race.track.length * 3 - 1.2;
  st.speed = 30;
  st.vx = Math.sin(st.heading) * 30;
  st.vz = Math.cos(st.heading) * 30;
  eng.resetFrameClock();
  window.__tka.step(6, 16.67);
});
assert.equal(await page.evaluate(() => window.__tka.engine().race.phase), 'finished', 'autopilot did not reach finished phase');
assert.equal(await page.evaluate(() => window.__tka.hasFinishTimeout()), true, 'finishTimeout was not armed on finish');
await page.locator('#pauseBtn').click();
assert.equal(await page.evaluate(() => window.__tka.hasFinishTimeout()), false, 'pause did not cancel finishTimeout');
await page.locator('#restartBtn').click();
assert.equal(await page.evaluate(() => window.__tka.state.paused), false, 'post-finish restart stayed paused');
assert.equal(await page.evaluate(() => window.__tka.rafActive()), true, 'post-finish restart did not arm rAF');
assert.equal(await page.evaluate(() => window.__tka.engine().race.phase), 'countdown', 'post-finish restart did not reset phase');
assert.equal(await page.evaluate(() => window.__tka.hasFinishTimeout()), false, 'post-finish restart re-armed finishTimeout');
await page.evaluate(() => window.__tka.pauseLoop());
await page.waitForTimeout(1550);
assert.equal(await page.evaluate(() => window.__tka.state.screen), 'race', 'stale finishTimeout killed the restarted race');
assert.ok(await page.evaluate(() => !!window.__tka.engine()), 'engine disposed by stale finishTimeout');

await page.locator('#pauseBtn').click();
await page.locator('#quitBtn').click();
assert.equal(await page.evaluate(() => window.__tka.state.screen), 'menu', 'menu principal action failed');
assert.equal(await page.evaluate(() => window.__tka.engine()), null, 'menu action left a live engine');
assert.equal(await page.evaluate(() => window.__tka.rafActive()), false, 'menu action left an active rAF');

// Menu exit during the 60ms startup loader must cancel startTimeout and never leak an engine/rAF.
await page.evaluate(() => {
  window.__tka.start({ circuit: 1, quality: 'low' });
  window.__tka.quit();
});
await page.waitForTimeout(160);
assert.equal(await page.evaluate(() => window.__tka.state.screen), 'menu', 'abort during startup left menu');
assert.equal(await page.evaluate(() => window.__tka.engine()), null, 'abort during startup leaked an engine');
assert.equal(await page.evaluate(() => window.__tka.rafActive()), false, 'abort during startup leaked a rAF loop');

assert.ok(await page.locator('#pauseBtn').isVisible());
assert.equal(errors.length, 0, `browser errors: ${errors.join(' | ')}`);
console.log('PASS: responsive HUD, pause/freeze/resume, P key, visibility auto-pause, multi-pointer independent release; 0 browser errors.');
await browser.close();
