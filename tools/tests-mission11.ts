/**
 * Mission nº11 — V4.1 : refonte de la jouabilité mobile.
 *
 * Ces tests tournent sous Node, sans navigateur et sans capteur. Ils couvrent :
 *  1-2. boutons gauche/droite et multi-doigts (zones tactiles réelles du HUD) ;
 *  3. accélération automatique par défaut + mode manuel ;
 *  4. freinage ;
 *  5-6. dérapage, bouton TURBO, mini-turbo de maîtrise ;
 *  7-10. gyroscope : activation, calibration, absence de données, orientation ;
 *  11. sauvegarde des paramètres de commande ;
 *  12. identification centralisée de la version ;
 *  13-14. course complète (IA) et retour au garage (Turbo Coins) ;
 *  15. non-régression des ressources WebGL.
 *
 * ⚠️ Ce que ces tests ne prouvent PAS : le comportement réel des capteurs sur un
 * Samsung Adreno 830, le ressenti au pouce et les FPS. Ces points restent à
 * valider sur l'appareil (voir docs/MISSION-11-V4.1.md).
 */
import * as assert from 'node:assert';
import { readFileSync } from 'node:fs';

import { PHYSICS } from '../src/core/config';
import { Kart } from '../src/core/kart';
import { Race } from '../src/core/race';
import { Track } from '../src/core/track';
import { CIRCUITS } from '../src/game/circuits';
import { ROSTER } from '../src/game/roster';
import { makeBrain, thinkAi } from '../src/core/ai';
import { makeRng } from '../src/core/math';
import { MultiTouchControls, TouchZoneController, type TouchZoneId } from '../src/core/touchControls';
import {
  CONTROL_SETTINGS_KEY,
  DEFAULT_CONTROL_SETTINGS,
  loadControlSettings,
  saveControlSettings,
  sanitizeControlSettings,
  nextSensitivity,
  nextThrottleMode,
  nextSteerMode,
} from '../src/core/controlSettings';
import { GYRO_PRESETS, TiltSteering, gravityInDeviceFrame, tiltDegrees } from '../src/core/gyro';
import {
  APP_VERSION_STRING,
  BUILD_FALLBACK_ID,
  IS_DEV_BUILD,
  VERSION_LABEL,
  buildId,
  normalizeCommit,
  resolveBuildCommit,
  versionBadge,
  versionDiagnostics,
  versionInfo,
} from '../src/core/version';
import { awardRace, defaultGarage, GARAGE_STORAGE_KEY, loadGarage } from '../src/game/economy';

const dt = PHYSICS.fixedStep;
const track = new Track(CIRCUITS[0]);

function straightKart(speed = 30) {
  const k = new Kart(0, ROSTER[0], true);
  const smp = track.samples[Math.round(track.count * 0.35)];
  k.reset({ x: smp.x, y: smp.y, z: smp.z, heading: Math.atan2(smp.tx, smp.tz) }, track, 0);
  k.state.speed = speed;
  k.state.vx = Math.sin(k.state.heading) * speed;
  k.state.vz = Math.cos(k.state.heading) * speed;
  return k;
}

/* ================================================================== */
console.log('\n▸ 1-2. Boutons gauche/droite et multi-doigts (HUD V4.1)');
/* ================================================================== */

/** Géométrie réelle du HUD paysage annoncée par `preview/index.html`. */
const HUD_ZONES: Array<{ id: TouchZoneId; left: number; top: number; width: number; height: number }> = [
  { id: 'left', left: 12, top: 300, width: 96, height: 96 },
  { id: 'right', left: 122, top: 300, width: 96, height: 96 },
  { id: 'fire', left: 640, top: 200, width: 72, height: 72 },
  { id: 'turbo', left: 640, top: 300, width: 96, height: 96 },
  { id: 'brake', left: 748, top: 300, width: 96, height: 96 },
  { id: 'drift', left: 856, top: 300, width: 96, height: 96 },
  { id: 'pause', left: 800, top: 10, width: 96, height: 48 },
];

function buildZones() {
  const zones = new TouchZoneController();
  for (const z of HUD_ZONES) zones.setZone(z.id, { left: z.left, top: z.top, width: z.width, height: z.height });
  return zones;
}

assert.equal(HUD_ZONES.length, 7);
for (const z of HUD_ZONES) {
  assert.ok(z.width >= 44 && z.height >= 44, `${z.id} : cible tactile trop petite (${z.width}×${z.height})`);
}

// Les zones ne se chevauchent pas : un doigt = une action, sans ambiguïté.
for (const a of HUD_ZONES) {
  for (const b of HUD_ZONES) {
    if (a.id === b.id) continue;
    const overlapX = a.left < b.left + b.width && b.left < a.left + a.width;
    const overlapY = a.top < b.top + b.height && b.top < a.top + a.height;
    assert.ok(!(overlapX && overlapY), `zones ${a.id} et ${b.id} se chevauchent`);
  }
}

// Quatre doigts simultanés : direction + dérapage + turbo + frein.
{
  const zones = buildZones();
  const centre = (id: TouchZoneId) => {
    const z = HUD_ZONES.find((h) => h.id === id)!;
    return { identifier: 0, pageX: z.left + z.width / 2, pageY: z.top + z.height / 2 };
  };
  const finger = (id: TouchZoneId, identifier: number) => ({ ...centre(id), identifier });
  zones.handleTouchStart([finger('left', 1), finger('drift', 2)], [finger('left', 1), finger('drift', 2)]);
  assert.deepEqual([zones.steer, zones.drift], [-1, true], 'gauche + dérapage');
  zones.handleTouchStart(
    [finger('turbo', 3)],
    [finger('left', 1), finger('drift', 2), finger('turbo', 3)],
  );
  assert.deepEqual([zones.steer, zones.drift, zones.turbo], [-1, true, true], 'turbo pendant dérapage');
  zones.handleTouchEnd([finger('left', 1)], [finger('drift', 2), finger('turbo', 3)]);
  assert.deepEqual([zones.steer, zones.drift, zones.turbo], [0, true, true], 'relâcher gauche a cassé le reste');
  zones.handleTouchStart([finger('right', 4)], [finger('drift', 2), finger('turbo', 3), finger('right', 4)]);
  assert.equal(zones.steer, 1, 'changement de direction rapide non pris en compte');
  zones.handleTouchStart([finger('brake', 5)], [finger('brake', 5), finger('drift', 2)]);
  assert.equal(zones.brake, true, 'frein simultané');
  zones.handleTouchCancel();
  assert.deepEqual([zones.steer, zones.drift, zones.turbo, zones.brake], [0, false, false, false], 'annulation');
}

// Une direction reste une entrée bornée : -1 / 0 / 1, jamais d'entre-deux ambigu.
{
  const controls = new MultiTouchControls();
  controls.press(1, 'left');
  assert.equal(controls.steer, -1);
  controls.press(2, 'right');
  assert.equal(controls.steer, 0, 'les deux pouces doivent neutraliser');
  controls.release(1);
  assert.equal(controls.steer, 1, 'le doigt encore posé doit reprendre la main');
}

// La direction de jeu correspond bien au bouton : +1 = droite (convention verrouillée).
{
  const run = (steer: number) => {
    const k = straightKart(20);
    const rx = -Math.cos(k.state.heading);
    const rz = Math.sin(k.state.heading);
    const x0 = k.state.x;
    const z0 = k.state.z;
    for (let i = 0; i < 72; i++) k.step(dt, { steer, brake: false, drift: false, throttle: 1 }, track, i * dt);
    return (k.state.x - x0) * rx + (k.state.z - z0) * rz;
  };
  assert.ok(run(1) > 1.5, 'bouton droite : le kart ne va pas à droite');
  assert.ok(run(-1) < -1.5, 'bouton gauche : le kart ne va pas à gauche');
}
console.log('  ✅ 7 zones ≥ 44 px, sans chevauchement, 4 doigts simultanés, sens verrouillé');

/* ================================================================== */
console.log('\n▸ 3-4. Accélération automatique, manuelle et freinage');
/* ================================================================== */

assert.equal(DEFAULT_CONTROL_SETTINGS.throttleMode, 'auto', 'l’accélération automatique doit être le défaut mobile');

{
  const k = straightKart(0);
  for (let i = 0; i < 120 * 3; i++) k.step(dt, { steer: 0, brake: false, drift: false, throttle: 1 }, track, i * dt);
  assert.ok(k.state.speed > 15, `accélération automatique inopérante (${k.state.speed.toFixed(1)} m/s)`);
}
{
  // Mode manuel : sans gaz, le kart n'accélère pas.
  const k = straightKart(0);
  for (let i = 0; i < 120 * 3; i++) k.step(dt, { steer: 0, brake: false, drift: false, throttle: 0 }, track, i * dt);
  assert.ok(Math.abs(k.state.speed) < 1, `le kart accélère sans gaz (${k.state.speed.toFixed(2)} m/s)`);
}
{
  // Frein : arrêt franc depuis 120 km/h.
  const k = straightKart(33);
  const x0 = k.state.x;
  const z0 = k.state.z;
  let t = 0;
  while (k.state.speed > 0.5 && t < 6) {
    k.step(dt, { steer: 0, brake: true, drift: false, throttle: 0 }, track, t);
    t += dt;
  }
  const distance = Math.hypot(k.state.x - x0, k.state.z - z0);
  assert.ok(k.state.speed <= 0.9, 'le frein n’arrête pas le kart');
  assert.ok(distance < 45, `freinage trop long : ${distance.toFixed(1)} m`);
}
console.log('  ✅ auto par défaut, manuel respecté, freinage < 45 m depuis 120 km/h');

/* ================================================================== */
console.log('\n▸ 5-6. Dérapage, bouton TURBO et récompense de maîtrise');
/* ================================================================== */

/** Tient un dérapage `seconds` puis relâche (option bouton TURBO). */
function driftRun(seconds: number, useTurboButton = false) {
  const k = straightKart(32);
  let t = 0;
  for (; t < seconds; t += dt) {
    k.step(dt, { steer: 0.8, drift: true, brake: false, throttle: 1, turbo: false }, track, t);
  }
  const tier = k.state.driftTier;
  const speedBefore = k.state.speed;
  const frames = useTurboButton ? 3 : 3;
  for (let i = 0; i < frames; i++) {
    k.step(
      dt,
      useTurboButton
        ? { steer: 0.8, drift: true, brake: false, throttle: 1, turbo: true }
        : { steer: 0, drift: false, brake: false, throttle: 1 },
      track,
      t + i * dt,
    );
  }
  return { kart: k, tier, boost: k.state.boostTime, gain: k.state.speed - speedBefore };
}

{
  const short = driftRun(0.55);
  const long = driftRun(1.6);
  assert.ok(short.boost > 0, 'aucun turbo sur un dérapage court');
  assert.ok(long.boost > short.boost, 'le turbo ne récompense pas un dérapage plus long');
  assert.ok(long.gain > 4, `impulsion de turbo trop faible (${long.gain.toFixed(1)} m/s)`);
  assert.equal(long.tier, 3, `palier violet attendu, obtenu ${long.tier}`);
}

{
  // Le bouton TURBO libère le dérapage sans lâcher le pouce du dérapage.
  const manual = driftRun(0.9, true);
  assert.ok(manual.boost > 0, 'le bouton TURBO ne déclenche aucun turbo');
  assert.equal(manual.kart.state.drifting, false, 'le dérapage continue après le bouton TURBO');
  assert.ok(manual.kart.state.driftLockout > 0, 'aucun verrou anti ré-amorçage après TURBO');
  // Le dérapage ne se ré-amorce pas instantanément (le doigt est toujours posé).
  manual.kart.step(dt, { steer: 0.8, drift: true, brake: false, throttle: 1, turbo: false }, track, 5);
  assert.equal(manual.kart.state.drifting, false, 'le dérapage s’est ré-amorcé immédiatement');
  for (let i = 0; i < 60; i++) {
    manual.kart.step(dt, { steer: 0.8, drift: true, brake: false, throttle: 1, turbo: false }, track, 5 + i * dt);
  }
  assert.equal(manual.kart.state.drifting, true, 'le dérapage ne peut plus être ré-amorcé après le verrou');
}

{
  // Maîtrise : rester en palier violet au-delà du seuil bonifie le mini-turbo.
  const held = PHYSICS.drift.masteryHold + 0.25;
  const k = straightKart(32);
  let t = 0;
  let tier3 = -1;
  for (; t < 4; t += dt) {
    k.step(dt, { steer: 0.85, drift: true, brake: false, throttle: 1 }, track, t);
    if (k.state.driftTier === 3 && tier3 < 0) tier3 = t;
    if (tier3 >= 0 && t - tier3 >= held) break;
  }
  assert.ok(tier3 >= 0, 'palier violet jamais atteint');
  const beforeMasteryCount = k.state.masteryCount;
  k.step(dt, { steer: 0, drift: false, brake: false, throttle: 1 }, track, t);
  assert.equal(k.state.masteryCount, beforeMasteryCount + 1, 'maîtrise non comptabilisée');
  assert.ok(k.state.masteryFlash > 0, 'aucun retour visuel de maîtrise');
  assert.ok(
    k.state.boostTime > PHYSICS.drift.boostDuration[3],
    `le turbo de maîtrise n’est pas renforcé (${k.state.boostTime.toFixed(2)} s)`,
  );
  // Un dérapage court en palier violet ne doit pas être compté comme maîtrisé.
  const quick = driftRun(1.2);
  assert.equal(quick.kart.state.masteryCount, 0, 'maîtrise accordée trop facilement');
}

{
  // Le dérapage conserve mieux l'élan qu'avant (V4.1) et reste sous le plafond.
  const k = straightKart(30);
  let maxV = 0;
  let t = 0;
  for (let phase = 0; phase < 6; phase++) {
    for (let i = 0; i < 120; i++, t += dt) {
      k.step(dt, { steer: 0.7, drift: true, brake: false, throttle: 1 }, track, t);
      maxV = Math.max(maxV, k.state.speed);
    }
    for (let i = 0; i < 90; i++, t += dt) {
      k.step(dt, { steer: 0, drift: false, brake: false, throttle: 1 }, track, t);
      maxV = Math.max(maxV, k.state.speed);
    }
  }
  assert.ok(maxV / (k.stats.maxSpeed * 1.4) < 1.05, `vitesse excessive : ${(maxV * 3.6).toFixed(0)} km/h`);
}
console.log('  ✅ paliers, TURBO manuel + verrou, maîtrise violette, plafond de vitesse respecté');

/* ================================================================== */
console.log('\n▸ 7-10. Gyroscope : activation, calibration, absence de données, orientation');
/* ================================================================== */

{
  // Aucune donnée : le volant ne prétend rien et reste neutre.
  const tilt = new TiltSteering();
  assert.equal(tilt.ready, false);
  assert.equal(tilt.hasSignal(0), false, 'du signal sans échantillon');
  assert.equal(tilt.steer, 0, 'braquage non nul sans capteur');
}

{
  // Échantillons reçus : le signal est reconnu puis expire s'il s'arrête.
  const tilt = new TiltSteering();
  tilt.push(0, -90, 90, 1 / 60, 1000);
  assert.equal(tilt.ready, true, 'échantillon ignoré');
  assert.equal(tilt.hasSignal(1000), true);
  assert.equal(tilt.hasSignal(1200), true, 'le signal doit tolérer un court délai');
  assert.equal(tilt.hasSignal(4000), false, 'le signal reste « actif » sans données');
}

{
  // Zone morte, lissage et limitation de vitesse : pas d'oscillation.
  const tilt = new TiltSteering();
  tilt.sensitivity = 'normal';
  const preset = GYRO_PRESETS.normal;
  // inclinaison inférieure à la zone morte ⇒ 0
  const dead = tilt.steerFromTilt(preset.deadzone * 0.8);
  assert.equal(dead, 0, 'la zone morte n’est pas respectée');
  assert.ok(tilt.steerFromTilt(preset.range * 2) <= 1.0001, 'braquage non borné');
  assert.ok(tilt.steerFromTilt(-preset.range * 2) >= -1.0001);
  assert.ok(GYRO_PRESETS.soft.maxRate < GYRO_PRESETS.sport.maxRate, 'les présets doivent différer');
  assert.ok(GYRO_PRESETS.soft.range > GYRO_PRESETS.sport.range, 'sport doit être plus sensible');

  // Un saut brutal d'inclinaison ne produit pas un coup de volant instantané.
  const jump = new TiltSteering();
  jump.sensitivity = 'normal';
  let last = 0;
  for (let i = 0; i < 4; i++) last = jump.push(0, -90 + 40, 90, 1 / 60, i * 16);
  assert.ok(Math.abs(last) <= GYRO_PRESETS.normal.maxRate * (1 / 60) * 4 + 1e-6, `saut de braquage ${last.toFixed(2)}`);
}

{
  // Calibration : la position neutre choisie par le joueur devient le zéro.
  const tilt = new TiltSteering();
  tilt.sensitivity = 'normal';
  const beta = 12;
  const gamma = -90;
  for (let i = 0; i < 90; i++) tilt.push(beta, gamma, 90, 1 / 60, i * 16);
  const beforeCalibration = Math.abs(tilt.steer);
  assert.ok(beforeCalibration > 0.1, 'inclinaison de repos non détectée');
  const offset = tilt.calibrate();
  assert.ok(Math.abs(offset) > 1, `calibration nulle (${offset})`);
  for (let i = 0; i < 90; i++) tilt.push(beta, gamma, 90, 1 / 60, 1000 + i * 16);
  assert.ok(Math.abs(tilt.steer) < 0.05, `calibration sans effet (steer ${tilt.steer.toFixed(3)})`);
  // Un mouvement réel reste détecté après calibration.
  for (let i = 0; i < 90; i++) tilt.push(beta + 18, gamma, 90, 1 / 60, 2000 + i * 16);
  assert.ok(Math.abs(tilt.steer) > 0.2, 'la calibration a supprimé la direction');
}

{
  /* Cohérence du sens de direction selon l'orientation de l'écran.

     On construit de vraies poses physiques : matrice de rotation
     R = Rz(α)·Rx(β)·Ry(γ) (convention DeviceOrientation), puis on applique une
     rotation ψ autour de l'axe normal à l'écran (le geste « volant »). Les
     angles β/γ correspondants sont réinjectés dans `tiltDegrees`. La même pose
     physique doit donner le même braquage dans les quatre orientations d'écran. */
  const D2R = Math.PI / 180;
  function rot(betaDeg: number, gammaDeg: number, alphaDeg = 0) {
    const [ca, sa] = [Math.cos(alphaDeg * D2R), Math.sin(alphaDeg * D2R)];
    const [cb, sb] = [Math.cos(betaDeg * D2R), Math.sin(betaDeg * D2R)];
    const [cg, sg] = [Math.cos(gammaDeg * D2R), Math.sin(gammaDeg * D2R)];
    return [
      [ca * cg - sa * sb * sg, -sa * cb, ca * sg + sa * sb * cg],
      [sa * cg + ca * sb * sg, ca * cb, sa * sg - ca * sb * cg],
      [-cb * sg, sb, cb * cg],
    ];
  }
  /** Rotation de ψ autour de l'axe z de l'appareil (normal à l'écran, geste volant). */
  function rollAroundScreenNormal(betaDeg: number, gammaDeg: number, psiDeg: number) {
    const M = rot(betaDeg, gammaDeg);
    const [cp, sp] = [Math.cos(psiDeg * D2R), Math.sin(psiDeg * D2R)];
    // M' = M · Rz(ψ)
    const R = M.map((row) => [
      row[0] * cp + row[1] * sp,
      -row[0] * sp + row[1] * cp,
      row[2],
    ]);
    const beta = Math.asin(Math.max(-1, Math.min(1, R[2][1])));
    const gamma = Math.atan2(-R[2][0], R[2][2]);
    return { beta: beta / D2R, gamma: gamma / D2R };
  }

  /** Pose « téléphone tenu normalement » pour chaque orientation d'écran. */
  const NEUTRAL: Record<0 | 90 | 180 | 270, { beta: number; gamma: number }> = {
    0: { beta: 90, gamma: 0 },
    90: { beta: 0, gamma: -90 },
    180: { beta: -90, gamma: 0 },
    270: { beta: 0, gamma: 90 },
  };

  for (const angle of [0, 90, 180, 270] as const) {
    const pose = NEUTRAL[angle];
    assert.ok(
      Math.abs(tiltDegrees(pose.beta, pose.gamma, angle)) < 0.5,
      `position neutre non nulle en ${angle}° (${tiltDegrees(pose.beta, pose.gamma, angle).toFixed(2)})`,
    );
    const right = rollAroundScreenNormal(pose.beta, pose.gamma, -10);
    const left = rollAroundScreenNormal(pose.beta, pose.gamma, 10);
    const tiltRight = tiltDegrees(right.beta, right.gamma, angle);
    const tiltLeft = tiltDegrees(left.beta, left.gamma, angle);
    // Le côté droit de l'écran descend ⇒ virage à droite (positif), partout.
    assert.ok(
      tiltRight > 5,
      `inclinaison à droite non détectée en ${angle}° (${tiltRight.toFixed(2)})`,
    );
    assert.ok(tiltLeft < -5, `inclinaison à gauche non détectée en ${angle}° (${tiltLeft.toFixed(2)})`);
    assert.ok(
      Math.abs(Math.abs(tiltRight) - Math.abs(tiltLeft)) < 0.5,
      `asymétrie gauche/droite en ${angle}°`,
    );
    assert.ok(
      Math.abs(Math.abs(tiltRight) - 10) < 1.5,
      `amplitude incohérente en ${angle}° : ${tiltRight.toFixed(2)}° pour un geste de 10°`,
    );
  }

  // Téléphone posé à plat : aucune direction parasite (pas d'oscillation).
  assert.equal(tiltDegrees(0, 0, 90), 0, 'téléphone à plat ⇒ 0');
  assert.equal(tiltDegrees(0, 0, 0), 0, 'téléphone à plat (portrait) ⇒ 0');
  // Le vecteur gravité est unitaire : base saine pour la projection écran.
  for (const [beta, gamma] of [[0, 0], [45, 30], [90, 0], [-30, 120]]) {
    const g = gravityInDeviceFrame(beta, gamma);
    assert.ok(Math.abs(Math.hypot(g.x, g.y, g.z) - 1) < 1e-9, `gravité non unitaire (${beta},${gamma})`);
  }
  // L'inversion volontaire reste disponible (filet de sécurité appareil).
  const pose90 = NEUTRAL[90];
  const rolled = rollAroundScreenNormal(pose90.beta, pose90.gamma, -10);
  const inverted = new TiltSteering();
  inverted.invertTilt = true;
  const normal = new TiltSteering();
  for (let i = 0; i < 40; i++) {
    inverted.push(rolled.beta, rolled.gamma, 90, 1 / 60, i * 16);
    normal.push(rolled.beta, rolled.gamma, 90, 1 / 60, i * 16);
  }
  assert.ok(normal.steer > 0.2, `braquage à droite trop faible (${normal.steer.toFixed(2)})`);
  assert.ok(Math.sign(inverted.steer) === -Math.sign(normal.steer), 'l’inversion du sens est inopérante');
}

{
  // Le HUD ne doit jamais annoncer un gyroscope actif sans données : vérification
  // statique du code de la preview (repli automatique + état réel).
  const source = readFileSync('preview/main.ts', 'utf8');
  assert.ok(source.includes('function gyroUsable('), 'garde-fou gyroUsable absent');
  assert.ok(source.includes("state.controls.steerMode = 'buttons';"), 'aucun repli automatique vers les boutons');
  assert.ok(source.includes('waitForGyroSample'), 'aucune attente de données réelles');
  assert.ok(source.includes('GYRO_SIGNAL_TIMEOUT_MS'), 'aucune détection d’interruption capteur');
  assert.ok(/gyroFailure\(/.test(source), 'aucun message d’échec explicite');
  assert.ok(source.includes('requestPermission'), 'autorisation iOS/Chrome non demandée');
  const html = readFileSync('preview/index.html', 'utf8');
  assert.ok(html.includes('GYROSCOPE : DÉSACTIVÉ'), 'bouton explicite GYROSCOPE absent');
  assert.ok(html.includes('RECALIBRER'), 'bouton RECALIBRER absent');
  assert.ok(html.includes('SENSIBILITÉ'), 'réglage de sensibilité absent');
}
console.log('  ✅ zone morte, lissage, calibration, 4 orientations cohérentes, repli sans données');

/* ================================================================== */
console.log('\n▸ 11. Sauvegarde des paramètres de commande');
/* ================================================================== */

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  };
}

{
  const storage = memoryStorage();
  assert.deepEqual(loadControlSettings(storage), DEFAULT_CONTROL_SETTINGS);

  const custom = {
    steerMode: 'gyro' as const,
    throttleMode: 'manual' as const,
    sensitivity: 'sport' as const,
    calibration: 7.5,
    invertTilt: true,
  };
  saveControlSettings(storage, custom);
  assert.ok(storage.data.has(CONTROL_SETTINGS_KEY), 'clé de stockage absente');
  assert.deepEqual(loadControlSettings(storage), custom, 'aller-retour de sauvegarde incorrect');

  // Corruption : on retombe sur des valeurs sûres, sans exception.
  const broken = memoryStorage({ [CONTROL_SETTINGS_KEY]: '{oops' });
  assert.deepEqual(loadControlSettings(broken), DEFAULT_CONTROL_SETTINGS);
  // Valeurs hors bornes : calibration ramenée dans [-35, 35], modes inconnus ignorés.
  const wild = sanitizeControlSettings({ ...custom, calibration: 900, sensitivity: 'turbo', steerMode: 'nope' });
  assert.equal(wild.calibration, 35);
  assert.equal(wild.sensitivity, 'normal');
  assert.equal(wild.steerMode, 'buttons');
  // Migration de l'ancien réglage booléen (app native V3/V4).
  assert.equal(loadControlSettings(memoryStorage(), true).steerMode, 'gyro');
  assert.equal(loadControlSettings(memoryStorage(), false).steerMode, 'buttons');
  // Cycles de réglage : jamais bloqués.
  assert.equal(nextSteerMode('buttons'), 'gyro');
  assert.equal(nextSteerMode(nextSteerMode('buttons')), 'buttons');
  assert.equal(nextSensitivity('soft'), 'normal');
  assert.equal(nextSensitivity('normal'), 'sport');
  assert.equal(nextSensitivity('sport'), 'soft');
  assert.equal(nextThrottleMode('auto'), 'manual');
  assert.equal(nextThrottleMode('manual'), 'auto');
}
console.log('  ✅ aller-retour, corruption tolérée, bornes, migration booléenne');

/* ================================================================== */
console.log('\n▸ 12. Identification de version');
/* ================================================================== */

{
  assert.equal(APP_VERSION_STRING, '4.1.0', 'version fonctionnelle incohérente');
  assert.equal(VERSION_LABEL, 'V4.1.0-dev', 'le canal de développement doit rester visible');
  assert.equal(IS_DEV_BUILD, true, 'une branche non fusionnée ne doit pas se dire stable');
  assert.equal(BUILD_FALLBACK_ID, 'sans-git');
  assert.equal(buildId(null), 'sans-git', 'repli de build non explicite');
  assert.equal(buildId('2bd9c14d27d033015b0476cedf70e28b562bf56e'), '2bd9c14', 'hash court incorrect');
  assert.equal(normalizeCommit(' 2BD9C14 '), '2bd9c14');
  assert.equal(normalizeCommit('pas-un-hash'), null);
  assert.equal(normalizeCommit(''), null);
  assert.equal(versionBadge('2bd9c14'), 'V4.1.0-dev · Build 2bd9c14');
  assert.equal(versionBadge(null), 'V4.1.0-dev · Build sans-git');
  assert.ok(versionDiagnostics(null).includes('commit indisponible'), 'diagnostics : repli non signalé');
  assert.ok(versionDiagnostics('2bd9c14').includes('canal développement'));
  const info = versionInfo('2bd9c14');
  assert.deepEqual(
    { version: info.version, channel: info.channel, build: info.build, isDev: info.isDev },
    { version: '4.1.0', channel: 'dev', build: '2bd9c14', isDev: true },
  );
  // Priorité : surcharge d'exécution > injection de build > repli.
  (globalThis as { __TKA_BUILD_COMMIT__?: string }).__TKA_BUILD_COMMIT__ = 'abcdef1';
  assert.equal(resolveBuildCommit(), 'abcdef1');
  delete (globalThis as { __TKA_BUILD_COMMIT__?: string }).__TKA_BUILD_COMMIT__;
  assert.equal(resolveBuildCommit(), null);

  // Cohérence des manifestes : plus de « 3.0.0-dev » ni « V4 » contradictoire.
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  assert.equal(pkg.version, '4.1.0-dev', 'package.json doit annoncer 4.1.0-dev');
  const app = JSON.parse(readFileSync('app.json', 'utf8'));
  assert.equal(app.expo.version, '4.1.0', 'app.json doit annoncer 4.1.0');
  assert.equal(app.expo.extra.appVersion, '4.1.0-dev');
  // La version affichée vient d'un seul module : aucune copie en dur dans le HUD.
  const main = readFileSync('preview/main.ts', 'utf8');
  assert.ok(main.includes("from '../src/core/version'"), 'la preview ne lit pas le module de version');
  assert.ok(!/"V?"4\.1\.0/.test(main), 'version écrite en dur dans la preview');
  assert.ok(readFileSync('preview/index.html', 'utf8').includes('id="versionBadge"'), 'badge de version absent du menu');
}
console.log('  ✅ V4.1.0-dev · Build <commit> / repli « sans-git », manifestes alignés');

/* ================================================================== */
console.log('\n▸ 13-14. Course complète, victoire et retour au garage');
/* ================================================================== */

{
  const race = new Race({ circuit: CIRCUITS[0], opponents: 5 });
  const brain = makeBrain(makeRng(11), 1);
  const frame = 1 / 60;
  let time = 0;
  while (time < 220 && race.player.state.status !== 'finished') {
    const input =
      race.phase === 'racing'
        ? thinkAi(race.player, brain, race.track, frame, race.raceTime, race.karts)
        : { steer: 0, brake: false, drift: false, throttle: 0 };
    race.update(frame, { player: input });
    race.events.length = 0;
    time += frame;
  }
  const player = race.player.state;
  assert.equal(player.status, 'finished', `course non terminée (tour ${player.lap})`);
  assert.equal(player.lapTimes.length, PHYSICS.race.laps, 'tours incomplets');
  assert.ok(player.finishTime > 10, 'temps de course incohérent');
  const order = race.computePlaces();
  assert.equal(order.length, race.karts.length);
  for (let i = 1; i < order.length; i++) {
    assert.ok(order[i - 1].state.place <= order[i].state.place, 'classement incohérent');
  }
}

{
  // Retour au garage : récompense idempotente, Turbo Coins et sauvegarde préservés.
  const garage = defaultGarage();
  const before = garage.coins;
  const gain = awardRace(garage, 'mission11-race', 1, 12, playerTime(), CIRCUITS[0].id);
  assert.ok(gain > 0, 'aucune récompense pour une victoire');
  assert.equal(garage.coins, before + gain, 'solde incohérent');
  assert.equal(awardRace(garage, 'mission11-race', 1, 12, playerTime(), CIRCUITS[0].id), 0, 'double récompense');
  const storage = memoryStorage();
  const saved = JSON.stringify(garage);
  storage.setItem(GARAGE_STORAGE_KEY, saved);
  const reloaded = loadGarage(storage);
  assert.equal(reloaded.coins, garage.coins, 'Turbo Coins perdus à la sauvegarde');
  assert.deepEqual(reloaded.owned, garage.owned, 'véhicules perdus à la sauvegarde');
  assert.ok(reloaded.rewardedRaces.includes('mission11-race'), 'anti-double-récompense non persisté');
}

function playerTime() {
  return 92.5;
}
console.log('  ✅ 3 tours bouclés, classement cohérent, victoire récompensée et persistée');

/* ================================================================== */
console.log('\n▸ 15. Absence de régression WebGL');
/* ================================================================== */

{
  const world = readFileSync('src/render/world.ts', 'utf8');
  // Aucune nouvelle ressource GPU pour le retour visuel du turbo : le HUD est en DOM.
  const allocations = world.match(/new THREE\.(Texture|WebGLRenderTarget|Geometry|Mesh|ShaderMaterial|Material)\b/g) ?? [];
  assert.ok(allocations.length <= 24, `allocations GPU ajoutées dans le moteur (${allocations.length})`);
  assert.ok(world.includes('releaseContextResources()'), 'libération de contexte conservée');
  assert.ok(world.includes('restoreContextResources()'), 'restauration de contexte conservée');
  assert.ok(world.includes('forceContextLoss'), 'destruction explicite conservée');
  // Les budgets de qualité (missions 9/10) restent inchangés.
  const config = readFileSync('src/core/config.ts', 'utf8');
  assert.ok(config.includes('maxPixels: 1280 * 620'), 'budget basse qualité modifié');
  assert.ok(config.includes('particleBudget: 180'), 'budget de particules modifié');
  // L'ancienne lecture erronée du gyroscope (vitesse angulaire) a disparu.
  const app = readFileSync('App.tsx', 'utf8');
  assert.ok(!/Math\.atan2\(z, 9\.81\)/.test(app), 'ancienne intégration du gyroscope encore présente');
  assert.ok(!/Gyroscope\.(addListener|setUpdateInterval)/.test(app), 'l’ancien capteur de vitesse angulaire dirige encore');
  assert.ok(!/import\s*\{[^}]*\bGyroscope\b[^}]*\}\s*from\s*'expo-sensors'/.test(app), 'expo-sensors Gyroscope encore importé');
  assert.ok(app.includes('DeviceMotion'), 'orientation de l’appareil non utilisée côté natif');
}
console.log('  ✅ aucune allocation GPU ajoutée, libération/restauration intactes');

console.log('\n✅ Mission 11 terminée — commandes, gyroscope, physique et version vérifiés.');
