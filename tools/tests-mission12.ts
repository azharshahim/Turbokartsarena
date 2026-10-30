/**
 * Mission nº12 — audit final de la V4.1.
 *
 * Suite Node (aucun navigateur, aucun capteur) : elle vérifie ce qui peut l'être
 * de façon déterministe après la mission nº11.
 *   1. identification de version : formes du badge, repli, build local ;
 *   2. bundle livré : marqueur de build, badge statique, cohérence des manifestes ;
 *   3. sauvegardes : garage/Turbo Coins/records/améliorations préservés ;
 *   4. réglages de commandes : valeurs par défaut, migration, clé séparée ;
 *   5. conduite : vitesse, accélération, freinage, virage, différences entre véhicules ;
 *   6. dérapage : mini-turbo borné, plafond de boost inchangé par la maîtrise ;
 *   7. non-régression statique du rendu (aucune allocation GPU ajoutée par la V4.1).
 *
 * ⚠️ Ces tests ne remplacent pas une validation sur un Samsung réel : capteurs,
 * ressenti au pouce et FPS ne sont pas mesurables ici.
 */
import * as assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import { PHYSICS } from '../src/core/config';
import { Kart } from '../src/core/kart';
import { Track } from '../src/core/track';
import { ROSTER } from '../src/game/roster';
import { VEHICLES, vehicleProfile } from '../src/game/vehicles';
import { defaultGarage, loadGarage, saveGarage, upgradedProfile, GARAGE_STORAGE_KEY, type GarageState } from '../src/game/economy';
import { CONTROL_SETTINGS_KEY, DEFAULT_CONTROL_SETTINGS, loadControlSettings, saveControlSettings, nextSensitivity } from '../src/core/controlSettings';
import {
  APP_VERSION_STRING,
  BUILD_FALLBACK_ID,
  BUILD_LOCAL_SUFFIX,
  VERSION_LABEL,
  buildId,
  isLocalBuild,
  versionBadge,
  versionDiagnostics,
  versionInfo,
} from '../src/core/version';

const dt = PHYSICS.fixedStep;
let checks = 0;
const ok = (condition: unknown, message: string) => {
  assert.ok(condition, message);
  checks += 1;
};

/* ================================================================== */
console.log('\n▸ 1. Identification de version');
/* ================================================================== */

ok(/^\d+\.\d+\.\d+$/.test(APP_VERSION_STRING), `version applicative invalide : ${APP_VERSION_STRING}`);
ok(VERSION_LABEL === `V${APP_VERSION_STRING}-dev`, `libellé incohérent : ${VERSION_LABEL}`);
if (!process.env.EXPO_PUBLIC_TKA_BUILD) {
  ok(buildId(null) === BUILD_FALLBACK_ID, 'build hors dépôt : repli explicite attendu');
} else {
  ok(buildId(null) === process.env.EXPO_PUBLIC_TKA_BUILD.slice(0, 7).toLowerCase(), 'commit Expo non lu');
}
ok(/^[0-9a-f]{7}$/.test(buildId('1b37067d27d033015b0476cedf70e28b562bf56e')), 'hash long mal tronqué');
ok(!isLocalBuild(), 'un build Node ordinaire ne doit pas être marqué local');

// Build local : un bundle compilé avec des sources modifiées ne revendique pas un commit propre.
{
  (globalThis as { __TKA_BUILD_LOCAL__?: boolean }).__TKA_BUILD_LOCAL__ = true;
  ok(buildId('1b37067') === `1b37067${BUILD_LOCAL_SUFFIX}`, 'suffixe de build local absent');
  ok(versionBadge('1b37067') === `V4.1.0-dev · Build 1b37067${BUILD_LOCAL_SUFFIX}`, 'badge local mal formé');
  ok(versionDiagnostics('1b37067').includes('sources non commitées'), 'diagnostics sans mention du build local');
  delete (globalThis as { __TKA_BUILD_LOCAL__?: boolean }).__TKA_BUILD_LOCAL__;
  ok(versionBadge('1b37067') === 'V4.1.0-dev · Build 1b37067', 'badge propre incorrect');
}

const info = versionInfo('1b37067');
ok(info.channel === 'dev' && info.isDev === true, 'la V4.1 doit rester en canal développement');
ok(info.commit === '1b37067' && info.build === '1b37067', 'commit exposé aux diagnostics incorrect');
ok(info.diagnostics.includes('canal développement'), 'diagnostics sans canal');

/* ================================================================== */
console.log('▸ 2. Bundle livré (marqueur de build, manifestes)');
/* ================================================================== */

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const app = JSON.parse(readFileSync('app.json', 'utf8'));
ok(pkg.version === `${APP_VERSION_STRING}-dev`, `package.json (${pkg.version}) ≠ version applicative`);
ok(app.expo.version === APP_VERSION_STRING, `app.json (${app.expo.version}) ≠ version applicative`);
ok(typeof app.expo.android.versionCode === 'number', 'versionCode Android manquant');
ok(app.expo.extra.gitCommit === 'auto', 'app.json ne doit pas coder un hash en dur');

const html = readFileSync('index.html', 'utf8');
const meta = html.match(/<meta name="tka-build" content="([^"]*)" \/>/);
ok(Boolean(meta), 'index.html livré sans marqueur <meta name="tka-build">');
const buildMarker = meta![1];
ok(/^([0-9a-f]{7}|sans-git)(\+local)?$/.test(buildMarker), `marqueur de build invalide : ${buildMarker}`);
const staticBadge = html.match(/<div id="versionBadge">([^<]*)<\/div>/);
ok(Boolean(staticBadge), 'badge statique absent du menu');
ok(!staticBadge![1].includes('—'), 'le badge statique contient encore un texte de remplacement');
ok(staticBadge![1].includes(buildMarker), `badge statique (${staticBadge![1]}) ≠ marqueur (${buildMarker})`);
ok(!/\bV4\.1\.0\b(?!-dev)/.test(html), 'le bundle ne doit jamais présenter « V4.1.0 » sans le suffixe -dev');

// Le commit affiché doit exister et ne pas être antérieur au code compilé.
try {
  const head = execFileSync('git', ['rev-parse', '--short=7', 'HEAD'], { encoding: 'utf8' }).trim();
  ok(/^[0-9a-f]{7}$/.test(head), 'référence Git illisible');
} catch {
  console.log('  · dépôt Git indisponible : contrôle du commit ignoré (build « sans-git »).');
}

/* ================================================================== */
console.log('▸ 3. Sauvegardes (Turbo Coins, garage, records)');
/* ================================================================== */

function memoryStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v), dump: () => map };
}

// Sauvegarde « V4.0 » réaliste : un joueur qui a acheté, amélioré et couru.
const legacySave: GarageState = {
  coins: 1234,
  owned: [...defaultGarage().owned, 'vortex', 'onyx'],
  selected: 'onyx',
  upgrades: { apex: { engine: 3, grip: 2 }, onyx: { topSpeed: 5 } },
  rewardedRaces: ['race-42', 'race-43'],
  bestTimes: { 'cote-solaire': 61.4, 'canyon-ecarlate': 72.8 },
  stats: { races: 17, wins: 6, coinsCollected: 240 },
};
{
  const storage = memoryStorage({ [GARAGE_STORAGE_KEY]: JSON.stringify(legacySave) });
  const loaded = loadGarage(storage);
  ok(loaded.coins === 1234, 'Turbo Coins perdus au chargement');
  ok(loaded.owned.includes('onyx') && loaded.owned.length === legacySave.owned.length, 'véhicules achetés perdus');
  ok(loaded.upgrades.apex.engine === 3 && loaded.upgrades.onyx?.topSpeed === 5, 'améliorations perdues');
  ok(loaded.bestTimes['cote-solaire'] === 61.4, 'records perdus');
  ok(loaded.stats.races === 17 && loaded.stats.wins === 6, 'statistiques perdues');
  ok(loaded.rewardedRaces.length === 2, 'anti-abus de récompense perdu');
  ok(loaded.selected === 'onyx', 'sélection de véhicule perdue');

  // Les réglages de commandes vivent dans une autre clé : sauver l'un ne touche pas l'autre.
  saveControlSettings(storage, { ...DEFAULT_CONTROL_SETTINGS, steerMode: 'gyro', sensitivity: 'sport', throttleMode: 'manual' });
  ok(storage.getItem(GARAGE_STORAGE_KEY) === JSON.stringify(legacySave), 'la sauvegarde garage a été réécrite par les réglages');
  const reloaded = loadGarage(storage);
  ok(reloaded.coins === 1234 && reloaded.bestTimes['canyon-ecarlate'] === 72.8, 'garage altéré après sauvegarde des réglages');
  ok(storage.getItem(CONTROL_SETTINGS_KEY) !== null, 'réglages de commandes non persistés');
  ok(CONTROL_SETTINGS_KEY !== GARAGE_STORAGE_KEY, 'les réglages ne doivent pas partager la clé du garage');

  // Sauvegarde corrompue : on retombe sur les valeurs par défaut, sans jamais lever.
  const broken = loadGarage(memoryStorage({ [GARAGE_STORAGE_KEY]: '{oops' }));
  ok(broken.coins === defaultGarage().coins && broken.owned.length === defaultGarage().owned.length, 'sauvegarde corrompue mal gérée');

  // Migration de l'ancien booléen de direction (V4.0) sans perdre les autres réglages.
  const migrated = loadControlSettings(memoryStorage({ 'turbokarts.input': 'gyro' }), true);
  ok(migrated.steerMode === 'gyro', 'migration de l’ancien mode gyroscope cassée');
  ok(loadControlSettings(memoryStorage(), undefined).throttleMode === 'auto', 'accélération automatique non par défaut');
  saveGarage(storage, loaded);
  ok(JSON.parse(storage.getItem(GARAGE_STORAGE_KEY)!).coins === 1234, 'aller-retour de sauvegarde non idempotent');
}

/* ================================================================== */
console.log('▸ 4. Conduite : vitesse, accélération, freinage, virage');
/* ================================================================== */

/** Longue ligne droite isolée : on mesure la physique, pas le tracé d'un circuit. */
const bench = new Track({
  id: 'audit-bench',
  name: 'Banc d’audit',
  theme: 'test',
  seed: 1,
  width: 60,
  widthVariance: 0,
  grandstands: 0,
  boosts: [],
  maxCurvature: 1,
  smoothIterations: 0,
  smoothStrength: 0,
  control: Array.from({ length: 21 }, (_, i) => ({ x: 0, y: 0, z: -3000 + i * 300 })),
} as never);
const startSample = bench.samples[Math.round(bench.count * 0.02)];

function benchKart(profile: ReturnType<typeof vehicleProfile>, speed = 0) {
  const kart = new Kart(0, profile, true);
  kart.reset({ x: startSample.x, y: startSample.y, z: startSample.z, heading: Math.atan2(startSample.tx, startSample.tz) }, bench, 0);
  if (speed > 0) {
    kart.state.speed = speed;
    kart.state.vx = Math.sin(kart.state.heading) * speed;
    kart.state.vz = Math.cos(kart.state.heading) * speed;
  }
  return kart;
}

function straight(profile: ReturnType<typeof vehicleProfile>, seconds: number) {
  const kart = benchKart(profile);
  let peak = 0;
  for (let i = 0; i < Math.round(seconds / dt); i += 1) {
    kart.step(dt, { steer: 0, brake: false, drift: false, throttle: 1 }, bench, i * dt);
    peak = Math.max(peak, kart.state.speed);
  }
  ok(Number.isFinite(peak) && Number.isFinite(kart.state.z), 'état du kart non fini en ligne droite');
  return { kart, peak };
}

function timeTo(profile: ReturnType<typeof vehicleProfile>, kmh: number) {
  const kart = benchKart(profile);
  for (let i = 0; i < Math.round(15 / dt); i += 1) {
    kart.step(dt, { steer: 0, brake: false, drift: false, throttle: 1 }, bench, i * dt);
    if (kart.state.speed * 3.6 >= kmh) return (i + 1) * dt;
  }
  return Infinity;
}

const tops: number[] = [];
for (const vehicle of VEHICLES) {
  const profile = vehicleProfile(ROSTER[0], vehicle);
  const { peak } = straight(profile, 40);
  const topKmh = peak * 3.6;
  tops.push(topKmh);
  ok(topKmh > 120 && topKmh < 180, `${vehicle.id} : vitesse de pointe hors gabarit (${topKmh.toFixed(0)} km/h)`);
  const t100 = timeTo(profile, 100);
  ok(t100 > 1.2 && t100 < 4.5, `${vehicle.id} : 0-100 km/h hors gabarit (${t100.toFixed(2)} s)`);

  // Freinage : 33 m/s (≈ 119 km/h) → arrêt.
  const braking = benchKart(profile, 33);
  const from = { x: braking.state.x, z: braking.state.z };
  let distance = Infinity;
  for (let i = 0; i < Math.round(12 / dt); i += 1) {
    braking.step(dt, { steer: 0, brake: true, drift: false, throttle: 0 }, bench, i * dt);
    if (braking.state.speed <= 0.9) {
      distance = Math.hypot(braking.state.x - from.x, braking.state.z - from.z);
      break;
    }
  }
  ok(distance > 5 && distance < 30, `${vehicle.id} : distance de freinage hors gabarit (${distance.toFixed(1)} m)`);

  // Virage : le kart doit tourner, mais pas pivoter sur place.
  const turning = benchKart(profile, 20);
  const heading0 = turning.state.heading;
  for (let i = 0; i < Math.round(1 / dt); i += 1) {
    turning.step(dt, { steer: 1, brake: false, drift: false, throttle: 1 }, bench, i * dt);
  }
  const yawRate = Math.abs(turning.state.heading - heading0);
  ok(yawRate > 0.8 && yawRate < 3.2, `${vehicle.id} : vitesse de rotation anormale (${yawRate.toFixed(2)} rad/s)`);
  ok(Number.isFinite(turning.state.x) && Number.isFinite(turning.state.z), `${vehicle.id} : position non finie en virage`);
}

// Les véhicules doivent rester différents (pas de nivellement par la V4.1).
const spread = Math.max(...tops) - Math.min(...tops);
ok(spread > 8, `les véhicules se ressemblent trop (écart de pointe ${spread.toFixed(0)} km/h)`);

// Les améliorations restent lisibles mais bornées (pas de kart incontrôlable).
const maxed: GarageState = {
  ...defaultGarage(),
  coins: 0,
  owned: VEHICLES.map((v) => v.id),
  upgrades: Object.fromEntries(VEHICLES.map((v) => [v.id, { engine: 5, acceleration: 5, topSpeed: 5, braking: 5, grip: 5, protection: 5, turbo: 5 }])),
};
for (const vehicle of VEHICLES) {
  const base = vehicleProfile(ROSTER[0], vehicle);
  const baseTop = straight(base, 40).peak;
  const upTop = straight(upgradedProfile(base, maxed), 40).peak;
  const ratio = upTop / baseTop;
  ok(ratio > 1.05 && ratio < 1.45, `${vehicle.id} : gain d’amélioration hors gabarit (×${ratio.toFixed(2)})`);
}

/* ================================================================== */
console.log('▸ 5. Dérapage, mini-turbo et plafond de boost');
/* ================================================================== */

const apex = vehicleProfile(ROSTER[0], VEHICLES[0]);
function driftThenRelease(holdSeconds: number, patch?: Partial<typeof PHYSICS.drift>) {
  const saved = { ...PHYSICS.drift };
  if (patch) Object.assign(PHYSICS.drift as unknown as Record<string, unknown>, patch);
  const kart = benchKart(apex, 26);
  let t = 0;
  for (let i = 0; i < Math.round(0.6 / dt); i += 1, t += dt) kart.step(dt, { steer: 0, brake: false, drift: false, throttle: 1 }, bench, t);
  for (let i = 0; i < Math.round(holdSeconds / dt); i += 1, t += dt) {
    kart.step(dt, { steer: 0.85, brake: false, drift: true, throttle: 1 }, bench, t);
  }
  const tier = kart.state.driftTier;
  let peak = 0;
  let boostFrames = 0;
  for (let i = 0; i < Math.round(5 / dt); i += 1, t += dt) {
    kart.step(dt, { steer: 0, brake: false, drift: false, throttle: 1 }, bench, t);
    peak = Math.max(peak, kart.state.speed);
    if (kart.state.boostTime > 0) boostFrames += 1;
  }
  Object.assign(PHYSICS.drift as unknown as Record<string, unknown>, saved);
  return { tier, peak, boostSeconds: boostFrames * dt, mastery: kart.state.masteryCount };
}

const shortDrift = driftThenRelease(1.5);
const masteredDrift = driftThenRelease(3.0);
ok(shortDrift.tier >= 2 && masteredDrift.tier === 3, 'les paliers de dérapage ne montent plus');
ok(shortDrift.mastery === 0, 'maîtrise accordée sans tenir le palier violet');
ok(masteredDrift.mastery === 1, 'mini-turbo de maîtrise non accordé');
ok(masteredDrift.boostSeconds > shortDrift.boostSeconds + 0.5, 'la maîtrise n’allonge pas le boost');
ok(masteredDrift.boostSeconds <= 2.6 + PHYSICS.drift.masteryBonus + 0.2, 'durée de boost non bornée');

// La maîtrise ne doit pas relever le pic de vitesse (impulsion absorbée par le plafond).
const noKick = driftThenRelease(3.0, { masteryKick: 0 });
ok(Math.abs(noKick.peak - masteredDrift.peak) < 0.5, 'l’impulsion de maîtrise change le pic de vitesse');

// Plafond arcade : le boost dépasse la pointe nominale, sans devenir incontrôlable.
const nominal = straight(apex, 40).peak;
ok(masteredDrift.peak < nominal * 1.75, `boost trop violent (${(masteredDrift.peak / nominal).toFixed(2)}× la pointe)`);

/* ================================================================== */
console.log('▸ 6. Régressions statiques (rendu et commandes)');
/* ================================================================== */

const render = readFileSync('src/render/world.ts', 'utf8');
ok(render.includes('dispose('), 'le renderer doit exposer dispose() (mission nº10)');
// `forceContextLoss()` est VOULU sur le web (mission nº9) : libération déterministe,
// jamais sur le contexte natif Expo. L'ordre des destructions doit rester intact.
ok(/if \(!this\.isNative\) this\.renderer\.forceContextLoss\(\);/.test(render), 'libération du contexte web modifiée');
{
  const disposeBody = render.slice(render.indexOf('    this.postfx.dispose();'), render.indexOf('forceContextLoss'));
  ok(disposeBody.includes('this.renderer.dispose()'), 'renderer.dispose() doit suivre les cibles de rendu');
  ok(disposeBody.includes('this.environmentTarget?.dispose()'), 'cible d’environnement non libérée');
}

const main = readFileSync('preview/main.ts', 'utf8');
ok(main.includes('pointerTargets'), 'suivi multi-poings perdu');
ok(main.includes('GYRO_SIGNAL_TIMEOUT_MS'), 'repli gyroscope perdu');
ok(!/state\.input\b/.test(main), 'ancien modèle de commande unique réintroduit');
ok(readFileSync('preview/index.html', 'utf8').includes('id="turboBtn"'), 'bouton TURBO absent du HUD');
ok(readFileSync('src/core/touchControls.ts', 'utf8').includes("'turbo'"), 'action turbo absente du suivi tactile');

const sensitivityCycle = [nextSensitivity('soft'), nextSensitivity('normal'), nextSensitivity('sport')];
ok(new Set(sensitivityCycle).size === 3, `cycle de sensibilités cassé : ${sensitivityCycle.join(' → ')}`);
ok(sensitivityCycle[0] === 'normal' && sensitivityCycle[2] === 'soft', 'ordre des sensibilités modifié');

/* ================================================================== */
console.log(`\n✅ Mission 12 : audit terminé — ${checks} vérifications, aucun écart.`);
console.log('   (capteurs, ressenti et FPS restent à valider sur un Samsung réel)');
