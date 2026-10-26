/**
 * Turbo Karts Arena — hôte navigateur (preview jouable).
 *
 * Rôle strictement équivalent à App.tsx côté Android : il ne contient AUCUNE
 * logique de jeu, seulement l'UI, les entrées (clavier / tactile / gyroscope) et
 * le branchement du moteur partagé `src/render/world.ts`.
 */

import { PhysicsEngine } from '../src/render/world';
import { CIRCUITS } from '../src/game/circuits';
import { ROSTER } from '../src/game/roster';
import { autoQuality, QUALITY, type QualityLevel } from '../src/core/config';
import { formatLap, formatTime } from '../src/core/race';

const $ = (id: string) => document.getElementById(id)!;
const state = {
  circuitIndex: 0,
  driverIndex: 0,
  quality: 'auto' as QualityLevel | 'auto',
  input: 'buttons' as 'buttons' | 'gyro',
  laps: 3,
  sound: true,
  showFps: false,
  paused: false,
  screen: 'menu' as 'menu' | 'race' | 'results',
};

let engine: PhysicsEngine | null = null;
let rafId = 0;
const keys = new Set<string>();
const touch = { steer: 0, drift: false, brake: false };
const gyro = { enabled: false, rest: 0, angle: 0, active: false };

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
  const stage = $('stage');
  stage.innerHTML = '';
  const canvas = document.createElement('canvas');
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  stage.appendChild(canvas);

  const level = detectQuality();
  const pr = Math.min(window.devicePixelRatio || 1, QUALITY[level].pixelRatioCap);

  engine = new PhysicsEngine({
    gl: null,
    canvas,
    width: window.innerWidth,
    height: window.innerHeight,
    pixelRatio: pr,
    quality: QUALITY[level],
    circuit: CIRCUITS[state.circuitIndex],
    profile: ROSTER[state.driverIndex],
    laps: state.laps,
    onFinish: () => {
      setTimeout(showResults, 1400);
    },
  });

  buildMinimap();
  loop(performance.now());
}

function loop(t: number) {
  rafId = requestAnimationFrame(loop);
  if (!engine) return;
  if (state.paused) return;
  engine.setInput({
    steer: currentSteer(),
    drift: currentDrift(),
    brake: currentBrake(),
    throttle: 1,
  });
  engine.frame(t);
  updateHud();
}

function currentSteer() {
  let s = touch.steer;
  if (keys.has('ArrowLeft') || keys.has('q') || keys.has('a')) s = -1;
  if (keys.has('ArrowRight') || keys.has('d')) s = 1;
  if (state.input === 'gyro' && gyro.active) {
    s = Math.max(-1, Math.min(1, (gyro.angle - gyro.rest) * 3.2));
  }
  return s;
}
const currentDrift = () => touch.drift || keys.has(' ') || keys.has('Shift');
const currentBrake = () => touch.brake || keys.has('ArrowDown') || keys.has('s');

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

  const fill = $('driftFill');
  const colors = ['#8ea2c8', '#40c8ff', '#ff9a2e', '#c65cff'];
  const tier = st.driftTier;
  const charge = engine.player.driftChargeRatio;
  fill.style.width = `${Math.max(tier > 0 ? 22 : 2, charge * 100)}%`;
  fill.style.backgroundColor = s.boosting ? '#c65cff' : colors[tier];
  fill.style.boxShadow = tier > 0 ? `0 0 16px ${colors[tier]}` : 'none';

  hudAccum += 1;
  if (hudAccum % 6 === 0) {
    $('fpsInline').textContent = `${s.fps} FPS · ${s.particles} part. · ×${s.pixelRatio.toFixed(2)}`;
    if (state.showFps) $('fpsBadge').textContent = `${s.fps} FPS · ${s.particles} particules · rendu ×${s.pixelRatio.toFixed(2)} · ${engine?.quality.level}`;
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
  const d = pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${(x * 100).toFixed(2)},${(y * 100).toFixed(2)}`).join(' ') + ' Z';
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
  const idx = Math.max(0, Math.min(pts.length - 1, Math.round(((st.s % tr.length) / tr.length) * pts.length)));
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

function renderMenu() {
  const c = CIRCUITS[state.circuitIndex];
  const d = ROSTER[state.driverIndex];
  $('circName').textContent = c.name;
  $('circSub').textContent = c.subtitle;
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
  $('qualityToggle').textContent = `⚙️ Qualité : ${state.quality === 'auto' ? 'Auto' : state.quality === 'low' ? 'Basse' : state.quality === 'high' ? 'Haute' : 'Ultra'}`;
  $('lapsToggle').textContent = `🏁 ${state.laps} tour${state.laps > 1 ? 's' : ''}`;
  $('inputToggle').textContent = state.input === 'gyro' ? '📱 Gyroscope' : '⌨️ Boutons / clavier';
  $('soundToggle').textContent = state.sound ? '🔊 Son' : '🔇 Muet';
  $('fpsToggle').textContent = state.showFps ? '📊 FPS activé' : '📊 FPS';
  $('fpsBadge').classList.toggle('on', state.showFps);
}

function showMenu() {
  state.screen = 'menu';
  cancelAnimationFrame(rafId);
  engine?.dispose();
  engine = null;
  $('stage').innerHTML = '';
  $('menu').classList.remove('hidden');
  $('results').classList.add('hidden');
  $('pause').classList.add('hidden');
  $('hud').classList.remove('live');
  renderMenu();
}

function startRace() {
  state.screen = 'race';
  state.paused = false;
  $('menu').classList.add('hidden');
  $('results').classList.add('hidden');
  $('pause').classList.add('hidden');
  $('hud').classList.add('live');
  $('loading').classList.remove('hidden');
  // laisse le navigateur peindre le loader avant de générer les textures
  setTimeout(() => {
    startEngine();
    $('loading').classList.add('hidden');
  }, 60);
}

function showResults() {
  if (!engine) return;
  state.screen = 'results';
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
  $('resultCard').innerHTML = rows.join('');
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
bind('qualityToggle', 'click', () => {
  const order: Array<QualityLevel | 'auto'> = ['auto', 'low', 'high', 'ultra'];
  state.quality = order[(order.indexOf(state.quality) + 1) % order.length];
  renderMenu();
});
bind('lapsToggle', 'click', () => {
  state.laps = state.laps === 1 ? 3 : state.laps === 3 ? 5 : 1;
  renderMenu();
});
bind('inputToggle', 'click', async () => {
  if (state.input === 'buttons') {
    state.input = 'gyro';
    await enableGyro();
  } else {
    state.input = 'buttons';
    gyro.active = false;
  }
  renderMenu();
});
bind('soundToggle', 'click', () => {
  state.sound = !state.sound;
  renderMenu();
});
bind('fpsToggle', 'click', () => {
  state.showFps = !state.showFps;
  renderMenu();
});
bind('playBtn', 'click', startRace);
bind('againBtn', 'click', startRace);
bind('menuBtn', 'click', showMenu);
bind('resumeBtn', 'click', () => togglePause(false));
bind('restartBtn', 'click', () => {
  togglePause(false);
  engine?.restart();
});
bind('quitBtn', 'click', showMenu);
bind('pauseBtn', 'click', () => togglePause(!state.paused));

/* boutons tactiles */
const hold = (id: string, down: () => void, up: () => void) => {
  const el = $(id);
  const start = (e: Event) => {
    e.preventDefault();
    (e.currentTarget as HTMLElement).classList.add('active');
    down();
  };
  const end = (e: Event) => {
    (e.currentTarget as HTMLElement).classList.remove('active');
    up();
  };
  el.addEventListener('pointerdown', start);
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  el.addEventListener('pointerleave', end);
};
hold('leftBtn', () => (touch.steer = -1), () => (touch.steer = 0));
hold('rightBtn', () => (touch.steer = 1), () => (touch.steer = 0));
hold('driftBtn', () => (touch.drift = true), () => (touch.drift = false));
hold('brakeBtn', () => (touch.brake = true), () => (touch.brake = false));

/* clavier */
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' || e.key === 'p' || e.key === 'P') {
    if (state.screen === 'race') togglePause(!state.paused);
    return;
  }
  if (e.key === ' ') e.preventDefault();
  keys.add(e.key);
  if (e.key === 'Enter' && state.screen === 'menu') startRace();
});
window.addEventListener('keyup', (e) => keys.delete(e.key));

/* gyroscope */
async function enableGyro() {
  if (typeof (DeviceOrientationEvent as any)?.requestPermission === 'function') {
    try {
      const perm = await (DeviceOrientationEvent as any).requestPermission();
      if (perm !== 'granted') {
        state.input = 'buttons';
        toast('Gyroscope refusé', '#ff3d6e');
        return;
      }
    } catch {
      state.input = 'buttons';
      return;
    }
  }
  window.addEventListener('deviceorientation', (ev) => {
    if (ev.gamma === null) return;
    gyro.active = true;
    gyro.angle = (((ev.gamma ?? 0) * Math.PI) / 180) * 1.6;
  });
  gyro.rest = gyro.angle;
  toast('Gyroscope : inclinez pour tourner', '#40c8ff', 1800);
}

function togglePause(v: boolean) {
  state.paused = v;
  $('pause').classList.toggle('hidden', !v);
  if (v && engine) {
    const s = engine.stats;
    $('pauseStats').textContent = `${s.fps} FPS · ${s.particles} particules · rendu ×${s.pixelRatio.toFixed(2)} · qualité ${engine.quality.level}`;
  }
}

/* redimensionnement */
window.addEventListener('resize', () => {
  engine?.resize(window.innerWidth, window.innerHeight);
});

/* démarrage : on attend que tout soit monté */
renderMenu();
$('loading').classList.add('hidden');

/* hook de debug pour les captures automatisées */
(window as any).__tka = {
  start: (opts?: { circuit?: number; driver?: number; quality?: QualityLevel }) => {
    if (opts?.circuit !== undefined) state.circuitIndex = opts.circuit;
    if (opts?.driver !== undefined) state.driverIndex = opts.driver;
    if (opts?.quality) state.quality = opts.quality;
    startRace();
  },
  engine: () => engine,
  state,
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
  pauseLoop: () => cancelAnimationFrame(rafId),
  resumeLoop: () => {
    cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(loop);
  },
  /** Mode démo : le kart du joueur est piloté par l'IA. */
  setAutopilot: (v: boolean) => {
    if (engine) engine.autopilot = v;
  },
  /** Rend exactement N frames de durée fixe (captures déterministes). */
  step: (n = 1, dtMs = 16.67) => {
    if (!engine) return;
    let t = performance.now();
    for (let i = 0; i < n; i++) {
      t += dtMs;
      engine.setInput({ steer: currentSteer(), drift: currentDrift(), brake: currentBrake(), throttle: 1 });
      engine.frame(t);
    }
    updateHud();
  },
};
