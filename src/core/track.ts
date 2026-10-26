/**
 * Turbo Karts Arena — piste 3D.
 *
 * La piste est une spline fermée échantillonnée par longueur d'arc.
 * Toutes les requêtes (position → progression, surface, dévers, hauteur) sont O(1)
 * grâce à une recherche locale fenêtrée sur l'index de progression courant.
 */

import { clamp, damp, lerp, smoothstep } from './math';

export type SurfaceKind = 'road' | 'curb' | 'grass' | 'boost' | 'ramp';

export interface TrackControlPoint {
  x: number;
  y: number;
  z: number;
}

export interface TrackLayout {
  id: string;
  name: string;
  theme: string;
  seed: number;
  /** Points de contrôle de la spline fermée (y = altitude). */
  control: TrackControlPoint[];
  /** Largeur de base (m). */
  width: number;
  /** Variation de largeur (m) : les épingles s'élargissent. */
  widthVariance: number;
  /** Multiplicateur de largeur; les virages restent limités par leur rayon intérieur. */
  widthScale?: number;
  /** Zones de turbo posées sur la piste : [progression 0..1, offset latéral -1..1, longueur]. */
  boosts: Array<[number, number, number]>;
  /** Nombre de stands / tribunes le long du circuit. */
  grandstands: number;
  /** Réglage du lissage du tracé (plus haut = virages plus larges). */
  smoothIterations?: number;
  smoothStrength?: number;
  /** Courbure maximale autorisée (1/m). 0,042 ⇒ rayon minimal ≈ 24 m. */
  maxCurvature?: number;
}

export interface TrackSample {
  x: number;
  y: number;
  z: number;
  /** Tangente 2D normalisée. */
  tx: number;
  tz: number;
  /** Vecteur "droite" 2D normalisé. */
  rx: number;
  rz: number;
  /** Courbure signée (1/m). */
  curvature: number;
  /** Demi-largeur (m). */
  halfWidth: number;
  /** Dévers (m par mètre latéral). */
  bank: number;
  s: number;
}

export interface TrackQuery {
  s: number;
  lateral: number;
  halfWidth: number;
  surface: SurfaceKind;
  y: number;
  curvature: number;
  onRoad: boolean;
  /** Index d'échantillon le plus proche. */
  index: number;
}

const SAMPLE_SPACING = 2.0;

export class Track {
  readonly layout: TrackLayout;
  readonly samples: TrackSample[] = [];
  readonly length: number;
  readonly step = SAMPLE_SPACING;
  readonly count: number;
  /** Zones de boost en coordonnées piste (s, offset latéral m, demi-longueur). */
  readonly boostZones: Array<{ s: number; lateral: number; half: number; halfWidth: number }> = [];

  constructor(layout: TrackLayout) {
    this.layout = layout;
    const ctrl = layout.control.map((p) => ({ x: p.x, y: p.y, z: p.z }));

    // 1) Sur-échantillonnage de la spline de Catmull-Rom fermée
    const dense = sampleClosedCatmullRom(ctrl, 64);
    const denseLen = polylineLength(dense, true);
    const count = Math.max(64, Math.round(denseLen / SAMPLE_SPACING));
    let step = denseLen / count;

    // 2) Ré-échantillonnage à pas constant (longueur d'arc)
    let resampled = resampleClosed(dense, count);
    // 2b) rayons de virage jouables : lissage global + limiteur de courbure
    smoothLoop(resampled, layout.smoothIterations ?? 10, layout.smoothStrength ?? 0.22);
    limitCurvature(resampled, layout.maxCurvature ?? 0.045, 2000);
    // 2c) re-ré-échantillonnage (le lissage + le limiteur modifient la longueur)
    resampled = resampleClosed(resampled, count);
    // `step` doit refléter la longueur FINALE, sinon la courbure est faussée.
    const finalLen = polylineLength(resampled, true);
    step = finalLen / count;

    // 3) Calcul des tangentes / normales / courbures / largeurs
    for (let i = 0; i < count; i++) {
      const p = resampled[i];
      const prev = resampled[(i - 1 + count) % count];
      const next = resampled[(i + 1) % count];
      let tx = next.x - prev.x;
      let tz = next.z - prev.z;
      const tl = Math.hypot(tx, tz) || 1;
      tx /= tl;
      tz /= tl;
      // "droite" = tangente tournée de -90° dans le plan XZ
      const rx = -tz;
      const rz = tx;
      const s = i * step;

      // la courbure est calculée dans un SECOND passage (voir plus bas)
      const curvature = 0;

      this.samples.push({
        x: p.x,
        y: p.y,
        z: p.z,
        tx,
        tz,
        rx,
        rz,
        curvature,
        halfWidth: layout.width * 0.5,
        bank: 0,
        s,
      });
    }

    this.count = count;
    this.length = step * count;

    // --- 2e passage : courbure signée dans la convention du cap du kart ---
    //   curvature > 0  ⇒  la piste tourne à GAUCHE
    //   (heading = atan2(tx, tz) ; un cap qui augmente = virage à gauche)
    for (let i = 0; i < count; i++) {
      const a = resampled[(i - 2 + count) % count];
      const p = resampled[i];
      const b = resampled[(i + 2) % count];
      const hPrev = Math.atan2(p.x - a.x, p.z - a.z);
      const hNext = Math.atan2(b.x - p.x, b.z - p.z);
      let dAng = hNext - hPrev;
      if (dAng > Math.PI) dAng -= Math.PI * 2;
      if (dAng < -Math.PI) dAng += Math.PI * 2;
      // Courbure = variation de cap / longueur d'arc RÉELLE parcourue.
      // (L'espacement peut ne plus être exactement uniforme après lissage.)
      const span = Math.max(
        0.5,
        Math.hypot(p.x - a.x, p.z - a.z) + Math.hypot(b.x - p.x, b.z - p.z),
      );
      this.samples[i].curvature = dAng / span;

      // largeur : épingles plus larges (utile pour la jouabilité), lignes droites plus fines
      const bend = smoothstep(0.004, 0.038, Math.abs(this.samples[i].curvature));
      const wobble = Math.sin(i * 0.11) * 0.5 + Math.sin(i * 0.037 + 1.7) * 0.5;
      const baseHalfWidth = layout.width * 0.5 + layout.widthVariance * (bend * 0.85 + wobble * 0.25);
      const requestedHalfWidth = baseHalfWidth * (layout.widthScale ?? 1);
      // Le multiplicateur ne doit pas franchir le rayon intérieur minimal
      // (1,8 m) là où la largeur de base le permet. Si la largeur historique
      // est déjà au-dessus de ce plafond, on la conserve plutôt que de réduire
      // la route ou d'aggraver le chevauchement existant.
      const radius = Math.abs(this.samples[i].curvature) > 1e-4
        ? 1 / Math.abs(this.samples[i].curvature)
        : Infinity;
      const safeHalfWidth = Math.max(baseHalfWidth, radius - 1.8);
      this.samples[i].halfWidth = Math.min(requestedHalfWidth, safeHalfWidth);
      // dévers dans les virages
      this.samples[i].bank = clamp(this.samples[i].curvature * 3.2, -0.09, 0.09);
    }

    // 4) Zones de boost
    for (const [t, off, len] of layout.boosts) {
      const s = t * this.length;
      const smp = this.sampleAtIndex(Math.round(s / step) % count);
      this.boostZones.push({
        s,
        lateral: off * smp.halfWidth * 0.62,
        half: len * 0.5,
        halfWidth: Math.min(2.6, smp.halfWidth * 0.34),
      });
    }
  }

  sampleAtIndex(i: number): TrackSample {
    const n = this.samples.length;
    return this.samples[((i % n) + n) % n];
  }

  /** Échantillon interpolé à une distance curviligne donnée (avec wrap). */
  sampleAtDistance(s: number): TrackSample {
    const n = this.samples.length;
    let f = (s / this.step) % n;
    if (f < 0) f += n;
    const i0 = Math.floor(f);
    const t = f - i0;
    const a = this.samples[i0 % n];
    const b = this.samples[(i0 + 1) % n];
    if (t < 0.0001) return a;
    return {
      x: lerp(a.x, b.x, t),
      y: lerp(a.y, b.y, t),
      z: lerp(a.z, b.z, t),
      tx: lerp(a.tx, b.tx, t),
      tz: lerp(a.tz, b.tz, t),
      rx: lerp(a.rx, b.rx, t),
      rz: lerp(a.rz, b.rz, t),
      curvature: lerp(a.curvature, b.curvature, t),
      halfWidth: lerp(a.halfWidth, b.halfWidth, t),
      bank: lerp(a.bank, b.bank, t),
      s: i0 * this.step + t * this.step,
    };
  }

  /** Point du monde à (progression, offset latéral). */
  worldAt(s: number, lateral: number, out?: { x: number; y: number; z: number }) {
    const smp = this.sampleAtDistance(s);
    const o = out ?? { x: 0, y: 0, z: 0 };
    o.x = smp.x + smp.rx * lateral;
    o.z = smp.z + smp.rz * lateral;
    o.y = smp.y + lateral * smp.bank;
    return o;
  }

  /**
   * Trajectoire de course : la corde intérieure des virages.
   * `lateral` positif = à DROITE du sens de course (right = forward × up).
   * Virage à gauche (curvature > 0) → la corde est à droite → offset positif.
   */
  racingLineOffset(s: number) {
    const smp = this.sampleAtDistance(s);
    const inner = Math.sign(smp.curvature) * smoothstep(0.002, 0.03, Math.abs(smp.curvature));
    return inner * smp.halfWidth * 0.55;
  }

  /**
   * Requête de proximité. `hintIndex` accélère la recherche (fenêtre ±40 échantillons
   * = ±80 m) ; au-delà (respawn, téléportation) on fait une recherche globale.
   */
  query(x: number, z: number, hintIndex: number, hintValid = true): TrackQuery {
    const n = this.samples.length;
    let bestI = 0;
    let bestD = Infinity;

    if (hintValid && hintIndex >= 0) {
      for (let k = -40; k <= 40; k++) {
        const i = (hintIndex + k + n * 2) % n;
        const p = this.samples[i];
        const dx = x - p.x;
        const dz = z - p.z;
        const d = dx * dx + dz * dz;
        if (d < bestD) {
          bestD = d;
          bestI = i;
        }
      }
    } else {
      for (let i = 0; i < n; i++) {
        const p = this.samples[i];
        const dx = x - p.x;
        const dz = z - p.z;
        const d = dx * dx + dz * dz;
        if (d < bestD) {
          bestD = d;
          bestI = i;
        }
      }
    }

    const p = this.samples[bestI];
    const dx = x - p.x;
    const dz = z - p.z;
    const lateral = dx * p.rx + dz * p.rz;
    const along = dx * p.tx + dz * p.tz;
    const absLat = Math.abs(lateral);

    let surface: SurfaceKind = 'road';
    if (absLat > p.halfWidth + 1.6) surface = 'grass';
    else if (absLat > p.halfWidth - 0.35) surface = 'curb';

    // hauteur du sol à cet endroit (piste + dévers, puis talus hors piste)
    let y = p.y + clamp(lateral, -p.halfWidth, p.halfWidth) * p.bank;
    if (absLat > p.halfWidth) {
      const over = absLat - p.halfWidth;
      y -= Math.min(1.1, over * 0.16);
    }

    // zones de boost
    if (surface !== 'grass') {
      for (let i = 0; i < this.boostZones.length; i++) {
        const b = this.boostZones[i];
        let ds = this.samples[bestI].s + along - b.s;
        const half = this.length * 0.5;
        if (ds > half) ds -= this.length;
        if (ds < -half) ds += this.length;
        if (Math.abs(ds) <= b.half && Math.abs(lateral - b.lateral) <= b.halfWidth) {
          surface = 'boost';
          break;
        }
      }
    }

    return {
      s: p.s + along,
      lateral,
      halfWidth: p.halfWidth,
      surface,
      y,
      curvature: p.curvature,
      onRoad: absLat <= p.halfWidth,
      index: bestI,
    };
  }

  /** Point de réapparition sur la piste (après une chute ou un blocage). */
  respawnPoint(s: number, lateral: number) {
    const smp = this.sampleAtDistance(s);
    const lat = clamp(lateral, -smp.halfWidth * 0.5, smp.halfWidth * 0.5);
    return {
      x: smp.x + smp.rx * lat,
      y: smp.y + lat * smp.bank + 0.6,
      z: smp.z + smp.rz * lat,
      heading: Math.atan2(smp.tx, smp.tz),
    };
  }

  /** Positions de départ en grille, décalées derrière la ligne. */
  gridPositions(count: number) {
    const out: Array<{ x: number; y: number; z: number; heading: number }> = [];
    const rowGap = 7.4;
    const colGap = 4.2;
    const startS = this.length - 12; // la ligne est à s = 0
    for (let i = 0; i < count; i++) {
      const row = Math.floor(i / 2);
      const col = i % 2;
      const s = startS - row * rowGap;
      const lat = (col === 0 ? -1 : 1) * colGap * 0.5;
      const p = this.worldAt(s, lat);
      const smp = this.sampleAtDistance(s);
      out.push({ x: p.x, y: p.y + 0.05, z: p.z, heading: Math.atan2(smp.tx, smp.tz) });
    }
    return out;
  }

  /** Bandeau de mini-carte normalisé (x, y dans [0,1]) pour le HUD. */
  minimapPath(resolution = 96) {
    const pts: Array<[number, number]> = [];
    const n = this.samples.length;
    const stride = Math.max(1, Math.floor(n / resolution));
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i < n; i += stride) {
      const p = this.samples[i];
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z);
      maxZ = Math.max(maxZ, p.z);
    }
    const w = Math.max(1, maxX - minX);
    const h = Math.max(1, maxZ - minZ);
    const k = 1 / Math.max(w, h);
    for (let i = 0; i < n; i += stride) {
      const p = this.samples[i];
      pts.push([(p.x - minX) * k + (1 - w * k) * 0.5, (p.z - minZ) * k + (1 - h * k) * 0.5]);
    }
    return pts;
  }

  /** Hauteur du terrain hors piste (talus / collines) pour poser le décor. */
  groundHeight(x: number, z: number, hintIndex = -1) {
    const q = this.query(x, z, hintIndex, hintIndex >= 0);
    const over = Math.max(0, Math.abs(q.lateral) - q.halfWidth);
    const bank = smoothstep(2, 34, over);
    const hills = Math.sin(x * 0.018) * Math.cos(z * 0.021) * 5.5 + Math.sin(x * 0.05 + z * 0.03) * 1.6;
    return lerp(q.y, q.y + hills * 0.9 + 1.2, bank) - Math.min(6, over * 0.05);
  }

  /** Adoucit la caméra/hypothèse de cap lors d'un respawn. */
  headingAt(s: number) {
    const smp = this.sampleAtDistance(s);
    return Math.atan2(smp.tx, smp.tz);
  }
}

/* ------------------------------------------------------------------ */
/* Géométrie de spline                                                 */
/* ------------------------------------------------------------------ */

/**
 * Catmull-Rom CENTRIPÈTE (α = 0,5) : contrairement à la version uniforme, elle ne
 * produit ni boucles ni pointes quand les points de contrôle sont irréguliers —
 * indispensable pour obtenir des rayons de virage jouables.
 */
function sampleClosedCatmullRom(ctrl: TrackControlPoint[], subdivisions: number) {
  const out: TrackControlPoint[] = [];
  const n = ctrl.length;
  const alpha = 0.5;
  const dist = (a: TrackControlPoint, b: TrackControlPoint) =>
    Math.max(1e-4, Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z));
  const mix = (a: TrackControlPoint, b: TrackControlPoint, t: number) =>
    ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t });
  for (let i = 0; i < n; i++) {
    const p0 = ctrl[(i - 1 + n) % n];
    const p1 = ctrl[i];
    const p2 = ctrl[(i + 1) % n];
    const p3 = ctrl[(i + 2) % n];
    const d01 = Math.pow(dist(p0, p1), alpha);
    const d12 = Math.pow(dist(p1, p2), alpha);
    const d23 = Math.pow(dist(p2, p3), alpha);
    const t0 = 0;
    const t1 = t0 + d01;
    const t2 = t1 + d12;
    const t3 = t2 + d23;
    for (let j = 0; j < subdivisions; j++) {
      const t = t1 + ((t2 - t1) * j) / subdivisions;
      const A1 = mix(p0, p1, (t - t0) / (t1 - t0));
      const A2 = mix(p1, p2, (t - t1) / (t2 - t1));
      const A3 = mix(p2, p3, (t - t2) / (t3 - t2));
      const B1 = mix(A1, A2, (t - t0) / (t2 - t0));
      const B2 = mix(A2, A3, (t - t1) / (t3 - t1));
      out.push(mix(B1, B2, (t - t1) / (t2 - t1)));
    }
  }
  return out;
}

/**
 * Limiteur de courbure : n'arrondit QUE les zones trop serrées (épingles) en
 * rapprochant localement chaque point du milieu de ses voisins, proportionnellement
 * à l'excès de courbure. Le reste du tracé n'est pas touché.
 */
function limitCurvature(pts: TrackControlPoint[], maxK: number, iterations: number) {

  const n = pts.length;
  for (let it = 0; it < iterations; it++) {
    let worst = 0;
    const snap = pts.map((p) => ({ ...p }));
    for (let i = 0; i < n; i++) {
      const a = snap[(i - 2 + n) % n];
      const p = snap[i];
      const b = snap[(i + 2) % n];
      const hPrev = Math.atan2(p.x - a.x, p.z - a.z);
      const hNext = Math.atan2(b.x - p.x, b.z - p.z);
      let d = hNext - hPrev;
      if (d > Math.PI) d -= Math.PI * 2;
      if (d < -Math.PI) d += Math.PI * 2;
      // hPrev/hNext sont les caps aux points i-1 et i+1 : la différence porte
      // sur 2 pas de piste (2 × SAMPLE_SPACING).
      // Normalisation par la distance RÉELLE entre les points (le limiteur
      // rapproche les points dans les épingles : un pas fixe sous-estimerait
      // fortement la courbure).
      const span = Math.max(
        0.5,
        Math.hypot(p.x - a.x, p.z - a.z) + Math.hypot(b.x - p.x, b.z - p.z),
      );
      const k = Math.abs(d) / span;
      worst = Math.max(worst, k);
      if (k > maxK) {
        const excess = Math.min(1, (k - maxK) / maxK);
        const s = 0.85 * excess;
        const a1 = snap[(i - 1 + n) % n];
        const b1 = snap[(i + 1) % n];
        pts[i].x = p.x + ((a1.x + b1.x) * 0.5 - p.x) * s;
        pts[i].z = p.z + ((a1.z + b1.z) * 0.5 - p.z) * s;
        pts[i].y = p.y + ((a1.y + b1.y) * 0.5 - p.y) * s * 0.4;
      }
    }
    if (worst <= maxK * 1.02) break;
  }
  return pts;
}

/**
 * Lissage Laplacien de la boucle : arrondit les épingles trop serrées pour garantir
 * un rayon minimal (sinon injouable à 150 km/h). Le tracé global est conservé.
 */
function smoothLoop(pts: TrackControlPoint[], iterations: number, strength: number, yFactor = 0.35) {
  const n = pts.length;
  for (let it = 0; it < iterations; it++) {
    const snapshot = pts.map((p) => ({ ...p }));
    for (let i = 0; i < n; i++) {
      const a = snapshot[(i - 1 + n) % n];
      const b = snapshot[i];
      const c = snapshot[(i + 1) % n];
      pts[i].x = b.x + ((a.x + c.x) * 0.5 - b.x) * strength;
      pts[i].z = b.z + ((a.z + c.z) * 0.5 - b.z) * strength;
      pts[i].y = b.y + ((a.y + c.y) * 0.5 - b.y) * strength * yFactor;
    }
  }
  return pts;
}

function polylineLength(pts: TrackControlPoint[], closed: boolean) {
  let len = 0;
  const n = pts.length;
  const last = closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    len += Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  }
  return len;
}

function resampleClosed(pts: TrackControlPoint[], count: number) {
  const n = pts.length;
  const cum: number[] = [0];
  for (let i = 1; i <= n; i++) {
    const a = pts[i - 1];
    const b = pts[i % n];
    cum.push(cum[i - 1] + Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z));
  }
  const total = cum[n];
  const out: TrackControlPoint[] = [];
  let seg = 0;
  for (let k = 0; k < count; k++) {
    const target = (k / count) * total;
    while (seg < n - 1 && cum[seg + 1] < target) seg++;
    const a = pts[seg];
    const b = pts[(seg + 1) % n];
    const segLen = cum[seg + 1] - cum[seg] || 1;
    const t = clamp((target - cum[seg]) / segLen, 0, 1);
    out.push({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), z: lerp(a.z, b.z, t) });
  }
  return out;
}

/** Utilisé par l'IA : lissage exponentiel d'un écart de cap. */
export function steerTowards(current: number, target: number, gain: number, dt: number) {
  let d = target - current;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return clamp(damp(0, d, gain, dt), -1, 1);
}
