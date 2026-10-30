import type { WebGLRenderer } from 'three';
import { mountGarage } from './garage';
/**
 * Turbo Karts Arena — hôte navigateur (preview jouable).
 *
 * Rôle strictement équivalent à App.tsx côté Android : il ne contient AUCUNE
 * logique de jeu, seulement l'UI, les entrées (clavier / tactile / gyroscope) et
 * le branchement du moteur partagé `src/render/world.ts`.
 */

import { PhysicsEngine } from '../src/render/world';
import { CIRCUITS } from '../src/game/circuits';
import { Showroom } from '../src/render/showroom';
import { VEHICLES, vehicleProfile, DIFFICULTIES, type Difficulty } from '../src/game/vehicles';
import { awardRace, buyUpgrade, buyVehicle, loadGarage, saveGarage, upgradeCost, upgradeMultiplier, UPGRADE_KINDS, type GarageState, type UpgradeKind, upgradedProfile } from '../src/game/economy';

const webStorage = { getItem: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } }, setItem: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* stockage indisponible */ } } };
let garage: GarageState = loadGarage(webStorage);
let upKind: UpgradeKind = 'engine';
let raceAwardId = '';
const persistGarage = () => saveGarage(webStorage, garage);
import { ROSTER } from '../src/game/roster';
import { autoQuality, QUALITY, type QualityLevel } from '../src/core/config';
import { formatLap, formatTime } from '../src/core/race';
import { MultiTouchControls, type TouchAction } from '../src/core/touchControls';
import {
  loadControlSettings,
  nextSensitivity,
  nextSteerMode,
  nextThrottleMode,
  saveControlSettings,
  SENSITIVITY_LABEL,
  STEER_MODE_LABEL,
  THROTTLE_MODE_LABEL,
  type ControlSettings,
} from '../src/core/controlSettings';
import { GYRO_SIGNAL_TIMEOUT_MS, TiltSteering, readScreenAngle } from '../src/core/gyro';
import { versionBadge, versionDiagnostics, versionInfo } from '../src/core/version';

const boot = (window as any).__tkaBoot as {
  note: (phase: string, detail?: unknown) => void;
  fail: (error: unknown, phase?: string) => void;
  finish: () => void;
  recover: (phase: string) => void;
} | undefined;
boot?.note('initialisation de l’interface');
const $ = (id: string) => document.getElementById(id)!;
/** Réglages de commande sauvegardés (localStorage, tolérant aux erreurs). */
const persistControls = () => saveControlSettings(webStorage, state.controls);
const state = {
  circuitIndex: 0,
  driverIndex: 0,
  vehicleIndex: 0,
  difficulty: 'arcade' as Difficulty,
  quality: 'auto' as QualityLevel | 'auto',
  /** V4.1 : commandes persistées (mode, sensibilité, calibration, accélération). */
  controls: loadControlSettings(webStorage) as ControlSettings,
  laps: 3,
  showFps: false,
  reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
  paused: false,
  screen: 'menu' as 'menu' | 'race' | 'results',
  starting: false,
};

let engine: PhysicsEngine | null = null;
let showroom: Showroom | null = null;
let garageRaf = 0;
let releaseGarageContext = () => {};
let releaseRaceContext = () => {};

function renderFailure(error: unknown, phase: string) {
  stopLoop(); cancelAnimationFrame(garageRaf); garageRaf = 0;
  window.clearTimeout(finishTimeout); finishTimeout = 0;
  state.starting = false;
  if (state.screen === 'race') {
    state.paused = true; clearHeldInputs(); $('pause').classList.remove('hidden');
  }
  $('loading').classList.add('hidden');
  boot?.fail(error, phase);
}

function observeRenderer(renderer: WebGLRenderer, canvas: HTMLCanvasElement, owner: 'garage' | 'course') {
  const phase = `contexte WebGL : ${owner}`;
  let lost = false, disposed = false;
  renderer.debug.onShaderError = (gl, program, vertex, fragment) => {
    throw new Error(`Shader ${owner}: ${gl.getProgramInfoLog(program)} ${gl.getShaderInfoLog(vertex)} ${gl.getShaderInfoLog(fragment)}`);
  };
  const gl = renderer.getContext();
  const gpuInfo = gl.getExtension('WEBGL_debug_renderer_info');
  boot?.note(`WebGL initialisé : ${owner}`, {
    maxTextureSize: renderer.capabilities.maxTextureSize,
    maxRenderbufferSize: gl.getParameter(gl.MAX_RENDERBUFFER_SIZE),
    colorBufferFloat: !!gl.getExtension('EXT_color_buffer_float'),
    gpu: gpuInfo ? String(gl.getParameter(gpuInfo.UNMASKED_RENDERER_WEBGL)) : 'non exposé',
    deviceMemoryGB: (navigator as any).deviceMemory ?? null,
  });
  const onLost = (event: Event) => {
    if (disposed) return;
    event.preventDefault(); lost = true;
    boot?.note(`ressources lors de la perte : ${owner}`, {
      drawingBuffer: [canvas.width, canvas.height], pixelRatio: renderer.getPixelRatio(),
      ...renderer.info.memory, // Counts, NOT an estimate of physical GPU memory.
    });
    renderFailure(new Error('Le contexte graphique a été perdu. Une restauration est en cours ; ne fermez pas cette page immédiatement.'), phase);
    try {
      if (owner === 'course' && engine) engine.releaseContextResources();
    } catch (error) { renderFailure(error, `libération graphique : ${owner}`); }
  };
  const onRestored = () => {
    // Three.js restores its own GPU state in this event. Resume only afterwards.
    queueMicrotask(() => {
      if (disposed || !lost) return;
      if (gl.isContextLost()) return;
      try {
        if (owner === 'course' && engine) engine.restoreContextResources();
      } catch (error) {
        renderFailure(error, `réinitialisation graphique : ${owner}`);
        return;
      }
      lost = false; boot?.note(`WebGL restauré : ${owner}`); boot?.recover(phase);
      if (owner === 'garage' && state.screen === 'menu' && !document.hidden && !garageRaf) garageRaf = requestAnimationFrame(garageFrame);
      if (owner === 'course' && engine) {
        engine.resetFrameClock(); // remain paused until the player resumes
        $('pauseStats').textContent = 'Graphismes restaurés. Vous pouvez reprendre la course.';
      }
    });
  };
  canvas.addEventListener('webglcontextlost', onLost);
  canvas.addEventListener('webglcontextrestored', onRestored);
  return () => {
    disposed = true;
    canvas.removeEventListener('webglcontextlost', onLost);
    canvas.removeEventListener('webglcontextrestored', onRestored);
  };
}

const premiumGarage = mountGarage({
  garage: () => garage, selected: () => state.vehicleIndex,
  select: index => { state.vehicleIndex = index; },
  persist: persistGarage, refresh: () => renderMenu(),
  reduceMotion: value => { state.reducedMotion = value; if (showroom) showroom.reducedMotion = value; },
});
document.getElementById('motionToggle')!.onclick = () => { state.reducedMotion = !state.reducedMotion; if (engine) engine.reducedMotion = state.reducedMotion; renderMenu(); };
document.getElementById('openGarage')!.onclick = () => premiumGarage.open();
function stopGarage() {
  cancelAnimationFrame(garageRaf);
  garageRaf = 0;
  releaseGarageContext();
  showroom?.dispose();
  showroom = null;
}
function garageFrame(time: number) {
  if (!showroom || state.screen !== 'menu' || document.hidden) {
    garageRaf = 0;
    return;
  }
  const canvas = $('garageCanvas') as HTMLCanvasElement;
  showroom.setBackdropVisible($('turboGarage').hidden);
  try {
    showroom.frame(time, canvas.clientWidth, canvas.clientHeight);
    garageRaf = requestAnimationFrame(garageFrame);
  } catch (error) { renderFailure(error, 'rendu du showroom'); }
}
function refreshGarage() {
  if (state.screen !== 'menu') return;
  const profile = upgradedProfile(vehicleProfile(ROSTER[state.driverIndex], VEHICLES[state.vehicleIndex]), garage);
  if (showroom) showroom.select(profile);
  else {
    const canvas = $('garageCanvas');
    canvas.replaceWith(canvas.cloneNode(false));
    boot?.note('création du showroom WebGL');
    showroom = new Showroom($('garageCanvas') as HTMLCanvasElement, profile);
    releaseGarageContext = observeRenderer(showroom.renderer, $('garageCanvas') as HTMLCanvasElement, 'garage');
  }
  showroom.reducedMotion = state.reducedMotion;
  showroom.setCircuit(CIRCUITS[state.circuitIndex]);
  if (showroom.renderer.getContext().isContextLost()) throw new Error('Contexte WebGL perdu pendant la création du showroom');
  if (!garageRaf && !document.hidden) garageRaf = requestAnimationFrame(garageFrame);
}

let rafId = 0;
const keys = new Set<string>();
const touch = { steer: 0, drift: false, brake: false, turbo: false, accel: false }; // entrée synthétique (harnais de test)
const touchPointers = new MultiTouchControls();
const pointerTargets = new Map<number, HTMLElement>();
let startTimeout = 0;
let finishTimeout = 0;

/* ---------- gyroscope (V4.1) ----------
   On ne lit plus des vitesses angulaires : on lit l'ORIENTATION (beta/gamma),
   projetée dans le référentiel de l'écran par `src/core/gyro.ts`. L'état affiché
   est dérivé de la présence réelle d'échantillons, jamais de l'intention. */
const tilt = new TiltSteering();
const gyro = {
  /** Écouteur posé et autorisation accordée. */
  running: false,
  /** Dernier échantillon reçu. */
  beta: 0,
  gamma: 0,
  lastAt: 0,
  hasSample: false,
  /** Le capteur a déjà fonctionné pendant cette course (détection d'interruption). */
  workedThisRace: false,
};
let gyroListener: ((event: DeviceOrientationEvent) => void) | null = null;
let gyroDropoutWarned = false;

function stopLoop() {
  if (rafId !== 0) {
    cancelAnimationFrame(rafId);
    rafId = 0;
  }
}

function startLoop() {
  stopLoop();
  if (!engine || state.paused || state.screen !== 'race' || engine.renderer.getContext().isContextLost()) return;
  rafId = requestAnimationFrame(loop);
}

/* ------------------------------------------------------------------ */
/* Moteur                                                             */
/* ------------------------------------------------------------------ */

function detectQuality(): QualityLevel {
  if (state.quality !== 'auto') return state.quality;
  let gpu = '';
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') as WebGL2RenderingContext | null;
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    gpu = ext && gl ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
  } catch {
    /* noop */
  }
  const nav = navigator as any;
  return autoQuality({
    isNative: false,
    gpuRenderer: gpu,
    totalMemoryGB: nav.deviceMemory ?? 0,
    logicalCores: nav.hardwareConcurrency ?? 0,
  });
}

function startEngine() {
  stopLoop();
  window.clearTimeout(finishTimeout);
  finishTimeout = 0;
  releaseRaceContext();
  engine?.dispose();
  engine = null;

  const stage = $('stage');
  stage.innerHTML = '';
  const canvas = document.createElement('canvas');
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  stage.appendChild(canvas);

  const level = detectQuality();
  const pr = Math.min(window.devicePixelRatio || 1, QUALITY[level].pixelRatioCap);

  boot?.note('chargement du circuit et du moteur WebGL');
  engine = new PhysicsEngine({
    gl: null,
    canvas,
    width: window.innerWidth,
    height: window.innerHeight,
    pixelRatio: pr,
    quality: QUALITY[level],
    reducedMotion: state.reducedMotion,
    circuit: CIRCUITS[state.circuitIndex],
    profile: upgradedProfile(vehicleProfile(ROSTER[state.driverIndex], VEHICLES[state.vehicleIndex]), garage),
    difficulty: state.difficulty,
    laps: state.laps,
    onFinish: () => {
      window.clearTimeout(finishTimeout);
      finishTimeout = window.setTimeout(() => {
        finishTimeout = 0;
        if (!state.paused && state.screen === 'race' && engine?.race.phase === 'finished') {
          showResults();
        }
      }, 1400);
    },
  });

  releaseRaceContext = observeRenderer(engine.renderer, canvas, 'course');
  if (engine.renderer.getContext().isContextLost()) throw new Error('Contexte WebGL perdu pendant la création du circuit');
  boot?.note('circuit prêt');
  buildMinimap();
  updateHud();
  updatePlaces();
  updateMinimap();
  engine.resetFrameClock();
  if (state.paused || document.hidden) {
    state.paused = true;
    $('pause').classList.remove('hidden');
    const s = engine.stats;
    $('pauseStats').textContent =
      `${versionDiagnostics()} · ${s.fps} FPS · ${s.particles} particules · rendu ×${s.pixelRatio.toFixed(2)} · qualité ${engine.quality.level} · ` +
      `commandes ${state.controls.steerMode === 'gyro' ? (gyroUsable() ? 'gyroscope' : 'gyroscope sans signal') : 'boutons'} · ` +
      `sensibilité ${state.controls.sensitivity} · accélération ${state.controls.throttleMode}`;
    renderMenu();
  } else {
    startLoop();
  }
}

let lastTiltPush = 0;
/** Met à jour le volant virtuel avec le dernier échantillon du capteur. */
function updateTilt(now: number) {
  if (state.controls.steerMode !== 'gyro' || !gyro.running || !gyro.hasSample) return;
  if (now - gyro.lastAt > GYRO_SIGNAL_TIMEOUT_MS) {
    // Le capteur s'est tu en pleine course : retour immédiat aux boutons tactiles.
    if (!gyroDropoutWarned) {
      gyroDropoutWarned = true;
      toast('Gyroscope interrompu — boutons tactiles réactivés', '#ff9a2e', 2200);
    }
    disableGyro(true);
    return;
  }
  const dt = lastTiltPush === 0 ? 1 / 60 : Math.max(1 / 240, Math.min(0.1, (now - lastTiltPush) / 1000));
  lastTiltPush = now;
  tilt.push(gyro.beta, gyro.gamma, readScreenAngle(), dt, now);
  gyro.workedThisRace = true;
}

function loop(t: number) {
  rafId = 0;
  if (!engine || state.paused || state.screen !== 'race' || engine.renderer.getContext().isContextLost()) return;
  updateTilt(performance.now());
  engine.setInput({
    steer: currentSteer(),
    drift: currentDrift(),
    brake: currentBrake(),
    throttle: currentThrottle(),
    turbo: currentTurbo(),
  });
  try { engine.frame(t); } catch (error) { renderFailure(error, 'rendu de la course'); return; }
  if (!engine || state.paused || state.screen !== 'race' || engine.renderer.getContext().isContextLost()) return;
  updateHud();
  if (rafId !== 0) cancelAnimationFrame(rafId);
  rafId = requestAnimationFrame(loop);
}

/** Le gyroscope ne dirige que s'il produit réellement des données exploitables. */
function gyroUsable(now = performance.now()) {
  return state.controls.steerMode === 'gyro' && gyro.running && gyro.hasSample && now - gyro.lastAt <= GYRO_SIGNAL_TIMEOUT_MS;
}

function currentSteer() {
  let s = touchPointers.steer || touch.steer;
  const kLeft = keys.has('ArrowLeft') || keys.has('q') || keys.has('a');
  const kRight = keys.has('ArrowRight') || keys.has('d');
  if (kLeft !== kRight) s = kLeft ? -1 : 1;
  else if (kLeft && kRight) s = 0;
  // Le volant virtuel prime sur les boutons, mais les boutons restent un repli
  // immédiat dès que le capteur se tait (aucune course bloquée).
  if (gyroUsable()) s = tilt.steer;
  return s;
}
const currentDrift = () => touchPointers.drift || touch.drift || keys.has(' ') || keys.has('Shift');
const currentBrake = () => touchPointers.brake || touch.brake || keys.has('ArrowDown') || keys.has('s');
const currentTurbo = () => touchPointers.isDown('turbo') || touch.turbo || keys.has('e');
const currentAccel = () => touchPointers.isDown('accel') || touch.accel || keys.has('ArrowUp') || keys.has('w') || keys.has('z');
/** Accélération automatique par défaut ; en manuel il faut tenir GAZ (ou ↑ / W). */
const currentThrottle = () => (state.controls.throttleMode === 'auto' ? 1 : currentAccel() ? 1 : 0);

/* ------------------------------------------------------------------ */
/* HUD                                                                */
/* ------------------------------------------------------------------ */

let hudAccum = 0;
function updateHud() {
  if (!engine) return;
  const s = engine.stats;
  const st = engine.player.state;
  $('speed').textContent = String(s.speed);
  $('lap').textContent = String(Math.min(state.laps, st.lap + 1));
  $('laps').textContent = String(state.laps);
  $('place').textContent = String(s.place);
  $('total').textContent = String(engine.race.karts.length);
  $('time').textContent = formatTime(engine.race.raceTime);
  $('best').textContent = st.bestLapTime ? `Meilleur tour ${formatLap(st.bestLapTime)}` : 'Meilleur tour —';
  const ch = engine.combatHud;
  $('fireLabel').textContent = ch.weapon ? `TIR · ${ch.weapon}` : 'TIR —';
  $('hazardWarning').textContent = ch.event || $('hazardWarning').textContent;

  const fill = $('driftFill');
  const colors = ['#8ea2c8', '#40c8ff', '#ff9a2e', '#c65cff'];
  $('hazardWarning').textContent = s.hazard
    ? `⚠ ${s.hazard.hazard.label} · ${Math.round(s.hazard.distance)} m`
    : '';
  const tier = st.driftTier;
  const charge = engine.player.driftChargeRatio;
  fill.style.width = `${Math.max(tier > 0 ? 22 : 2, charge * 100)}%`;
  fill.style.backgroundColor = s.boosting ? '#c65cff' : colors[tier];
  fill.style.boxShadow = tier > 0 ? `0 0 16px ${colors[tier]}` : 'none';

  /* ---------- état du bouton TURBO (disponible / actif / recharge) ---------- */
  const turbo = s.turbo;
  const turboBtn = $('turboBtn');
  const turboLabel = $('turboLabel');
  const turboChip = $('turboChip');
  const cooldown = Math.max(0, turbo.cooldown);
  const active = turbo.active;
  const ready = turbo.ready;
  turboBtn.classList.toggle('active', active);
  turboBtn.classList.toggle('ready', ready && !active);
  turboBtn.classList.toggle('cooling', !ready && !active && cooldown > 0);
  turboBtn.setAttribute('aria-pressed', active ? 'true' : 'false');
  $('turboFill').style.transform = `scaleY(${active ? 1 : Math.max(0.04, turbo.charge).toFixed(3)})`;
  turboLabel.textContent = active ? 'TURBO !' : ready ? `TURBO ${Math.round(turbo.charge * 100)}%` : cooldown > 0 ? `RECHARGE ${cooldown.toFixed(1)}s` : 'TURBO';
  turboChip.className = turbo.mastery ? 'mastery' : active ? 'active' : ready ? 'ready' : '';
  turboChip.textContent = turbo.mastery
    ? `MAÎTRISE ×${turbo.masteryCount} · TURBO RENFORCÉ`
    : active
      ? 'TURBO ACTIF'
      : ready
        ? `TURBO PRÊT ${Math.round(turbo.charge * 100)}%`
        : cooldown > 0
          ? `RECHARGE ${cooldown.toFixed(1)}s`
          : 'TURBO — dérapez pour charger';

  /* ---------- indicateur gyroscope réel ---------- */
  const gyroOn = gyroUsable(performance.now());
  $('gyroChip').classList.toggle('on', gyroOn);
  $('gyroChipText').textContent = gyroOn ? 'GYRO' : 'BOUTONS';
  applyControlUi();

  hudAccum += 1;
  if (hudAccum % 6 === 0) {
    $('fpsInline').textContent = `${s.fps} FPS · ${s.particles} part. · ×${s.pixelRatio.toFixed(2)}`;
    if (state.showFps)
      $('fpsBadge').textContent =
        `${s.fps} FPS · ${s.particles} particules · rendu ×${s.pixelRatio.toFixed(2)} · ${engine?.quality.level}`;
    updatePlaces();
    updateMinimap();
  }

  const cd = $('countdown');
  if (engine.race.phase === 'countdown') {
    const v = Math.ceil(engine.race.countdown);
    cd.innerHTML = v > 0 ? `<span>${v}</span>` : '<span style="font-size:80px">GO !</span>';
  } else if (cd.innerHTML) {
    cd.innerHTML = '';
  }
}

function updatePlaces() {
  if (!engine) return;
  const order = engine.race.computePlaces();
  const el = $('places');
  el.innerHTML = order
    .slice(0, 6)
    .map((k, i) => {
      const me = k.isPlayer;
      const col = `#${k.profile.bodyColor.toString(16).padStart(6, '0')}`;
      return `<div class="placeRow ${me ? 'me' : ''}"><span>${i + 1}</span><span class="placeDot" style="background:${col}"></span><span>${k.state.name}</span></div>`;
    })
    .join('');
}

function buildMinimap() {
  if (!engine) return;
  const pts = engine.race.track.minimapPath(110);
  const d =
    pts
      .map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${(x * 100).toFixed(2)},${(y * 100).toFixed(2)}`)
      .join(' ') + ' Z';
  $('mapPath').setAttribute('d', d);
  $('mapPath2').setAttribute('d', d);
}

function updateMinimap() {
  if (!engine) return;
  const st = engine.player.state;
  const tr = engine.race.track;
  let pts = (engine as any).__mapPoints as Array<[number, number]> | undefined;
  if (!pts) {
    pts = tr.minimapPath(110);
    (engine as any).__mapPoints = pts;
  }
  const idx = Math.max(
    0,
    Math.min(pts.length - 1, Math.round(((st.s % tr.length) / tr.length) * pts.length)),
  );
  const [mx, my] = pts[idx];
  $('mapDot').setAttribute('cx', (mx * 100).toFixed(2));
  $('mapDot').setAttribute('cy', (my * 100).toFixed(2));
  $('mapDotGlow').setAttribute('cx', (mx * 100).toFixed(2));
  $('mapDotGlow').setAttribute('cy', (my * 100).toFixed(2));
}

/* ------------------------------------------------------------------ */
/* Toasts                                                             */
/* ------------------------------------------------------------------ */

let toastTimer = 0;
function toast(text: string, color = '#fff', ms = 900) {
  const t = $('toast');
  t.textContent = text;
  t.style.color = color;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => t.classList.remove('show'), ms);
}

/* ------------------------------------------------------------------ */
/* Menus                                                              */
/* ------------------------------------------------------------------ */

/* Libellés des commandes : rendus à part pour être rafraîchis même en pause. */
function renderControlLabels() {
  /* V4.1 — commandes : l'état affiché décrit le fonctionnement réel. */
  const gyroEnabled = state.controls.steerMode === 'gyro';
  const gyroLive = gyroUsable();
  const steerLabel = gyroEnabled
    ? gyroLive
      ? 'GYROSCOPE : ACTIVÉ'
      : 'GYROSCOPE : EN ATTENTE…'
    : 'GYROSCOPE : DÉSACTIVÉ';
  for (const id of ['steerModeBtn', 'pauseGyroBtn']) {
    const el = $(id);
    el.textContent = steerLabel;
    el.classList.toggle('on', gyroEnabled);
    el.setAttribute('aria-pressed', gyroEnabled ? 'true' : 'false');
  }
  const calibrateDisabled = !gyroEnabled;
  for (const id of ['calibrateBtn', 'pauseCalibrateBtn']) {
    const el = $(id) as HTMLButtonElement;
    el.disabled = calibrateDisabled;
    el.style.opacity = calibrateDisabled ? '0.45' : '1';
  }
  $('sensitivityBtn').textContent = SENSITIVITY_LABEL[state.controls.sensitivity];
  $('throttleModeBtn').textContent = THROTTLE_MODE_LABEL[state.controls.throttleMode];
  $('pauseThrottleBtn').textContent = THROTTLE_MODE_LABEL[state.controls.throttleMode];
  $('invertBtn').textContent = `SENS DU GYRO : ${state.controls.invertTilt ? 'INVERSÉ' : 'NORMAL'}`;
  $('versionBadge').textContent = versionBadge();
  applyControlUi();
}

function renderMenu() {
  $('motionToggle').textContent = `Animations : ${state.reducedMotion ? 'réduites' : 'complètes'}`;
  const c = CIRCUITS[state.circuitIndex];
  const driver = ROSTER[state.driverIndex];
  const vehicle = VEHICLES[state.vehicleIndex];
  const d = upgradedProfile(vehicleProfile(driver, vehicle), garage);
  $('vehicleName').textContent = vehicle.name;
  $('vehicleSub').textContent = vehicle.description;
  $('garageLabel').textContent = `${driver.name} · ${vehicle.name}`;
  $('difficultyToggle').textContent = `Difficulté : ${DIFFICULTIES[state.difficulty].name}`;
  const ownedV = garage.owned.includes(vehicle.id);
  $('garageCoins').textContent = `🪙 ${garage.coins} Turbo Coins${ownedV ? ' · ✓ possédé' : ` · prix ${vehicle.price ?? 0} TC`}`;
  $('buyVehicleBtn').textContent = ownedV ? '✓ Véhicule possédé' : `Acheter ${vehicle.name} — ${vehicle.price ?? 0} TC`;
  const lvl = garage.upgrades[vehicle.id]?.[upKind] ?? 0;
  $('upgradeBtn').textContent = ownedV ? `⬆ ${upKind} niv.${lvl}/5 (×${upgradeMultiplier(garage, vehicle.id, upKind).toFixed(2)}) — ${lvl >= 5 ? 'MAX' : upgradeCost(upKind, lvl) + ' TC'}` : '⬆ Améliorations (achetez le véhicule)';
  ($('playBtn') as HTMLButtonElement).style.opacity = ownedV ? '1' : '0.45';
  $('driftLabel').textContent = vehicle.kind === 'kart' ? 'DÉRAPAGE' : 'GLISSE / TURBO';
  $('driverName').style.color = '#' + driver.visorColor.toString(16).padStart(6, '0');
  try { refreshGarage(); } catch (error) { renderFailure(error, 'initialisation du showroom'); }
  $('circName').textContent = c.name;
  $('circSub').textContent = `${c.subtitle} · ${c.difficulty ?? 'Intermédiaire'}`;
  $('driverName').textContent = d.name;
  $('driverSub').textContent = d.tagline;
  const bars: Array<[string, number]> = [
    ['VITESSE', d.speed],
    ['ACCÉLÉRATION', d.accel],
    ['ADHÉRENCE', d.grip],
    ['MANIABILITÉ', d.handling],
  ];
  $('stats').innerHTML = bars
    .map(
      ([label, v]) =>
        `<div class="statRow"><span>${label}</span><div class="track"><div class="fill" style="width:${Math.min(100, (v / 1.15) * 100).toFixed(0)}%"></div></div></div>`,
    )
    .join('');
  $('qualityToggle').textContent =
    `⚙️ Qualité : ${state.quality === 'auto' ? 'Auto' : state.quality === 'low' ? 'Basse' : state.quality === 'high' ? 'Haute' : 'Ultra'}`;
  $('lapsToggle').textContent = `🏁 ${state.laps} tour${state.laps > 1 ? 's' : ''}`;
  $('fpsToggle').textContent = state.showFps ? '📊 FPS activé' : '📊 FPS';
  $('fpsBadge').classList.toggle('on', state.showFps);

  renderControlLabels();
}

function showMenu() {
  state.screen = 'menu';
  state.paused = false;
  state.starting = false;
  window.clearTimeout(startTimeout);
  startTimeout = 0;
  window.clearTimeout(finishTimeout);
  finishTimeout = 0;
  clearHeldInputs();
  stopLoop();
  releaseRaceContext();
  engine?.dispose();
  engine = null;
  $('stage').innerHTML = '';
  $('loading').classList.add('hidden');
  $('menu').classList.remove('hidden');
  $('results').classList.add('hidden');
  $('pause').classList.add('hidden');
  $('hud').classList.remove('live');
  document.body.classList.remove('racing');
  renderMenu();
}

function startRace() {
  if (state.starting || state.screen === 'race') return;
  if (!garage.owned.includes(VEHICLES[state.vehicleIndex].id)) { toast('Véhicule verrouillé — achetez-le dans le garage', '#ff3d6e'); state.starting = false; return; }
  raceAwardId = `web-${Date.now()}`;
  state.starting = true;
  stopGarage();
  window.clearTimeout(startTimeout);
  startTimeout = 0;
  window.clearTimeout(finishTimeout);
  finishTimeout = 0;
  clearHeldInputs();
  stopLoop();
  releaseRaceContext();
  engine?.dispose();
  engine = null;
  // Le joueur tient son téléphone dans sa position de jeu : on recale le volant
  // virtuel à cet instant (la calibration manuelle reste disponible via PAUSE).
  if (state.controls.steerMode === 'gyro' && gyro.running) {
    tilt.sensitivity = state.controls.sensitivity;
    tilt.invertTilt = state.controls.invertTilt;
    if (primeTilt()) {
      tilt.reset();
      const degrees = tilt.calibrate();
      state.controls.calibration = Math.round(degrees * 10) / 10;
      persistControls();
    }
  }
  gyroDropoutWarned = false;
  gyro.workedThisRace = false;
  state.screen = 'race';
  state.paused = false;
  document.body.classList.add('racing');
  $('menu').classList.add('hidden');
  $('results').classList.add('hidden');
  $('pause').classList.add('hidden');
  $('hud').classList.add('live');
  $('loading').classList.remove('hidden');
  // laisse le navigateur peindre le loader avant de générer les textures
  startTimeout = window.setTimeout(() => {
    startTimeout = 0;
    if (state.screen !== 'race') {
      state.starting = false;
      $('loading').classList.add('hidden');
      return;
    }
    try {
      startEngine();
    } catch (error) {
      renderFailure(error, 'initialisation de la course');
    } finally {
      state.starting = false;
      $('loading').classList.add('hidden');
    }
  }, 60);
}

function showResults() {
  if (!engine || state.screen !== 'race' || engine.race.phase !== 'finished') return;
  state.screen = 'results';
  state.paused = false;
  window.clearTimeout(startTimeout);
  startTimeout = 0;
  window.clearTimeout(finishTimeout);
  finishTimeout = 0;
  clearHeldInputs();
  stopLoop();
  $('pause').classList.add('hidden');
  document.body.classList.remove('racing');
  const p = engine.player.state;
  $('results').classList.remove('hidden');
  $('hud').classList.remove('live');
  const medal = p.place === 1 ? '🏆' : p.place === 2 ? '🥈' : p.place === 3 ? '🥉' : '🏁';
  $('medal').textContent = medal;
  $('resultTitle').textContent = p.place === 1 ? 'VICTOIRE !' : `${p.place}ᵉ PLACE`;
  $('resultSub').textContent = `${CIRCUITS[state.circuitIndex].name} · ${ROSTER[state.driverIndex].name}`;
  const rows = [
    `<div class="resultsRow"><span class="label">TEMPS TOTAL</span><b>${formatTime(p.finishTime)}</b></div>`,
    ...p.lapTimes.map(
      (l, i) =>
        `<div class="resultsRow"><span class="label">TOUR ${i + 1}</span><b ${l === p.bestLapTime ? 'style="color:#ffe14d"' : ''}>${formatLap(l)}</b></div>`,
    ),
  ];
  const gain = awardRace(garage, raceAwardId || `web-${Date.now()}`, p.place, engine.combatHud.coins, p.finishTime, CIRCUITS[state.circuitIndex].id);
  persistGarage();
  rows.push(`<div class="resultsRow"><span class="label">TURBO COINS</span><b style="color:#ffd21f">+${gain} · solde ${garage.coins}</b></div>`);
  $('resultCard').innerHTML = rows.join('');
  // Détacher l'observateur AVANT la destruction : forceContextLoss() émet un
  // `webglcontextlost` asynchrone qui serait sinon signalé comme une panne.
  releaseRaceContext();
  engine.dispose();
  engine = null;
}

/* ------------------------------------------------------------------ */
/* Branchements                                                       */
/* ------------------------------------------------------------------ */

function bind(id: string, ev: 'click' | 'pointerdown' | 'pointerup', fn: (e: Event) => void) {
  const el = $(id);
  if (!el) return;
  el.addEventListener(ev, fn);
}

bind('circPrev', 'click', () => {
  state.circuitIndex = (state.circuitIndex + CIRCUITS.length - 1) % CIRCUITS.length;
  renderMenu();
});
bind('circNext', 'click', () => {
  state.circuitIndex = (state.circuitIndex + 1) % CIRCUITS.length;
  renderMenu();
});
bind('driverPrev', 'click', () => {
  state.driverIndex = (state.driverIndex + ROSTER.length - 1) % ROSTER.length;
  renderMenu();
});
bind('driverNext', 'click', () => {
  state.driverIndex = (state.driverIndex + 1) % ROSTER.length;
  renderMenu();
});
bind('vehiclePrev', 'click', () => {
  state.vehicleIndex = (state.vehicleIndex + VEHICLES.length - 1) % VEHICLES.length;
  renderMenu();
});
bind('buyVehicleBtn', 'click', () => { const v = VEHICLES[state.vehicleIndex]; buyVehicle(garage, v.id, v.price ?? 0); persistGarage(); renderMenu(); });
bind('upgradeBtn', 'click', () => { const v = VEHICLES[state.vehicleIndex]; if (!garage.owned.includes(v.id)) return; const cur = UPGRADE_KINDS.indexOf(upKind); if ((garage.upgrades[v.id]?.[upKind] ?? 0) >= 5) upKind = UPGRADE_KINDS[(cur + 1) % UPGRADE_KINDS.length]; else buyUpgrade(garage, v.id, upKind); persistGarage(); renderMenu(); });
bind('vehicleNext', 'click', () => {
  state.vehicleIndex = (state.vehicleIndex + 1) % VEHICLES.length;
  renderMenu();
});
bind('difficultyToggle', 'click', () => {
  const levels = Object.keys(DIFFICULTIES) as Difficulty[];
  state.difficulty = levels[(levels.indexOf(state.difficulty) + 1) % levels.length];
  renderMenu();
});
bind('qualityToggle', 'click', () => {
  const order: Array<QualityLevel | 'auto'> = ['auto', 'low', 'high', 'ultra'];
  state.quality = order[(order.indexOf(state.quality) + 1) % order.length];
  renderMenu();
});
bind('lapsToggle', 'click', () => {
  state.laps = state.laps === 1 ? 3 : state.laps === 3 ? 5 : 1;
  renderMenu();
});
bind('steerModeBtn', 'click', () => void toggleSteerMode());
bind('pauseGyroBtn', 'click', () => void toggleSteerMode());
bind('calibrateBtn', 'click', () => calibrateGyro());
bind('pauseCalibrateBtn', 'click', () => calibrateGyro());
bind('recenterBtn', 'click', () => recenterGyro());
bind('sensitivityBtn', 'click', () => cycleSensitivity());
bind('throttleModeBtn', 'click', () => cycleThrottleMode());
bind('pauseThrottleBtn', 'click', () => cycleThrottleMode());
bind('invertBtn', 'click', () => toggleInvertTilt());
bind('fpsToggle', 'click', () => {
  state.showFps = !state.showFps;
  renderMenu();
});
function restartRace() {
  if (!engine || state.screen !== 'race') return;
  window.clearTimeout(finishTimeout);
  finishTimeout = 0;
  clearHeldInputs();
  engine.restart();
  engine.resetFrameClock();
  if (state.paused) {
    state.paused = false;
    $('pause').classList.add('hidden');
  }
  updateHud();
  updatePlaces();
  updateMinimap();
  startLoop();
}

bind('playBtn', 'click', startRace);
bind('againBtn', 'click', startRace);
bind('menuBtn', 'click', showMenu);
bind('resumeBtn', 'click', () => togglePause(false));
bind('restartBtn', 'click', restartRace);
bind('quitBtn', 'click', showMenu);
bind('pauseBtn', 'click', () => togglePause(true));

function releasePointerTarget(pointerId: number) {
  const target = pointerTargets.get(pointerId);
  const released = touchPointers.release(pointerId);
  if (!target) return released;
  pointerTargets.delete(pointerId);
  if (![...pointerTargets.values()].includes(target)) target.classList.remove('active');
  try {
    if (target.hasPointerCapture(pointerId)) target.releasePointerCapture(pointerId);
  } catch {
    /* le navigateur a déjà annulé la capture */
  }
  return true;
}

function clearTouchPointers() {
  touchPointers.clear();
  const captures = Array.from(pointerTargets.entries());
  pointerTargets.clear();
  for (const [pointerId, element] of captures) {
    element.classList.remove('active');
    try {
      if (element.hasPointerCapture(pointerId)) element.releasePointerCapture(pointerId);
    } catch {
      /* le navigateur a déjà annulé la capture */
    }
  }
}

/* état neutre garanti après pause, perte de focus ou annulation tactile */
function clearHeldInputs() {
  keys.clear();
  touch.steer = 0;
  touch.drift = false;
  touch.brake = false;
  touch.turbo = false;
  touch.accel = false;
  clearTouchPointers();
  resetTilt();
  engine?.setInput({ steer: 0, drift: false, brake: false, throttle: 1, turbo: false });
}

/* commandes Pointer Events avec capture : plusieurs doigts restent indépendants */
const hold = (id: string, action: TouchAction) => {
  const el = $(id);
  const start = (event: Event) => {
    const e = event as PointerEvent;
    if (state.screen !== 'race' || state.paused || (e.pointerType === 'mouse' && e.button !== 0)) return;
    e.preventDefault();
    const target = e.currentTarget as HTMLElement;
    try {
      target.setPointerCapture(e.pointerId);
    } catch {
      /* capture facultative */
    }
    touchPointers.press(e.pointerId, action);
    pointerTargets.set(e.pointerId, target);
    target.classList.add('active');
  };
  const end = (event: Event) => {
    const e = event as PointerEvent;
    e.preventDefault();
    releasePointerTarget(e.pointerId);
  };
  el.addEventListener('pointerdown', start);
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  el.addEventListener('lostpointercapture', end);
  el.addEventListener('contextmenu', (e) => e.preventDefault());
};
hold('leftBtn', 'left');
hold('rightBtn', 'right');
hold('driftBtn', 'drift');
hold('turboBtn', 'turbo');
hold('brakeBtn', 'brake');
hold('accelBtn', 'accel');
$('fireBtn').addEventListener('pointerdown', (e) => { e.preventDefault(); engine?.firePlayerWeapon(); });

window.addEventListener('pointerup', (e) => releasePointerTarget(e.pointerId));
window.addEventListener('pointercancel', (e) => releasePointerTarget(e.pointerId));
window.addEventListener('touchcancel', () => {
  clearTouchPointers();
  engine?.setInput({
    steer: currentSteer(),
    drift: currentDrift(),
    brake: currentBrake(),
    throttle: currentThrottle(),
    turbo: false,
  });
});

const normalizeKey = (k: string) => (k.length === 1 ? k.toLowerCase() : k);

/* clavier */
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' || e.key === 'p' || e.key === 'P') {
    if (!e.repeat && state.screen === 'race') togglePause(!state.paused);
    return;
  }
  if (e.key === 'Enter' && state.screen === 'menu' && !e.repeat) {
    startRace();
    return;
  }
  if (state.screen !== 'race' || state.paused || e.repeat) return;
  if (e.key === 'f' || e.key === 'F') { engine?.firePlayerWeapon(); return; }
  if (e.key === 'r' || e.key === 'R') { recenterGyro(); return; }
  if (e.key === ' ') e.preventDefault();
  keys.add(normalizeKey(e.key));
});
window.addEventListener('keyup', (e) => keys.delete(normalizeKey(e.key)));
window.addEventListener('blur', () => {
  clearHeldInputs();
  if (state.screen === 'race') togglePause(true);
});
window.addEventListener('focus', () => {
  clearHeldInputs();
});
window.addEventListener('pagehide', () => {
  clearHeldInputs();
  if (state.screen === 'race') togglePause(true);
});
document.addEventListener('visibilitychange', () => {
  clearHeldInputs();
  if (document.hidden && state.screen === 'race') {
    togglePause(true);
  }
});

/* ------------------------------------------------------------------ */
/* Gyroscope : activation explicite, autorisation, calibration        */
/* ------------------------------------------------------------------ */

function attachGyroListener() {
  if (gyroListener) return;
  gyroListener = (event: DeviceOrientationEvent) => {
    if (typeof event.beta !== 'number' || typeof event.gamma !== 'number') return;
    if (!Number.isFinite(event.beta) || !Number.isFinite(event.gamma)) return;
    gyro.beta = event.beta;
    gyro.gamma = event.gamma;
    gyro.lastAt = performance.now();
    gyro.hasSample = true;
  };
  window.addEventListener('deviceorientation', gyroListener, true);
}

function detachGyroListener() {
  if (!gyroListener) return;
  window.removeEventListener('deviceorientation', gyroListener, true);
  gyroListener = null;
}

/** Applique les classes d'interface qui reflètent l'état RÉEL des commandes. */
let gyroClassOn = false;
let manualClassOn = false;
function applyControlUi() {
  const gyroReal = gyroUsable();
  if (gyroClassOn !== gyroReal) {
    gyroClassOn = gyroReal;
    document.body.classList.toggle('gyro-on', gyroReal);
  }
  const manual = state.controls.throttleMode === 'manual';
  if (manualClassOn !== manual) {
    manualClassOn = manual;
    document.body.classList.toggle('manual-throttle', manual);
  }
}

function waitForGyroSample(timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const started = performance.now();
    const tick = () => {
      if (gyro.hasSample) { resolve(true); return; }
      if (performance.now() - started > timeoutMs) { resolve(false); return; }
      window.setTimeout(tick, 60);
    };
    tick();
  });
}

/** Un seul échantillon poussé hors course (menu, pause) : calibration fiable. */
function primeTilt(now = performance.now()) {
  if (!gyro.hasSample) return false;
  tilt.push(gyro.beta, gyro.gamma, readScreenAngle(), 1 / 60, now);
  return true;
}

function resetTilt() {
  lastTiltPush = 0;
  tilt.reset();
}

function gyroFailure(reason: string) {
  gyro.hasSample = false;
  gyro.running = false;
  detachGyroListener();
  state.controls.steerMode = 'buttons';
  persistControls();
  applyControlUi();
  renderControlLabels();
  resetTilt();
  const secure = typeof window.isSecureContext === 'boolean' && !window.isSecureContext;
  toast(
    `Gyroscope indisponible (${reason}) — boutons tactiles réactivés${secure ? ' · HTTPS requis' : ''}`,
    '#ff9a2e',
    2800,
  );
  if (state.screen !== 'race') renderMenu();
}

/** Active le gyroscope : autorisation, attente de données réelles, puis calibration. */
async function enableGyro(): Promise<boolean> {
  if (typeof window.DeviceOrientationEvent === 'undefined') {
    gyroFailure('capteur absent de ce navigateur');
    return false;
  }
  const anyEvent = window.DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> };
  if (typeof anyEvent.requestPermission === 'function') {
    try {
      const permission = await anyEvent.requestPermission();
      if (permission !== 'granted') {
        gyroFailure('autorisation refusée');
        return false;
      }
    } catch {
      gyroFailure('autorisation refusée');
      return false;
    }
  }
  attachGyroListener();
  gyro.running = true;
  gyro.hasSample = false;
  tilt.sensitivity = state.controls.sensitivity;
  tilt.invertTilt = state.controls.invertTilt;
  const received = await waitForGyroSample(1500);
  if (!received) {
    gyroFailure('aucune donnée reçue');
    return false;
  }
  gyroDropoutWarned = false;
  gyro.workedThisRace = false;
  primeTilt();
  tilt.reset();
  tilt.setCalibration(state.controls.calibration);
  state.controls.steerMode = 'gyro';
  persistControls();
  applyControlUi();
  renderControlLabels();
  if (state.screen !== 'race') renderMenu();
  toast('Gyroscope actif — inclinez le téléphone', '#40c8ff', 1800);
  return true;
}

function disableGyro(fromFailure = false) {
  gyro.hasSample = false;
  gyro.running = false;
  detachGyroListener();
  resetTilt();
  state.controls.steerMode = 'buttons';
  persistControls();
  applyControlUi();
  renderControlLabels();
  if (state.screen !== 'race') renderMenu();
  if (!fromFailure) toast('Gyroscope désactivé — boutons tactiles', '#8ea2c8', 1600);
}

/** Bascule explicite « GYROSCOPE : ACTIVÉ / DÉSACTIVÉ ». */
async function toggleSteerMode() {
  if (state.controls.steerMode === 'gyro') {
    disableGyro();
    return;
  }
  await enableGyro();
}

/** Définit la position neutre en tenant le téléphone naturellement. */
function calibrateGyro() {
  if (state.controls.steerMode !== 'gyro' || !gyro.running || !gyro.hasSample) {
    toast('Activez d’abord le gyroscope', '#ff9a2e', 1600);
    return;
  }
  primeTilt();
  const degrees = tilt.calibrate();
  state.controls.calibration = Math.round(degrees * 10) / 10;
  persistControls();
  renderControlLabels();
  renderMenu();
  toast(`Position neutre enregistrée (${state.controls.calibration.toFixed(0)}°)`, '#4dffc8', 1600);
}

/**
 * Recentrage **en course** (V4.1) : la position neutre rejoint doucement la
 * position actuelle (~0,3 s), donc la direction revient au centre sans à-coup.
 * Contrairement à `calibrateGyro`, rien n'est enregistré : c'est une aide de
 * session, le réglage persistant reste celui du menu.
 */
function recenterGyro() {
  if (state.controls.steerMode !== 'gyro' || !gyro.running || !gyro.hasSample) {
    toast('Activez le gyroscope pour recentrer la direction', '#ff9a2e', 1600);
    return;
  }
  primeTilt();
  const target = tilt.recenter();
  renderControlLabels();
  toast(`Direction recentrée (neutre ${target.toFixed(0)}°)`, '#4dffc8', 1200);
}

function cycleSensitivity() {
  state.controls.sensitivity = nextSensitivity(state.controls.sensitivity);
  tilt.sensitivity = state.controls.sensitivity;
  persistControls();
  renderMenu();
  toast(SENSITIVITY_LABEL[state.controls.sensitivity], '#40c8ff', 1200);
}

function cycleThrottleMode() {
  state.controls.throttleMode = nextThrottleMode(state.controls.throttleMode);
  persistControls();
  applyControlUi();
  renderMenu();
  toast(THROTTLE_MODE_LABEL[state.controls.throttleMode], '#40c8ff', 1400);
}

function toggleInvertTilt() {
  state.controls.invertTilt = !state.controls.invertTilt;
  tilt.invertTilt = state.controls.invertTilt;
  persistControls();
  renderMenu();
  toast(`Sens du gyroscope : ${state.controls.invertTilt ? 'inversé' : 'normal'}`, '#40c8ff', 1400);
}

function togglePause(v: boolean) {
  if (state.screen !== 'race' || state.paused === v) return;
  if (!v && engine?.renderer.getContext().isContextLost()) return;
  if (!engine) {
    if (state.starting && v) {
      state.paused = true;
      clearHeldInputs();
      $('pause').classList.remove('hidden');
    }
    return;
  }
  state.paused = v;
  clearHeldInputs();
  engine.resetFrameClock();
  $('pause').classList.toggle('hidden', !v);
  if (v) {
    stopLoop();
    window.clearTimeout(finishTimeout);
    finishTimeout = 0;
    const s = engine.stats;
    $('pauseStats').textContent =
      `${versionDiagnostics()} · ${s.fps} FPS · ${s.particles} particules · rendu ×${s.pixelRatio.toFixed(2)} · qualité ${engine.quality.level} · ` +
      `commandes ${state.controls.steerMode === 'gyro' ? (gyroUsable() ? 'gyroscope' : 'gyroscope sans signal') : 'boutons'} · ` +
      `sensibilité ${state.controls.sensitivity} · accélération ${state.controls.throttleMode}`;
    renderMenu();
  } else {
    if (engine.race.phase === 'finished') {
      window.clearTimeout(finishTimeout);
      finishTimeout = window.setTimeout(() => {
        finishTimeout = 0;
        if (!state.paused && state.screen === 'race' && engine?.race.phase === 'finished') {
          showResults();
        }
      }, 1400);
    }
    startLoop();
  }
}

/* redimensionnement */
let resizeFrame = 0;
function scheduleResize() {
  if (resizeFrame) return;
  resizeFrame = requestAnimationFrame(() => {
    resizeFrame = 0;
    if (innerWidth < 1 || innerHeight < 1) return;
    try {
      if (engine && !engine.renderer.getContext().isContextLost()) engine.resize(innerWidth, innerHeight);
    } catch (error) { renderFailure(error, 'redimensionnement de la course'); }
  });
}
window.addEventListener('resize', scheduleResize);
window.addEventListener('orientationchange', scheduleResize);
window.visualViewport?.addEventListener('resize', scheduleResize);

/* démarrage : on attend que tout soit monté */
boot?.note('version', versionInfo());
try { renderMenu(); } catch (error) { renderFailure(error, 'initialisation du menu'); }
// Reprise des réglages de commande sauvegardés (mode, sensibilité, calibration).
tilt.sensitivity = state.controls.sensitivity;
tilt.invertTilt = state.controls.invertTilt;
tilt.setCalibration(state.controls.calibration);
applyControlUi();
if (state.controls.steerMode === 'gyro') {
  // Le mode gyroscope n'est réactivé qu'après confirmation de données réelles.
  void enableGyro();
}
boot?.finish();
$('loading').classList.add('hidden');

/* hook de debug pour les captures automatisées */
(window as any).__tka = {
  start: (opts?: {
    circuit?: number;
    driver?: number;
    vehicle?: number;
    difficulty?: Difficulty;
    quality?: QualityLevel;
  }) => {
    if (opts?.circuit !== undefined) state.circuitIndex = opts.circuit;
    if (opts?.driver !== undefined) state.driverIndex = opts.driver;
    if (opts?.vehicle !== undefined) state.vehicleIndex = opts.vehicle;
    if (opts?.difficulty) state.difficulty = opts.difficulty;
    if (opts?.quality) state.quality = opts.quality;
    startRace();
  },
  updateHud,
  vehicles: VEHICLES,
  drivers: ROSTER,
  circuits: CIRCUITS,
  quit: showMenu,
  restart: restartRace,
  engine: () => engine,
  state,
  togglePause,
  currentSteer,
  currentDrift,
  currentBrake,
  currentTurbo,
  currentThrottle,
  /** V4.1 — identification de version (menu, diagnostics, tests). */
  version: () => versionInfo(),
  /** V4.1 — réglages de commande persistés (lecture seule pour les tests). */
  controls: () => ({ ...state.controls }),
  gyroState: () => ({
    mode: state.controls.steerMode,
    running: gyro.running,
    usable: gyroUsable(),
    hasSample: gyro.hasSample,
    tilt: tilt.tilt,
    steer: tilt.steer,
    calibration: tilt.calibration,
    sensitivity: state.controls.sensitivity,
  }),
  toggleSteerMode,
  calibrateGyro,
  recenterGyro,
  cycleSensitivity,
  cycleThrottleMode,
  toggleInvertTilt,
  rafActive: () => rafId !== 0,
  hasFinishTimeout: () => finishTimeout !== 0,
  skipCountdown: () => {
    if (engine) (engine.race as any).countdown = 0.01;
  },
  setInput: (i: Partial<{ steer: number; drift: boolean; brake: boolean }>) => {
    if (i.steer !== undefined) touch.steer = i.steer;
    if (i.drift !== undefined) touch.drift = i.drift;
    if (i.brake !== undefined) touch.brake = i.brake;
  },
  keys,
  /** Arrête la boucle rAF (les captures automatisées rendent alors frame par frame). */
  pauseLoop: () => stopLoop(),
  resumeLoop: () => startLoop(),
  /** Mode démo : le kart du joueur est piloté par l'IA. */
  setAutopilot: (v: boolean) => {
    if (engine) engine.autopilot = v;
  },
  /** Advance N fixed frames; render the final state, or every frame for benchmarks. */
  step: (n = 1, dtMs = 16.67, renderEach = false) => {
    if (!engine || state.paused) return;
    let t = performance.now();
    for (let i = 0; i < n; i++) {
      t += dtMs;
      // Même séquence que la boucle réelle : le volant virtuel avance aussi.
      updateTilt(performance.now());
      engine.setInput({
        steer: currentSteer(),
        drift: currentDrift(),
        brake: currentBrake(),
        throttle: currentThrottle(),
        turbo: currentTurbo(),
      });
      engine.frame(t, renderEach || i === n - 1);
    }
    updateHud();
  },
};

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && state.screen === 'menu' && !garageRaf)
    garageRaf = requestAnimationFrame(garageFrame);
});
