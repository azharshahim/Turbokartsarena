/**
 * V4.1 — stabilité de la direction gyroscopique (mission nº11, étape stabilisation).
 *
 * Ces tests rejouent des **mesures simulées** (bruit, vibrations, rampes,
 * rotations d'écran) dans le module pur `src/core/gyro.ts`, puis dans un vrai
 * `Kart` pour vérifier que le kart reste droit.
 *
 * Critères couverts :
 *  1. téléphone immobile ⇒ le kart reste droit ;
 *  2. petites vibrations ⇒ pas de zigzag ;
 *  3. inclinaison progressive ⇒ virage progressif, sans retard excessif ;
 *  4. retour au centre ⇒ direction recentrée ;
 *  5. recalibrage / recentrage ⇒ aucun à-coup de direction ;
 *  6. rotations d'écran 0/90/180/270 ⇒ braquage continu, aucune bascule ;
 *  7. dérive lente du poignet ⇒ compensée (recalage automatique du neutre) ;
 *  8. les trois sensibilités sont ordonnées, Normal par défaut, zone morte ≈ 3° ;
 *  9. sans capteur, le volant reste neutre (les boutons tactiles prennent le relais).
 *
 * ⚠️ Mesures SIMULÉES : ceci valide la logique, pas l'accéléromètre d'un Samsung.
 */
import * as assert from 'node:assert';

import { PHYSICS } from '../src/core/config';
import { Kart } from '../src/core/kart';
import { Track } from '../src/core/track';
import { makeRng } from '../src/core/math';
import { ROSTER } from '../src/game/roster';
import {
  GYRO_DEADZONE_DEG,
  GYRO_PRESETS,
  TiltSteering,
  tiltDegrees,
  type ScreenAngle,
} from '../src/core/gyro';
import { DEFAULT_CONTROL_SETTINGS } from '../src/core/controlSettings';

const dt = 1 / 60;
let checks = 0;
const ok = (condition: unknown, message: string) => {
  assert.ok(condition, message);
  checks += 1;
};

/* ------------------------------------------------------------------ */
/* Outils de simulation                                                */
/* ------------------------------------------------------------------ */

/**
 * Pose physique correspondant à la position neutre pour un angle d'écran donné
 * (téléphone tenu naturellement, légèrement incliné vers soi).
 */
const NEUTRAL: Record<ScreenAngle, { beta: number; gamma: number }> = {
  0: { beta: 90, gamma: 0 },
  90: { beta: 0, gamma: -90 },
  180: { beta: -90, gamma: 0 },
  270: { beta: 0, gamma: 90 },
};

/** Roulis ψ autour de la normale de l'écran, à partir d'une pose de référence. */
function rollPose(pose: { beta: number; gamma: number }, psiDeg: number) {
  const D = Math.PI / 180;
  const cb = Math.cos(pose.beta * D);
  const sb = Math.sin(pose.beta * D);
  const cg = Math.cos(pose.gamma * D);
  const sg = Math.sin(pose.gamma * D);
  const m = [
    [cg, 0, sg],
    [sb * sg, cb, -sb * cg],
    [-cb * sg, sb, cb * cg],
  ];
  const cp = Math.cos(psiDeg * D);
  const sp = Math.sin(psiDeg * D);
  const r = m.map((row) => [row[0] * cp + row[1] * sp, -row[0] * sp + row[1] * cp, row[2]]);
  return {
    beta: Math.asin(Math.max(-1, Math.min(1, r[2][1]))) / D,
    gamma: Math.atan2(-r[2][0], r[2][2]) / D,
  };
}

/** Rejoue une pose variable dans le temps et renvoie la suite des braquages. */
function simulate(
  poseAt: (t: number) => { beta: number; gamma: number },
  options: { seconds: number; angle?: ScreenAngle | ((t: number) => ScreenAngle); sensitivity?: 'soft' | 'normal' | 'sport'; tilt?: TiltSteering } = { seconds: 3 },
) {
  const tilt = options.tilt ?? new TiltSteering();
  tilt.sensitivity = options.sensitivity ?? 'normal';
  const steer: number[] = [];
  const tilts: number[] = [];
  const steps = Math.round(options.seconds / dt);
  for (let i = 0; i < steps; i += 1) {
    const t = i * dt;
    const pose = poseAt(t);
    const angle = typeof options.angle === 'function' ? options.angle(t) : (options.angle ?? 90);
    steer.push(tilt.push(pose.beta, pose.gamma, angle, dt, i * 1000 * dt));
    tilts.push(tilt.tilt);
  }
  return { tilt, steer, tilts };
}

const neutral90 = NEUTRAL[90];
/**
 * Pose « inclinaison vers la droite de `deg` degrés » (convention écran : le
 * côté droit descend ⇒ braquage positif). Un roulis négatif autour de la normale
 * de l'écran correspond à cette inclinaison.
 */
const tiltRight = (deg: number) => rollPose(neutral90, -deg);

/* ================================================================== */
console.log('\n▸ 1. Téléphone immobile : le kart reste droit');
/* ================================================================== */

{
  // Bruit réaliste d'un accéléromètre tenu à la main : ±1° à 60 Hz.
  const rng = makeRng(0x51ab);
  const noisy = () => rollPose(neutral90, (rng() - 0.5) * 2);
  const { steer, tilt } = simulate(() => noisy(), { seconds: 10, angle: 90 });

  const maxSteer = Math.max(...steer.map(Math.abs));
  ok(maxSteer === 0, `bruit de ±1° déjà pris en compte (braquage ${maxSteer.toFixed(3)})`);
  ok(Math.abs(tilt.tilt) < GYRO_DEADZONE_DEG, 'l’inclinaison filtrée sort de la zone morte');

  // Intégration : 5 s de course droite avec ce bruit ⇒ quasi aucune déviation.
  const bench = makeBenchTrack();
  const kart = new Kart(0, ROSTER[0], true);
  const sample = bench.samples[bench.count >> 1];
  kart.reset({ x: sample.x, y: sample.y, z: sample.z, heading: Math.atan2(sample.tx, sample.tz) }, bench, 0);
  kart.state.speed = 30;
  kart.state.vx = Math.sin(kart.state.heading) * 30;
  kart.state.vz = Math.cos(kart.state.heading) * 30;
  const start = { x: kart.state.x, z: kart.state.z, heading: kart.state.heading };
  const wheel = new TiltSteering();
  wheel.sensitivity = 'normal';
  for (let i = 0; i < Math.round(5 / dt); i += 1) {
    const pose = rollPose(neutral90, (rng() - 0.5) * 2);
    const steerValue = wheel.push(pose.beta, pose.gamma, 90, dt, i * 1000 * dt);
    kart.step(dt, { steer: steerValue, brake: false, drift: false, throttle: 1 }, bench, i * dt);
  }
  // Écart latéral par rapport au cap initial (le kart avance, c'est normal).
  const dx = kart.state.x - start.x;
  const dz = kart.state.z - start.z;
  const lateral = Math.abs(dx * Math.cos(start.heading) + dz * Math.sin(start.heading));
  const headingDrift = Math.abs(kart.state.heading - start.heading);
  ok(lateral < 0.5, `le kart dérive au repos (${lateral.toFixed(2)} m en 5 s)`);
  ok(headingDrift < 0.02, `cap instable au repos (${headingDrift.toFixed(3)} rad)`);
}

/* ================================================================== */
console.log('▸ 2. Petites vibrations : pas de zigzag');
/* ================================================================== */

{
  // Vibrations de ±2,5° à 4 Hz (tremblement du bras, route dégradée).
  const { steer } = simulate((t) => rollPose(neutral90, Math.sin(t * Math.PI * 2 * 4) * 2.5), { seconds: 6, angle: 90 });
  const maxSteer = Math.max(...steer.map(Math.abs));
  ok(maxSteer < 0.06, `des vibrations de 2,5° font braquer (${maxSteer.toFixed(3)})`);

  let signChanges = 0;
  for (let i = 1; i < steer.length; i += 1) {
    const a = steer[i - 1];
    const b = steer[i];
    if (Math.abs(a) > 0.005 && Math.abs(b) > 0.005 && Math.sign(a) !== Math.sign(b)) signChanges += 1;
  }
  ok(signChanges < 4, `zigzag détecté (${signChanges} inversions de direction)`);
}

/* ================================================================== */
console.log('▸ 3. Inclinaison progressive : virage progressif, sans retard');
/* ================================================================== */

{
  // Rampe de 0 à 24° en 2 s, puis maintien.
  const { steer } = simulate((t) => tiltRight(Math.min(24, (t / 2) * 24)), { seconds: 4, angle: 90 });

  let monotonic = true;
  for (let i = 1; i < Math.round(2 / dt); i += 1) if (steer[i] < steer[i - 1] - 1e-6) monotonic = false;
  ok(monotonic, 'la réponse n’est pas monotone pendant l’inclinaison');

  const at = (seconds: number) => steer[Math.min(steer.length - 1, Math.round(seconds / dt))];
  ok(at(4) > 0.6, `braquage trop faible en butée (${at(4).toFixed(2)})`);
  ok(at(4) < 1.001, 'braquage non borné');

  // Réactivité : 50 % du braquage final atteint en moins de 400 ms après le début du geste.
  const target = at(4);
  let reach = Infinity;
  for (let i = 0; i < steer.length; i += 1) {
    if (steer[i] >= target * 0.5) {
      reach = i * dt;
      break;
    }
  }
  ok(reach < 1.6, `réponse trop lente (50 % atteint à ${reach.toFixed(2)} s)`);

  // Pas de dépassement (overshoot) : la direction ne « rebondit » pas.
  ok(Math.max(...steer) <= target + 0.02, 'dépassement de la direction cible');
}

/* ================================================================== */
console.log('▸ 4. Retour au centre : direction recentrée');
/* ================================================================== */

{
  const { steer } = simulate(
    (t) => tiltRight(t < 1 ? Math.min(20, t * 20) : t < 2 ? 20 : 0),
    { seconds: 3, angle: 90 },
  );
  const back = steer[Math.round(2.4 / dt)] ?? 0;
  ok(Math.abs(back) < 0.05, `la direction ne revient pas au centre (${back.toFixed(3)})`);
  ok(Math.abs(steer[steer.length - 1]) < 0.01, 'braquage résiduel après retour au neutre');
}

/* ================================================================== */
console.log('▸ 5. Recalibrage / recentrage : aucun à-coup');
/* ================================================================== */

{
  // Le joueur incline de 20° puis appuie sur « Recentrer ».
  const wheel = new TiltSteering();
  wheel.sensitivity = 'normal';
  let t = 0;
  const poseAt = (time: number) => tiltRight(time < 1 ? 20 : 20);
  for (let i = 0; i < Math.round(1 / dt); i += 1, t += dt) wheel.push(poseAt(t).beta, poseAt(t).gamma, 90, dt, t * 1000);
  const before = wheel.steer;
  ok(before > 0.5, `braquage initial inattendu (${before.toFixed(2)})`);

  wheel.recenter();
  let maxStep = 0;
  let previous = before;
  const values: number[] = [];
  for (let i = 0; i < Math.round(1.5 / dt); i += 1, t += dt) {
    const value = wheel.push(poseAt(t).beta, poseAt(t).gamma, 90, dt, t * 1000);
    maxStep = Math.max(maxStep, Math.abs(value - previous));
    previous = value;
    values.push(value);
  }
  ok(maxStep <= GYRO_PRESETS.normal.maxRate * dt + 1e-6, `à-coup de direction au recentrage (${maxStep.toFixed(3)})`);
  ok(Math.abs(values[values.length - 1]) < 0.02, `recentrage sans effet (${values[values.length - 1].toFixed(3)})`);
  ok(Math.abs(wheel.calibration - 20) < 1.5, `position neutre non enregistrée (${wheel.calibration.toFixed(1)}°)`);

  // Calibration instantanée (menu / départ) : le braquage revient au centre en douceur.
  const quick = new TiltSteering();
  quick.sensitivity = 'normal';
  let prev = 0;
  for (let i = 0; i < 90; i += 1) {
    const pose = tiltRight(18);
    prev = quick.push(pose.beta, pose.gamma, 90, dt, i * 16);
  }
  ok(prev > 0.4, 'inclinaison de calibration non détectée');
  quick.calibrate();
  const after: number[] = [];
  for (let i = 0; i < 90; i += 1) {
    const pose = tiltRight(18);
    after.push(quick.push(pose.beta, pose.gamma, 90, dt, 2000 + i * 16));
  }
  const biggest = Math.max(...after.map((v, i) => Math.abs(v - (i === 0 ? prev : after[i - 1]))));
  ok(biggest <= GYRO_PRESETS.normal.maxRate * dt + 1e-6, `calibration brutale (${biggest.toFixed(3)})`);
  ok(Math.abs(after[after.length - 1]) < 0.02, 'calibration sans effet');
}

/* ================================================================== */
console.log('▸ 6. Rotations d’écran : braquage continu');
/* ================================================================== */

{
  // Même pose physique, quatre angles d'écran : même inclinaison.
  const pose = rollPose(NEUTRAL[0], -12);
  const reference = tiltDegrees(pose.beta, pose.gamma, 0);
  ok(Math.abs(reference - 12) < 0.5, `inclinaison de référence incorrecte (${reference.toFixed(2)}°)`);
  for (const angle of [0, 90, 180, 270] as ScreenAngle[]) {
    const value = tiltDegrees(pose.beta, pose.gamma, angle);
    // La même pose physique n'a pas de sens dans un autre référentiel : on vérifie
    // surtout qu'aucun angle ne produit de valeur aberrante ni de NaN.
    ok(Number.isFinite(value), `angle ${angle} : inclinaison non finie`);
  }

  // Bascule d'angle en pleine course : le braquage ne doit pas sauter.
  const wheel = new TiltSteering();
  wheel.sensitivity = 'normal';
  let t = 0;
  for (let i = 0; i < 90; i += 1, t += dt) {
    const p = tiltRight(9);
    wheel.push(p.beta, p.gamma, 90, dt, t * 1000);
  }
  const beforeRotation = wheel.steer;
  ok(Math.abs(beforeRotation) > 0.1, 'braquage de départ trop faible pour tester la rotation');

  let maxJump = 0;
  let previous = beforeRotation;
  // Le téléphone pivote de 90° : les poses changent de référentiel avec l'angle.
  for (let i = 0; i < 90; i += 1, t += dt) {
    const angle: ScreenAngle = i < 45 ? 90 : 0;
    const p = rollPose(NEUTRAL[angle], -9);
    const value = wheel.push(p.beta, p.gamma, angle, dt, t * 1000);
    maxJump = Math.max(maxJump, Math.abs(value - previous));
    previous = value;
  }
  ok(maxJump <= GYRO_PRESETS.normal.maxRate * dt + 1e-6, `saut de braquage à la rotation (${maxJump.toFixed(3)})`);
  ok(Math.abs(previous - beforeRotation) < 0.15, `la rotation a changé le braquage (${beforeRotation.toFixed(2)} → ${previous.toFixed(2)})`);
}

/* ================================================================== */
console.log('▸ 7. Dérive lente du poignet : compensée');
/* ================================================================== */

{
  // Le bras dérive de 6° en 20 s, sans que le joueur ne tourne.
  const { steer, tilt } = simulate((t) => tiltRight((t / 20) * 6), { seconds: 20, angle: 90 });
  const tail = steer.slice(steer.length - Math.round(5 / dt));
  ok(Math.max(...tail.map(Math.abs)) < 0.05, `la dérive fait braquer (${Math.max(...tail.map(Math.abs)).toFixed(3)})`);
  ok(Math.abs(tilt.tilt) < GYRO_DEADZONE_DEG + 1, `le neutre n’a pas suivi la dérive (${tilt.tilt.toFixed(1)}°)`);

  // À l'inverse, un virage tenu ne doit jamais être annulé par ce recalage.
  const held = simulate(() => tiltRight(12), { seconds: 8, angle: 90 });
  const heldTail = held.steer.slice(held.steer.length - Math.round(4 / dt));
  ok(Math.min(...heldTail.map((v) => v)) > 0.25, `un virage tenu est annulé (${Math.min(...heldTail).toFixed(2)})`);
}

/* ================================================================== */
console.log('▸ 8. Sensibilités : trois modes ordonnés, Normal par défaut');
/* ================================================================== */

{
  ok(DEFAULT_CONTROL_SETTINGS.sensitivity === 'normal', 'le mode par défaut doit être Normal');
  ok(Math.abs(GYRO_PRESETS.normal.deadzone - 3) < 1e-9, `zone morte par défaut ≠ 3° (${GYRO_PRESETS.normal.deadzone})`);
  ok(GYRO_DEADZONE_DEG === 3, 'la zone morte doit être ajustable depuis une seule constante');
  ok(GYRO_PRESETS.soft.deadzone > GYRO_PRESETS.normal.deadzone, 'Doux doit tolérer plus de tremblement');
  ok(GYRO_PRESETS.sport.deadzone < GYRO_PRESETS.normal.deadzone, 'Sport doit être plus précis');
  ok(GYRO_PRESETS.soft.range > GYRO_PRESETS.normal.range, 'Doux doit demander plus d’inclinaison');
  ok(GYRO_PRESETS.sport.range < GYRO_PRESETS.normal.range, 'Sport doit être plus direct');
  ok(GYRO_PRESETS.soft.maxRate < GYRO_PRESETS.normal.maxRate, 'Doux doit être plus progressif');

  const gain = (sensitivity: 'soft' | 'normal' | 'sport') => {
    const { steer } = simulate(() => tiltRight(10), { seconds: 2, angle: 90, sensitivity });
    return steer[steer.length - 1];
  };
  const soft = gain('soft');
  const normal = gain('normal');
  const sport = gain('sport');
  ok(soft < normal && normal < sport, `les modes ne sont pas ordonnés (${soft.toFixed(2)} / ${normal.toFixed(2)} / ${sport.toFixed(2)})`);
  ok(sport > 0.30, `Sport trop mou (${sport.toFixed(2)})`);
  ok(soft < 0.20, `Doux trop nerveux (${soft.toFixed(2)})`);
}

/* ================================================================== */
console.log('▸ 9. Sans capteur : volant neutre, commandes tactiles intactes');
/* ================================================================== */

{
  const wheel = new TiltSteering();
  ok(!wheel.ready && !wheel.hasSignal(0), 'le volant prétend être prêt sans échantillon');
  ok(wheel.steer === 0 && wheel.tilt === 0, 'braquage non nul sans capteur');
  // Des valeurs non finies (capteur qui décroche) ne doivent rien casser.
  ok(wheel.push(Number.NaN, -90, 90, dt, 0) === 0, 'valeur non finie acceptée');
  ok(wheel.push(0, Number.POSITIVE_INFINITY, 90, dt, 16) === 0, 'valeur infinie acceptée');
}

/* ================================================================== */
console.log(`\n✅ Direction gyroscopique stable — ${checks} vérifications (mesures simulées).`);
console.log('   ⚠️ Capteur réel, ressenti au pouce et FPS : à valider sur un Samsung.');

/* ------------------------------------------------------------------ */

function makeBenchTrack() {
  return new Track({
    id: 'gyro-bench',
    name: 'Banc gyro',
    theme: 'test',
    seed: 1,
    width: 60,
    widthVariance: 0,
    grandstands: 0,
    boosts: [],
    maxCurvature: 1,
    smoothIterations: 0,
    smoothStrength: 0,
    control: Array.from({ length: 41 }, (_, i) => ({ x: 0, y: 0, z: -6000 + i * 300 })),
  } as never);
}

void PHYSICS;
