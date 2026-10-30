/**
 * Mission nº11 — contrôles navigateur de la refonte des commandes (V4.1).
 *
 * Ce script utilise le Chromium fourni à Playwright (CI) ou un binaire local via
 * `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`. Il vérifie sur le VRAI DOM :
 *  - la géométrie des commandes en paysage (cibles, marges sûres, chevauchements) ;
 *  - le bouton TURBO (disponibilité, état actif, jauge) ;
 *  - l'accélération manuelle et le bouton GAZ ;
 *  - le gyroscope : refus propre sans capteur utilisable, activation avec capteur
 *    simulé, calibration, sensibilité, perte de signal, retour aux boutons ;
 *  - l'affichage du numéro de version dans le menu et les diagnostics.
 *
 * Les capteurs sont SIMULÉS : des `DeviceOrientationEvent` sont envoyés depuis la
 * page, avec des poses calculées pour l'angle d'écran réellement rapporté par le
 * navigateur (Chromium mobile émulé annonce 90°). Le CDP
 * `DeviceOrientation.setDeviceOrientationOverride` ne remplit pas beta/gamma dans
 * cet environnement, il n'est donc pas utilisé. Ces tests ne remplacent PAS une
 * validation sur un Samsung réel.
 */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const target = process.env.BROWSER_TEST_URL || pathToFileURL(resolve('index.html')).href;
const captureDir = process.env.CAPTURE_DIR || 'docs/v4.1-captures';
const capture = process.env.CAPTURE !== '0';
if (capture) mkdirSync(captureDir, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--allow-file-access-from-files'],
});

try {
  const context = await browser.newContext({ viewport: { width: 915, height: 412 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.route('**/*', (route) => new URL(route.request().url()).origin === new URL(target).origin ? route.continue() : route.abort());
  await page.goto(target, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__tka);

  /* ---------- 1. Version affichée ---------- */
  const badge = await page.locator('#versionBadge').innerText();
  assert.match(badge, /V4\.1\.0-dev · Build ([0-9a-f]{7}(?:\+local)?|sans-git)/, `badge de version inattendu : ${badge}`);
  const version = await page.evaluate(() => window.__tka.version());
  assert.equal(version.channel, 'dev');
  assert.equal(version.version, '4.1.0');
  assert.ok(version.diagnostics.includes('Build'));
  assert.equal(await page.locator('#steerModeBtn').innerText(), 'GYROSCOPE : DÉSACTIVÉ');
  assert.equal(await page.evaluate(() => window.__tka.controls().throttleMode), 'auto');
  if (capture) {
    await page.screenshot({ path: `${captureDir}/01-menu-commandes.png` });
    // Bas du menu : boutons de commande et badge de version.
    await page.evaluate(() => {
      const menu = document.getElementById('menu');
      menu.scrollTo(0, menu.scrollHeight);
    });
    await page.waitForTimeout(150);
    await page.screenshot({ path: `${captureDir}/01b-menu-commandes-bas.png` });
    await page.evaluate(() => document.getElementById('menu').scrollTo(0, 0));
  }

  /* ---------- 2. Géométrie des commandes en paysage ---------- */
  await page.evaluate(() => window.__tka.start({ circuit: 0, quality: 'low' }));
  await page.waitForFunction(() => !!window.__tka.engine(), { timeout: 30000 });
  await page.evaluate(() => {
    window.__tka.pauseLoop();
    window.__tka.skipCountdown();
    window.__tka.step(60, 16.67);
  });

  const layout = await page.evaluate(() => {
    const ids = ['leftBtn', 'rightBtn', 'fireBtn', 'turboBtn', 'brakeBtn', 'driftBtn', 'pauseBtn', 'speedo'];
    const boxes = {};
    for (const id of ids) {
      const el = document.getElementById(id);
      const r = el.getBoundingClientRect();
      boxes[id] = { x: r.x, y: r.y, w: r.width, h: r.height, right: r.right, bottom: r.bottom, visible: r.width > 0 && r.height > 0 };
    }
    return { boxes, w: innerWidth, h: innerHeight, touchAction: getComputedStyle(document.getElementById('turboBtn')).touchAction };
  });

  for (const id of ['leftBtn', 'rightBtn', 'turboBtn', 'brakeBtn', 'driftBtn']) {
    const b = layout.boxes[id];
    assert.ok(b.visible, `${id} invisible`);
    assert.ok(b.w >= 44 && b.h >= 44, `${id} trop petit (${b.w.toFixed(0)}×${b.h.toFixed(0)})`);
    assert.ok(b.x >= 6 && b.y >= 6 && b.right <= layout.w - 6 && b.bottom <= layout.h - 6, `${id} collé au bord`);
  }
  assert.equal(layout.touchAction, 'none', 'touch-action doit neutraliser les gestes de page');
  // Direction à gauche, actions à droite : deux pouces indépendants.
  assert.ok(layout.boxes.rightBtn.right < layout.w * 0.45, 'la direction n’est pas dans la zone du pouce gauche');
  assert.ok(layout.boxes.driftBtn.x > layout.w * 0.6, 'le dérapage n’est pas à droite');
  assert.ok(layout.boxes.turboBtn.x > layout.w * 0.5, 'le turbo n’est pas à droite');
  // Aucun bouton ne recouvre un autre bouton.
  const buttons = ['leftBtn', 'rightBtn', 'fireBtn', 'turboBtn', 'brakeBtn', 'driftBtn', 'pauseBtn'];
  for (const a of buttons) {
    for (const b of buttons) {
      if (a >= b) continue;
      const A = layout.boxes[a], B = layout.boxes[b];
      const overlap = A.x < B.right && B.x < A.right && A.y < B.bottom && B.y < A.bottom;
      assert.ok(!overlap, `${a} recouvre ${b}`);
    }
  }
  // Le compteur de vitesse ne doit masquer aucun bouton.
  {
    const s = layout.boxes.speedo;
    for (const id of buttons) {
      const b = layout.boxes[id];
      const overlap = s.x < b.right && b.x < s.right && s.y < b.bottom && b.y < s.bottom;
      assert.ok(!overlap, `le compteur de vitesse recouvre ${id}`);
    }
  }

  /* ---------- 3. Bouton TURBO : disponibilité, état actif ---------- */
  const turboIdle = await page.evaluate(() => ({
    className: document.getElementById('turboBtn').className,
    label: document.getElementById('turboLabel').textContent,
    chip: document.getElementById('turboChip').textContent,
  }));
  assert.match(turboIdle.label, /TURBO/, `libellé turbo inattendu : ${turboIdle.label}`);
  assert.ok(!turboIdle.className.includes('ready'), 'le turbo est annoncé disponible à l’arrêt');

  // Dérapage + TURBO simultanés : deux doigts, deux zones.
  await page.dispatchEvent('#rightBtn', 'pointerdown', { pointerId: 71, pointerType: 'touch', isPrimary: true, button: 0 });
  await page.dispatchEvent('#driftBtn', 'pointerdown', { pointerId: 72, pointerType: 'touch', isPrimary: false, button: 0 });
  await page.evaluate(() => window.__tka.setInput({ steer: 0.85 }));
  await page.evaluate(() => window.__tka.step(40, 16.67));
  const charged = await page.evaluate(() => ({
    className: document.getElementById('turboBtn').className,
    label: document.getElementById('turboLabel').textContent,
    steer: window.__tka.currentSteer(),
    drift: window.__tka.currentDrift(),
    tier: window.__tka.engine().player.state.driftTier,
  }));
  assert.equal(charged.drift, true, 'dérapage non maintenu');
  assert.equal(charged.steer, 1, 'la direction est perdue pendant le dérapage');
  assert.ok(charged.tier > 0, 'aucune charge de dérapage');
  assert.ok(charged.className.includes('ready'), 'le turbo chargé n’est pas signalé comme disponible');
  assert.match(charged.label, /TURBO \d+%/);
  if (capture) await page.screenshot({ path: `${captureDir}/02-course-turbo-charge.png` });

  await page.dispatchEvent('#turboBtn', 'pointerdown', { pointerId: 73, pointerType: 'touch', isPrimary: false, button: 0 });
  assert.equal(await page.evaluate(() => window.__tka.currentTurbo()), true, 'le bouton turbo ne répond pas');
  await page.evaluate(() => window.__tka.step(3, 16.67));
  const afterTurbo = await page.evaluate(() => ({
    boosting: window.__tka.engine().player.isBoosting,
    label: document.getElementById('turboLabel').textContent,
    chip: document.getElementById('turboChip').textContent,
    mastery: window.__tka.engine().player.state.masteryFlash,
  }));
  assert.equal(afterTurbo.boosting, true, 'le bouton TURBO ne déclenche pas le boost');
  assert.match(afterTurbo.chip, /TURBO|MAÎTRISE/, `état turbo illisible : ${afterTurbo.chip}`);
  await page.dispatchEvent('#turboBtn', 'pointerup', { pointerId: 73, pointerType: 'touch', button: 0 });
  await page.dispatchEvent('#driftBtn', 'pointerup', { pointerId: 72, pointerType: 'touch', button: 0 });
  await page.dispatchEvent('#rightBtn', 'pointerup', { pointerId: 71, pointerType: 'touch', button: 0 });
  await page.evaluate(() => window.__tka.setInput({ steer: 0 }));

  /* ---------- 4. Accélération manuelle ---------- */
  assert.equal(await page.evaluate(() => document.getElementById('accelBtn').offsetParent !== null), false, 'le bouton GAZ est visible en automatique');
  assert.equal(await page.evaluate(() => window.__tka.currentThrottle()), 1, 'accélération automatique inopérante');
  await page.evaluate(() => window.__tka.togglePause(true));
  await page.locator('#pauseThrottleBtn').click();
  assert.equal(await page.evaluate(() => window.__tka.controls().throttleMode), 'manual');
  assert.equal(await page.locator('#pauseThrottleBtn').innerText(), 'ACCÉLÉRATION : MANUELLE');
  await page.locator('#resumeBtn').click();
  assert.equal(await page.evaluate(() => window.__tka.currentThrottle()), 0, 'le mode manuel accélère tout seul');
  assert.equal(await page.evaluate(() => document.getElementById('accelBtn').offsetParent !== null), true, 'bouton GAZ absent en manuel');
  await page.dispatchEvent('#accelBtn', 'pointerdown', { pointerId: 81, pointerType: 'touch', isPrimary: true, button: 0 });
  assert.equal(await page.evaluate(() => window.__tka.currentThrottle()), 1, 'GAZ inopérant');
  await page.dispatchEvent('#accelBtn', 'pointerup', { pointerId: 81, pointerType: 'touch', button: 0 });
  await page.evaluate(() => window.__tka.cycleThrottleMode()); // retour à l'accélération automatique
  assert.equal(await page.evaluate(() => window.__tka.controls().throttleMode), 'auto');

  /* ---------- 5. Gyroscope : refus sans capteur, activation simulée ----------
     Chromium sans capteur émet des `deviceorientation` à beta/gamma nuls : le jeu
     doit refuser proprement. Le capteur est ensuite SIMULÉ par des événements
     DOM (mêmes champs que Chrome Android) : cela valide le câblage et le calcul,
     pas la précision réelle de l'accéléromètre d'un Samsung. */
  const emitOrientation = (beta, gamma) =>
    page.evaluate(
      ([b, g]) => {
        window.dispatchEvent(
          new DeviceOrientationEvent('deviceorientation', { alpha: 0, beta: b, gamma: g, absolute: true }),
        );
      },
      [beta, gamma],
    );
  const startSensorStream = (beta, gamma) =>
    page.evaluate(
      ([b, g]) => {
        // Autorisation SIMULÉE : Chrome récent expose requestPermission (qui
        // exige un geste utilisateur) ; le reste du scénario reste identique.
        DeviceOrientationEvent.requestPermission = async () => 'granted';
        if (window.__sensorTimer) clearInterval(window.__sensorTimer);
        const fire = () =>
          window.dispatchEvent(
            new DeviceOrientationEvent('deviceorientation', { alpha: 0, beta: b, gamma: g, absolute: true }),
          );
        fire();
        window.__sensorTimer = setInterval(fire, 16);
      },
      [beta, gamma],
    );
  const stopSensorStream = () =>
    page.evaluate(() => {
      if (window.__sensorTimer) clearInterval(window.__sensorTimer);
      window.__sensorTimer = null;
    });

  /* Poses physiques correspondant à l'orientation d'écran réelle du navigateur.
     Le Chromium mobile émulé rapporte `screen.orientation.angle === 90` : la pose
     « téléphone tenu normalement » n'est donc pas la même qu'en portrait. */
  const screenAngle = await page.evaluate(() => screen.orientation.angle);
  const NEUTRAL = { 0: { beta: 90, gamma: 0 }, 90: { beta: 0, gamma: -90 }, 180: { beta: -90, gamma: 0 }, 270: { beta: 0, gamma: 90 } };
  const neutral = NEUTRAL[screenAngle] ?? NEUTRAL[0];
  const rollPose = (pose, psiDeg) => {
    const D = Math.PI / 180;
    const [cb, sb] = [Math.cos(pose.beta * D), Math.sin(pose.beta * D)];
    const [cg, sg] = [Math.cos(pose.gamma * D), Math.sin(pose.gamma * D)];
    const M = [
      [cg, 0, sg],
      [sb * sg, cb, -sb * cg],
      [-cb * sg, sb, cb * cg],
    ];
    const [cp, sp] = [Math.cos(psiDeg * D), Math.sin(psiDeg * D)];
    const R = M.map((row) => [row[0] * cp + row[1] * sp, -row[0] * sp + row[1] * cp, row[2]]);
    return {
      beta: (Math.asin(Math.max(-1, Math.min(1, R[2][1]))) / D),
      gamma: (Math.atan2(-R[2][0], R[2][2]) / D),
    };
  };
  const tiltedRight = rollPose(neutral, -14);
  const tiltedLeft = rollPose(neutral, 14);

  await page.evaluate(() => {
    window.__tka.pauseLoop();
    window.__tka.togglePause(true);
  });
  // Aucune donnée exploitable : l'état doit rester DÉSACTIVÉ, sans bloquer la course.
  await page.evaluate(() => window.__tka.toggleSteerMode());
  await page.waitForTimeout(2200);
  const noSensor = await page.evaluate(() => ({ controls: window.__tka.controls().steerMode, gyro: window.__tka.gyroState() }));
  assert.equal(noSensor.controls, 'buttons', 'le gyroscope s’annonce actif sans données');
  assert.equal(noSensor.gyro.usable, false, 'gyroUsable sans échantillon');
  assert.equal(await page.locator('#pauseGyroBtn').innerText(), 'GYROSCOPE : DÉSACTIVÉ');
  assert.equal(await page.evaluate(() => document.getElementById('leftBtn').offsetParent !== null), true, 'boutons tactiles perdus après un échec gyro');

  // Capteur simulé : activation réelle, état affiché cohérent.
  await startSensorStream(neutral.beta, neutral.gamma);
  await page.waitForTimeout(200);
  await page.evaluate(() => window.__tka.toggleSteerMode());
  await page.waitForFunction(() => window.__tka.controls().steerMode === 'gyro', { timeout: 6000 });
  assert.equal(await page.locator('#pauseGyroBtn').innerText(), 'GYROSCOPE : ACTIVÉ');
  assert.equal(await page.evaluate(() => window.__tka.gyroState().hasSample), true);
  // En course, le gyroscope actif masque les boutons de direction.
  await page.locator('#resumeBtn').click();
  await page.evaluate(() => window.__tka.pauseLoop());
  await page.evaluate(() => window.__tka.step(2, 16.67));
  assert.equal(await page.evaluate(() => document.getElementById('leftBtn').offsetParent === null), true, 'les boutons restent affichés pendant le gyroscope');

  // Position neutre : aucun braquage parasite (angle d'écran réel pris en compte).
  await startSensorStream(neutral.beta, neutral.gamma);
  await page.waitForTimeout(250);
  await page.evaluate(() => window.__tka.step(20, 16.67));
  const neutralState = await page.evaluate(() => ({ steer: window.__tka.currentSteer(), tilt: window.__tka.gyroState().tilt }));
  assert.ok(Math.abs(neutralState.steer) < 0.06, `braquage parasite au repos (${neutralState.steer.toFixed(2)})`);
  assert.ok(Math.abs(neutralState.tilt) < 3, `inclinaison de repos non nulle (${neutralState.tilt.toFixed(1)}°)`);

  // Inclinaison vers la droite ⇒ braquage positif (convention écran, angle 90 ou 0).
  await startSensorStream(tiltedRight.beta, tiltedRight.gamma);
  await page.waitForTimeout(250);
  await page.evaluate(() => window.__tka.step(24, 16.67));
  const steered = await page.evaluate(() => ({ steer: window.__tka.currentSteer(), tilt: window.__tka.gyroState().tilt }));
  assert.ok(steered.steer > 0.15, `inclinaison non prise en compte (steer ${steered.steer.toFixed(2)}, tilt ${steered.tilt.toFixed(1)})`);

  // Inclinaison opposée ⇒ braquage opposé (sens cohérent).
  await startSensorStream(tiltedLeft.beta, tiltedLeft.gamma);
  await page.waitForTimeout(250);
  await page.evaluate(() => window.__tka.step(24, 16.67));
  const steeredLeft = await page.evaluate(() => window.__tka.currentSteer());
  assert.ok(steeredLeft < -0.15, `sens de direction incohérent (${steeredLeft.toFixed(2)})`);

  // Calibration : la position courante devient le zéro.
  await page.evaluate(() => window.__tka.calibrateGyro());
  await page.waitForTimeout(250);
  await page.evaluate(() => window.__tka.step(30, 16.67));
  const calibrated = await page.evaluate(() => ({ steer: window.__tka.currentSteer(), calibration: window.__tka.controls().calibration }));
  assert.ok(Math.abs(calibrated.steer) < 0.12, `calibration sans effet (steer ${calibrated.steer.toFixed(2)})`);
  assert.ok(Math.abs(calibrated.calibration) > 1, 'calibration non mémorisée');

  // Sensibilité : « sport » réagit plus fort que « doux » pour la même inclinaison.
  const steerAtSensitivity = async (sensitivity) => {
    await page.evaluate((wanted) => {
      let guard = 0;
      while (window.__tka.controls().sensitivity !== wanted && guard++ < 6) window.__tka.cycleSensitivity();
    }, sensitivity);
    await startSensorStream(tiltedRight.beta, tiltedRight.gamma);
    await page.waitForTimeout(250);
    await page.evaluate(() => window.__tka.step(20, 16.67));
    const value = Math.abs(await page.evaluate(() => window.__tka.currentSteer()));
    await startSensorStream(neutral.beta, neutral.gamma);
    await page.waitForTimeout(250);
    await page.evaluate(() => window.__tka.step(20, 16.67));
    return value;
  };
  const softSteer = await steerAtSensitivity('soft');
  const sportSteer = await steerAtSensitivity('sport');
  assert.ok(sportSteer > softSteer, `sensibilité inversée (doux ${softSteer.toFixed(2)} / sport ${sportSteer.toFixed(2)})`);

  // Désactivation explicite : retour immédiat aux boutons tactiles.
  await page.evaluate(() => window.__tka.togglePause(true));
  await page.evaluate(() => window.__tka.toggleSteerMode());
  await page.waitForTimeout(150);
  assert.equal(await page.evaluate(() => window.__tka.controls().steerMode), 'buttons');
  assert.equal(await page.locator('#pauseGyroBtn').innerText(), 'GYROSCOPE : DÉSACTIVÉ');
  assert.equal(await page.evaluate(() => document.getElementById('leftBtn').offsetParent !== null), true, 'boutons tactiles non restaurés');

  // Perte de données en course ⇒ repli automatique sur les boutons.
  await page.evaluate(() => window.__tka.toggleSteerMode());
  await page.waitForFunction(() => window.__tka.controls().steerMode === 'gyro', { timeout: 6000 });
  await page.locator('#resumeBtn').click();
  await page.evaluate(() => window.__tka.pauseLoop());
  await emitOrientation(neutral.beta, neutral.gamma);
  await page.evaluate(() => window.__tka.step(2, 16.67));
  await stopSensorStream();
  await page.waitForTimeout(1400);
  await page.evaluate(() => window.__tka.step(1, 16.67));
  const dropout = await page.evaluate(() => window.__tka.controls().steerMode);
  assert.equal(dropout, 'buttons', 'aucun repli automatique après interruption du capteur');
  await emitOrientation(neutral.beta, neutral.gamma);

  /* ---------- 6. Sauvegarde des réglages ---------- */
  const stored = await page.evaluate(() => localStorage.getItem('turbokarts.v4.1.controls.v1'));
  assert.ok(stored, 'réglages de commande non sauvegardés');
  const parsed = JSON.parse(stored);
  assert.equal(parsed.throttleMode, 'auto');
  assert.ok(['soft', 'normal', 'sport'].includes(parsed.sensitivity), 'sensibilité non persistée');

  /* ---------- 7. Captures de course ---------- */
  await page.evaluate(() => window.__tka.cycleSensitivity());
  if (capture) {
    // Gyroscope actif : les boutons de direction disparaissent, le voyant GYRO s'allume.
    await startSensorStream(neutral.beta, neutral.gamma);
    await page.waitForTimeout(150);
    await page.evaluate(() => window.__tka.toggleSteerMode());
    await page.waitForFunction(() => window.__tka.controls().steerMode === 'gyro', { timeout: 6000 });
    await startSensorStream(tiltedRight.beta, tiltedRight.gamma);
    await page.evaluate(() => {
      window.__tka.resumeLoop();
    });
    await page.waitForTimeout(900);
    await page.evaluate(() => {
      window.__tka.pauseLoop();
      document.getElementById('toast').classList.remove('show');
    });
    await page.screenshot({ path: `${captureDir}/04-course-gyroscope.png` });
    await page.evaluate(() => window.__tka.toggleSteerMode());
    await stopSensorStream();
    await page.evaluate(() => window.__tka.resumeLoop());
    await page.waitForTimeout(600);
    await page.evaluate(() => {
      window.__tka.pauseLoop();
      document.getElementById('toast').classList.remove('show');
    });
    await page.screenshot({ path: `${captureDir}/03-course-hud.png` });
    const html = await page.evaluate(() => document.documentElement.outerHTML.length);
    writeFileSync(`${captureDir}/capture-report.json`, JSON.stringify({
      viewport: { width: 915, height: 412, dpr: 2 },
      sensors: 'simulés (DeviceOrientationEvent construits dans la page), aucun téléphone physique',
      version: version.badge,
      captures: [
        '01-menu-commandes.png',
        '01b-menu-commandes-bas.png',
        '02-course-turbo-charge.png',
        '03-course-hud.png',
        '04-course-gyroscope.png',
      ],
      domSize: html,
    }, null, 2));
  }

  assert.equal(errors.length, 0, `erreurs navigateur : ${errors.join(' | ')}`);
  console.log('PASS Mission 11 (navigateur) : commandes, turbo, accélération, gyroscope simulé, version, captures.');
} finally {
  await browser.close();
}
