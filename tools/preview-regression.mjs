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
await page.locator('#pauseBtn').click();
await page.locator('#quitBtn').click();
assert.equal(await page.evaluate(() => window.__tka.state.screen), 'menu', 'menu principal action failed');
assert.equal(await page.evaluate(() => window.__tka.engine()), null, 'menu action left a live engine');

assert.ok(await page.locator('#pauseBtn').isVisible());
assert.equal(errors.length, 0, `browser errors: ${errors.join(' | ')}`);
console.log('PASS: responsive HUD, pause/freeze/resume, P key, visibility auto-pause, multi-pointer independent release; 0 browser errors.');
await browser.close();
