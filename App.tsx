/**
 * Turbo Karts Arena — couche React Native (Expo).
 *
 * Le rendu 3D tourne dans une `GLView` (expo-gl) pilotée par le MOTEUR PARTAGÉ
 * (`src/render/world.ts`), exactement le même code que la preview web.
 * Le HUD est en React Native pur (aucun WebView) : cadence dépendante de l’appareil et du palier choisi.
 *
 * Entrées :
 *  - Boutons tactiles (accélération automatique, boutons gauche/droite + dérapage)
 *  - Gyroscope (expo-sensors `DeviceMotion`) : orientation de l'appareil projetée
 *    dans le référentiel de l'écran, avec zone morte, calibration et sensibilité
 *  - Manette Bluetooth (mappage clavier/gamepad via la preview web)
 */

import { StatusBar } from 'expo-status-bar';
import { DeviceMotion } from 'expo-sensors';
import { GLView } from 'expo-gl';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  Modal,
  AppState,
  Easing,
  Platform,
  SafeAreaView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  ScrollView,
  useWindowDimensions,
} from 'react-native';

import { PhysicsEngine } from './src/render/world';
import { CIRCUITS, type Circuit } from './src/game/circuits';
import { ROSTER, type KartProfile } from './src/game/roster';
import { VEHICLES, vehicleProfile, DIFFICULTIES, type Difficulty } from './src/game/vehicles';
import { Showroom } from './src/render/showroom';
import { autoQuality, QUALITY, type QualityLevel } from './src/core/config';
import { formatLap, formatTime } from './src/core/race';
import {
  TouchZoneController,
  type TouchPointSample,
  type TouchZoneId,
  type TouchZoneRect,
} from './src/core/touchControls';
import Icon from './src/ui/icons';
import {
  CONTROL_SETTINGS_KEY,
  DEFAULT_CONTROL_SETTINGS,
  nextSensitivity,
  nextThrottleMode,
  sanitizeControlSettings,
  SENSITIVITY_LABEL,
  THROTTLE_MODE_LABEL,
  type ControlSettings,
} from './src/core/controlSettings';
import { GYRO_SIGNAL_TIMEOUT_MS, TiltSteering, normalizeScreenAngle, type ScreenAngle } from './src/core/gyro';
import { versionBadge, versionDiagnostics } from './src/core/version';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { awardRace, buyUpgrade, buyVehicle, defaultGarage, loadGarage, upgradeCost, upgradedProfile, upgradeMultiplier, UPGRADE_KINDS, GARAGE_STORAGE_KEY, type GarageState, type UpgradeKind } from './src/game/economy';
const UP_LABEL: Record<UpgradeKind, string> = { engine: 'Moteur', acceleration: 'Accélération', topSpeed: 'Vitesse max', braking: 'Freinage', grip: 'Adhérence', protection: 'Protection', turbo: 'Turbo' };

type Screen = 'menu' | 'race' | 'results';

interface Settings {
  quality: QualityLevel | 'auto';
  sound: boolean;
  reducedMotion: boolean;
  laps: number;
  vehicle: number;
  difficulty: Difficulty;
  /** V4.1 — commandes persistées : mode, sensibilité, calibration, accélération. */
  controls: ControlSettings;
}

const DEFAULT_SETTINGS: Settings = {
  quality: 'auto',
  sound: false,
  reducedMotion: false,
  laps: 3,
  vehicle: 0,
  difficulty: 'arcade',
  controls: { ...DEFAULT_CONTROL_SETTINGS },
};

type HeldButtons = {
  left: boolean;
  right: boolean;
  drift: boolean;
  brake: boolean;
  fire: boolean;
  turbo: boolean;
  accel: boolean;
};
const EMPTY_HELD: HeldButtons = {
  left: false,
  right: false,
  drift: false,
  brake: false,
  fire: false,
  turbo: false,
  accel: false,
};

function makeInitialHud(laps: number) {
  return {
    speed: 0,
    warning: '',
    tier: 0,
    charge: 0,
    boosting: false,
    lap: 1,
    laps,
    place: 1,
    total: 6,
    time: 0,
    countdown: 0,
    best: 0,
    results: null as null | { place: number; time: number; laps: number[] },
    weapon: null as string | null, shield: false, coins: 0, combatEvent: '', health: 100,
    turbo: { ready: false, active: false, charge: 0, tier: 0, cooldown: 0, mastery: false, masteryCount: 0 },
    gyroLive: false,
  };
}

function extractTouchSamples(list: any, fallback?: any): TouchPointSample[] {
  if (Array.isArray(list) || (list && typeof list.length === 'number')) {
    return Array.from(list, (t: any, idx: number) => ({
      identifier: Number.isFinite(Number(t?.identifier)) ? Number(t.identifier) : idx,
      pageX: Number(t?.pageX ?? 0),
      pageY: Number(t?.pageY ?? 0),
    }));
  }
  if (fallback && Number.isFinite(Number(fallback.pageX)) && Number.isFinite(Number(fallback.pageY))) {
    return [
      {
        identifier: Number.isFinite(Number(fallback.identifier)) ? Number(fallback.identifier) : 0,
        pageX: Number(fallback.pageX),
        pageY: Number(fallback.pageY),
      },
    ];
  }
  return [];
}

export default function App() {
  const [screen, setScreen] = useState<Screen>('menu');
  const [paused, setPaused] = useState(false);
  const [pressedButtons, setPressedButtons] = useState<HeldButtons>(EMPTY_HELD);
  const [circuitIndex, setCircuitIndex] = useState(0);
  const [profileIndex, setProfileIndex] = useState(0);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [garage, setGarage] = useState<GarageState>(() => defaultGarage());
  const [coinsEarned, setCoinsEarned] = useState(0);
  const raceIdRef = useRef('');
  useEffect(() => { AsyncStorage.getItem(GARAGE_STORAGE_KEY).then((raw) => { if (raw) setGarage(loadGarage({ getItem: () => raw, setItem: () => undefined })); }).catch(() => undefined); }, []);
  useEffect(() => { AsyncStorage.setItem(GARAGE_STORAGE_KEY, JSON.stringify(garage)).catch(() => undefined); }, [garage]);
  /* V4.1 — réglages de commande : chargés une fois, réécrits à chaque changement. */
  const controlsLoadedRef = useRef(false);
  useEffect(() => {
    AsyncStorage.getItem(CONTROL_SETTINGS_KEY)
      .then((raw) => {
        if (!raw) return;
        try {
          const parsed = sanitizeControlSettings(JSON.parse(raw));
          setSettings((prev) => ({ ...prev, controls: parsed }));
        } catch {
          /* réglage corrompu : valeurs par défaut conservées */
        }
      })
      .catch(() => undefined)
      .finally(() => {
        controlsLoadedRef.current = true;
      });
  }, []);
  useEffect(() => {
    if (!controlsLoadedRef.current) return;
    AsyncStorage.setItem(CONTROL_SETTINGS_KEY, JSON.stringify(settings.controls)).catch(() => undefined);
  }, [settings.controls]);
  const [hud, setHud] = useState(() => makeInitialHud(DEFAULT_SETTINGS.laps));

  const engineRef = useRef<PhysicsEngine | null>(null);
  const screenRef = useRef<Screen>('menu');
  const raceSessionRef = useRef(0);
  const touchControllerRef = useRef(new TouchZoneController());
  const inputRef = useRef<HeldButtons>({ ...EMPTY_HELD });
  const pausedRef = useRef(false);
  const rafRef = useRef<number | null>(null);
  const frameLoopRef = useRef<((t: number) => void) | null>(null);
  const resultsTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** V4.1 — volant virtuel (même module pur que la preview web). */
  const tiltRef = useRef(new TiltSteering());
  const gyroRef = useRef({ running: false, hasSample: false, lastAt: 0, beta: 0, gamma: 0, orientation: 0 });
  const tiltFrameRef = useRef(0);
  const [controlMessage, setControlMessage] = useState('');
  const hudTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  screenRef.current = screen;

  const syncTouchInputs = useCallback(() => {
    const c = touchControllerRef.current.controls;
    const fireDown = c.isDown('fire');
    if (fireDown && !inputRef.current.fire) engineRef.current?.firePlayerWeapon();
    const next: HeldButtons = {
      left: c.isDown('left'),
      right: c.isDown('right'),
      drift: c.drift,
      brake: c.brake,
      fire: fireDown,
      turbo: c.turbo,
      accel: c.accel,
    };
    inputRef.current = next;
    setPressedButtons((prev) =>
      prev.left === next.left &&
      prev.right === next.right &&
      prev.drift === next.drift &&
      prev.brake === next.brake &&
      prev.fire === next.fire &&
      prev.turbo === next.turbo &&
      prev.accel === next.accel
        ? prev
        : next,
    );
  }, []);

  const clearHeldInputs = useCallback(() => {
    touchControllerRef.current.clear();
    inputRef.current = { ...EMPTY_HELD };
    setPressedButtons((prev) =>
      prev.left || prev.right || prev.drift || prev.brake || prev.fire || prev.turbo || prev.accel
        ? EMPTY_HELD
        : prev,
    );
    // Le volant virtuel revient au centre sans perdre sa calibration.
    tiltRef.current.reset();
    tiltFrameRef.current = 0;
    engineRef.current?.setInput({ steer: 0, drift: false, brake: false, throttle: 1, turbo: false });
  }, []);

  const stopFrameLoop = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const startFrameLoop = useCallback(() => {
    stopFrameLoop();
    if (!engineRef.current || pausedRef.current || screenRef.current !== 'race' || !frameLoopRef.current) {
      return;
    }
    rafRef.current = requestAnimationFrame(frameLoopRef.current);
  }, [stopFrameLoop]);

  const stopTimers = useCallback(() => {
    if (hudTimer.current !== null) {
      clearInterval(hudTimer.current);
      hudTimer.current = null;
    }
    if (resultsTimeoutRef.current !== null) {
      clearTimeout(resultsTimeoutRef.current);
      resultsTimeoutRef.current = null;
    }
  }, []);

  const scheduleResultsTransition = useCallback(
    (targetEngine: PhysicsEngine) => {
      if (hudTimer.current !== null) {
        clearInterval(hudTimer.current);
        hudTimer.current = null;
      }
      const p = targetEngine.race.player;
      const finalResults = {
        place: p.state.place,
        time: p.state.finishTime,
        laps: [...p.state.lapTimes],
      };
      setHud((current) => ({
        ...current,
        speed: Math.round(p.kmh),
        warning: '',
        tier: p.state.driftTier,
        charge: p.driftChargeRatio,
        boosting: p.isBoosting,
        place: p.state.place,
        total: targetEngine.race.karts.length,
        time: targetEngine.race.raceTime,
        countdown: 0,
        best: p.state.bestLapTime,
        results: finalResults,
      }));
      setGarage((g) => { const ng = { ...g, owned: [...g.owned], upgrades: { ...g.upgrades }, rewardedRaces: [...g.rewardedRaces], bestTimes: { ...g.bestTimes }, stats: { ...g.stats } }; const gain = awardRace(ng, raceIdRef.current || `race-${Date.now()}`, finalResults.place, targetEngine.combatHud.coins, finalResults.time, targetEngine.circuit.id); setCoinsEarned(gain); return ng; });
      if (resultsTimeoutRef.current !== null) clearTimeout(resultsTimeoutRef.current);
      resultsTimeoutRef.current = setTimeout(() => {
        resultsTimeoutRef.current = null;
        if (engineRef.current !== targetEngine || pausedRef.current || screenRef.current !== 'race') return;
        raceSessionRef.current += 1;
        clearHeldInputs();
        stopFrameLoop();
        frameLoopRef.current = null;
        targetEngine.dispose();
        engineRef.current = null;
        screenRef.current = 'results';
        setHud((current) => ({ ...current, results: finalResults }));
        setScreen('results');
      }, 1600);
    },
    [clearHeldInputs, stopFrameLoop],
  );

  const pauseRace = useCallback(() => {
    clearHeldInputs();
    if (pausedRef.current || screenRef.current !== 'race') return;
    pausedRef.current = true;
    engineRef.current?.resetFrameClock();
    if (resultsTimeoutRef.current !== null) {
      clearTimeout(resultsTimeoutRef.current);
      resultsTimeoutRef.current = null;
    }
    stopFrameLoop();
    setPaused(true);
  }, [clearHeldInputs, stopFrameLoop]);

  const resumeRace = useCallback(() => {
    if (!pausedRef.current || screenRef.current !== 'race') return;
    const engine = engineRef.current;
    clearHeldInputs();
    pausedRef.current = false;
    engine?.resetFrameClock();
    setPaused(false);
    if (engine?.race.phase === 'finished') {
      scheduleResultsTransition(engine);
    }
    startFrameLoop();
  }, [clearHeldInputs, scheduleResultsTransition, startFrameLoop]);

  /* ---------------- gyroscope (V4.1) ----------------
     On lit l'ORIENTATION de l'appareil (DeviceMotion.rotation : alpha/beta/gamma),
     jamais la vitesse angulaire du gyroscope : c'est la seule source qui permette
     un volant stable, qui revient au centre quand le téléphone est immobile.
     Le calcul d'inclinaison vit dans `src/core/gyro.ts` (le même que sur le web). */
  const failGyro = useCallback(
    (reason: string) => {
      gyroRef.current.running = false;
      gyroRef.current.hasSample = false;
      tiltRef.current.reset();
      setControlMessage(`Gyroscope indisponible (${reason}) — boutons tactiles réactivés.`);
      setSettings((prev) => ({ ...prev, controls: { ...prev.controls, steerMode: 'buttons' } }));
    },
    [],
  );

  useEffect(() => {
    const steerMode = settings.controls.steerMode;
    const tilt = tiltRef.current;
    tilt.sensitivity = settings.controls.sensitivity;
    tilt.invertTilt = settings.controls.invertTilt;
    tilt.setCalibration(settings.controls.calibration);
    if (steerMode !== 'gyro') {
      gyroRef.current.running = false;
      gyroRef.current.hasSample = false;
      return;
    }
    let sub: { remove: () => void } | null = null;
    let cancelled = false;
    let timeout: ReturnType<typeof setTimeout> | null = null;
    (async () => {
      try {
        const available = await DeviceMotion.isAvailableAsync();
        if (cancelled) return;
        if (!available) {
          failGyro('capteur absent');
          return;
        }
        const permission = await DeviceMotion.requestPermissionsAsync?.();
        if (cancelled) return;
        if (permission && permission.status !== 'granted') {
          failGyro('autorisation refusée');
          return;
        }
        DeviceMotion.setUpdateInterval(16);
        sub = DeviceMotion.addListener((measurement) => {
          const rotation = measurement?.rotation;
          if (!rotation || !Number.isFinite(rotation.beta) || !Number.isFinite(rotation.gamma)) return;
          const g = gyroRef.current;
          g.beta = (rotation.beta * 180) / Math.PI;
          g.gamma = (rotation.gamma * 180) / Math.PI;
          g.orientation = normalizeScreenAngle(Number((measurement as { orientation?: number }).orientation ?? 0));
          g.lastAt = Date.now();
          if (!g.hasSample) {
            g.hasSample = true;
            tilt.reset();
            tilt.setCalibration(settings.controls.calibration);
          }
        });
        gyroRef.current.running = true;
        gyroRef.current.hasSample = false;
        setControlMessage('Gyroscope en cours d’initialisation…');
        timeout = setTimeout(() => {
          timeout = null;
          if (!gyroRef.current.hasSample) failGyro('aucune donnée reçue');
          else setControlMessage('Gyroscope actif — inclinez le téléphone pour tourner.');
        }, 1500);
      } catch {
        if (!cancelled) failGyro('capteur indisponible');
      }
    })();
    return () => {
      cancelled = true;
      if (timeout) clearTimeout(timeout);
      sub?.remove();
      gyroRef.current.running = false;
    };
  }, [settings.controls.steerMode, failGyro]);

  /* Les réglages fins (sensibilité, sens, calibration) suivent sans réabonnement. */
  useEffect(() => {
    const tilt = tiltRef.current;
    tilt.sensitivity = settings.controls.sensitivity;
    tilt.invertTilt = settings.controls.invertTilt;
    tilt.setCalibration(settings.controls.calibration);
  }, [settings.controls.sensitivity, settings.controls.invertTilt, settings.controls.calibration]);

  const calibrateGyro = useCallback(() => {
    const g = gyroRef.current;
    if (settings.controls.steerMode !== 'gyro' || !g.hasSample) {
      setControlMessage('Activez d’abord le gyroscope, puis recalibrez en tenant le téléphone naturellement.');
      return;
    }
    const tilt = tiltRef.current;
    tilt.push(g.beta, g.gamma, g.orientation, 1 / 60, Date.now());
    const degrees = Math.round(tilt.calibrate() * 10) / 10;
    setSettings((prev) => ({ ...prev, controls: { ...prev.controls, calibration: degrees } }));
    setControlMessage(`Position neutre enregistrée (${degrees.toFixed(0)}°).`);
  }, [settings.controls.steerMode]);

  /* Recentrage en course : neutre rejoint la position actuelle sans à-coup. */
  const recenterGyro = useCallback(() => {
    const g = gyroRef.current;
    if (settings.controls.steerMode !== 'gyro' || !g.hasSample) {
      setControlMessage('Activez le gyroscope pour recentrer la direction.');
      return;
    }
    const tilt = tiltRef.current;
    tilt.push(g.beta, g.gamma, g.orientation, 1 / 60, Date.now());
    tilt.recenter();
    setControlMessage('Direction recentrée — le kart revient droit sans à-coup.');
  }, [settings.controls.steerMode]);

  /* ---------------- boucle de HUD ---------------- */
  const startHudLoop = useCallback(() => {
    if (hudTimer.current !== null) clearInterval(hudTimer.current);
    hudTimer.current = setInterval(() => {
      const e = engineRef.current;
      if (!e || pausedRef.current || screenRef.current !== 'race') return;
      const race = e.race;
      if (race.phase === 'finished') {
        scheduleResultsTransition(e);
        return;
      }
      const p = race.player;
      setHud({
        speed: Math.round(p.kmh),
        warning: e.stats.hazard
          ? `${e.stats.hazard.hazard.label} · ${Math.round(e.stats.hazard.distance)} m`
          : '',
        tier: p.state.driftTier,
        charge: p.driftChargeRatio,
        boosting: p.isBoosting,
        lap: Math.min(race.circuit ? settings.laps : settings.laps, p.state.lap + 1),
        laps: settings.laps,
        place: p.state.place,
        total: race.karts.length,
        time: race.raceTime,
        countdown: race.phase === 'countdown' ? Math.max(0, Math.ceil(race.countdown)) : 0,
        best: p.state.bestLapTime,
        results: null,
        weapon: e.combatHud.weapon, shield: e.combatHud.shield, coins: e.combatHud.coins, combatEvent: e.combatHud.event, health: e.combatHud.health,
        turbo: e.stats.turbo,
        gyroLive: (() => {
          const g = gyroRef.current;
          return settings.controls.steerMode === 'gyro' && g.hasSample && Date.now() - g.lastAt <= GYRO_SIGNAL_TIMEOUT_MS;
        })(),
      });
    }, 66);
  }, [settings.laps, scheduleResultsTransition]);

  const restartCurrentRace = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;
    if (resultsTimeoutRef.current !== null) {
      clearTimeout(resultsTimeoutRef.current);
      resultsTimeoutRef.current = null;
    }
    clearHeldInputs();
    engine.restart();
    engine.resetFrameClock();
    setHud({
      ...makeInitialHud(settings.laps),
      total: engine.race.karts.length,
      countdown: Math.max(0, Math.ceil(engine.race.countdown)),
    });
    startHudLoop();
    if (pausedRef.current) {
      resumeRace();
    } else {
      startFrameLoop();
    }
  }, [clearHeldInputs, resumeRace, settings.laps, startFrameLoop, startHudLoop]);

  useEffect(
    () => () => {
      raceSessionRef.current += 1;
      stopTimers();
      stopFrameLoop();
      frameLoopRef.current = null;
      touchControllerRef.current.clear();
      engineRef.current?.dispose();
      engineRef.current = null;
    },
    [stopFrameLoop, stopTimers],
  );

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      clearHeldInputs();
      if (nextState !== 'active' && screenRef.current === 'race') {
        pauseRace();
      }
    });
    return () => subscription.remove();
  }, [clearHeldInputs, pauseRace]);

  /* ---------------- démarrage / GLView ---------------- */
  const circuit: Circuit = CIRCUITS[circuitIndex];
  const profile: KartProfile = upgradedProfile(vehicleProfile(ROSTER[profileIndex], VEHICLES[settings.vehicle]), garage);

  const onContextCreate = useCallback(
    async (gl: any) => {
      const sessionId = raceSessionRef.current;
      const native = Platform.OS !== 'web';
      const rendererName = (() => {
        try {
          const ext = gl.getExtension('WEBGL_debug_renderer_info');
          return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : '';
        } catch {
          return '';
        }
      })();
      const level: QualityLevel =
        settings.quality === 'auto'
          ? autoQuality({
              isNative: native,
              gpuRenderer: rendererName,
              totalMemoryGB: (globalThis as any).__deviceMemory,
              logicalCores: (globalThis as any).navigator?.hardwareConcurrency,
            })
          : settings.quality;

      // expo-gl fournit les dimensions du framebuffer natif
      const dims = await new Promise<{ width: number; height: number }>((resolve) => {
        const w = gl.drawingBufferWidth || 1280;
        const h = gl.drawingBufferHeight || 720;
        resolve({ width: w, height: h });
      });

      if (raceSessionRef.current !== sessionId || screenRef.current !== 'race') {
        return;
      }

      stopFrameLoop();
      if (engineRef.current) {
        engineRef.current.dispose();
        engineRef.current = null;
      }

      const engine = new PhysicsEngine({
        gl,
        canvas: null,
        width: dims.width,
        height: dims.height,
        pixelRatio: 1, // expo-gl rend déjà à la résolution du framebuffer natif
        quality: QUALITY[level],
        reducedMotion: settings.reducedMotion,
        circuit,
        profile,
        laps: settings.laps,
        difficulty: settings.difficulty,
        onFrame: () => undefined,
      });
      engine.onFinish = () => {
        if (engineRef.current === engine && !pausedRef.current && screenRef.current === 'race') {
          scheduleResultsTransition(engine);
        }
      };
      engineRef.current = engine;
      engine.resetFrameClock();
      startHudLoop();

      // boucle de rendu pilotée par requestAnimationFrame (expo-gl l'expose)
      const loop = (t: number) => {
        rafRef.current = null;
        if (engineRef.current !== engine || pausedRef.current || screenRef.current !== 'race') {
          return;
        }
        const i = inputRef.current;
        const ctrl = settings.controls;
        let steer = i.left === i.right ? 0 : i.left ? -1 : 1;
        if (ctrl.steerMode === 'gyro') {
          const g = gyroRef.current;
          const nowMs = Date.now();
          // Le gyroscope ne dirige que s'il émet encore réellement des données.
          if (g.hasSample && nowMs - g.lastAt <= GYRO_SIGNAL_TIMEOUT_MS) {
            const dt = tiltFrameRef.current === 0 ? 1 / 60 : Math.max(1 / 240, Math.min(0.1, (t - tiltFrameRef.current) / 1000));
            tiltFrameRef.current = t;
            tiltRef.current.push(g.beta, g.gamma, g.orientation as ScreenAngle, dt, nowMs);
            steer = tiltRef.current.steer;
          }
        }
        const throttle = ctrl.throttleMode === 'auto' ? 1 : i.accel ? 1 : 0;
        engine.setInput({ steer, drift: i.drift, brake: i.brake, throttle, turbo: i.turbo });
        engine.frame(t);
        if (engineRef.current === engine && !pausedRef.current && screenRef.current === 'race') {
          if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
          rafRef.current = requestAnimationFrame(loop);
        }
      };
      frameLoopRef.current = loop;
      if (!pausedRef.current) {
        startFrameLoop();
      }
    },
    [circuit, profile, scheduleResultsTransition, settings, startFrameLoop, startHudLoop, stopFrameLoop],
  );

  const startRace = useCallback(() => {
    raceIdRef.current = `race-${Date.now()}`; setCoinsEarned(0);
    raceSessionRef.current += 1;
    clearHeldInputs();
    stopTimers();
    stopFrameLoop();
    frameLoopRef.current = null;
    if (engineRef.current) {
      engineRef.current.dispose();
      engineRef.current = null;
    }
    pausedRef.current = false;
    setPaused(false);
    setHud(makeInitialHud(settings.laps));
    // Le joueur tient son téléphone en position de jeu : recalage du volant virtuel.
    const g = gyroRef.current;
    if (settings.controls.steerMode === 'gyro' && g.hasSample) {
      const tilt = tiltRef.current;
      tilt.push(g.beta, g.gamma, g.orientation as ScreenAngle, 1 / 60, Date.now());
      const degrees = Math.round(tilt.calibrate() * 10) / 10;
      setSettings((prev) => ({ ...prev, controls: { ...prev.controls, calibration: degrees } }));
    }
    screenRef.current = 'race';
    setScreen('race');
  }, [clearHeldInputs, settings.controls.steerMode, settings.laps, stopFrameLoop, stopTimers]);

  const quitRace = useCallback(() => {
    raceSessionRef.current += 1;
    clearHeldInputs();
    pausedRef.current = false;
    setPaused(false);
    stopFrameLoop();
    frameLoopRef.current = null;
    stopTimers();
    engineRef.current?.dispose();
    engineRef.current = null;
    setHud(makeInitialHud(settings.laps));
    screenRef.current = 'menu';
    setScreen('menu');
  }, [clearHeldInputs, settings.laps, stopFrameLoop, stopTimers]);

  const setZoneRect = useCallback(
    (id: TouchZoneId, rect: TouchZoneRect | null) => {
      touchControllerRef.current.setZone(id, rect);
      syncTouchInputs();
    },
    [syncTouchInputs],
  );

  const handleRaceTouchStart = useCallback(
    (event: any) => {
      if (pausedRef.current || screenRef.current !== 'race') return;
      const ne = event?.nativeEvent;
      const changed = extractTouchSamples(ne?.changedTouches, ne);
      const all = ne?.touches ? extractTouchSamples(ne.touches) : undefined;
      const result = touchControllerRef.current.handleTouchStart(changed, all);
      syncTouchInputs();
      if (result === 'pause') {
        pauseRace();
      }
    },
    [pauseRace, syncTouchInputs],
  );

  const handleRaceTouchMove = useCallback(
    (event: any) => {
      if (pausedRef.current || screenRef.current !== 'race') return;
      const ne = event?.nativeEvent;
      const changed = extractTouchSamples(ne?.changedTouches, ne);
      const all = ne?.touches ? extractTouchSamples(ne.touches) : undefined;
      touchControllerRef.current.handleTouchMove(changed, all);
      syncTouchInputs();
    },
    [syncTouchInputs],
  );

  const handleRaceTouchEnd = useCallback(
    (event: any) => {
      const ne = event?.nativeEvent;
      const changed = extractTouchSamples(ne?.changedTouches, ne);
      const all = ne?.touches ? extractTouchSamples(ne.touches) : undefined;
      touchControllerRef.current.handleTouchEnd(changed, all);
      syncTouchInputs();
    },
    [syncTouchInputs],
  );

  const handleRaceTouchCancel = useCallback(() => {
    touchControllerRef.current.handleTouchCancel();
    clearHeldInputs();
  }, [clearHeldInputs]);

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar hidden />
      {screen === 'menu' && (
        <MenuScreen
          circuitIndex={circuitIndex}
          setCircuitIndex={setCircuitIndex}
          profileIndex={profileIndex}
          setProfileIndex={setProfileIndex}
          settings={settings}
          setSettings={setSettings}
          garage={garage}
          onGarageChange={setGarage}
          onStart={startRace}
          controlMessage={controlMessage}
          gyroLive={settings.controls.steerMode === 'gyro' && gyroRef.current.hasSample}
          onCalibrateGyro={calibrateGyro}
        />
      )}

      {screen === 'race' && (
        <View
          style={StyleSheet.absoluteFill}
          onTouchStart={handleRaceTouchStart}
          onTouchMove={handleRaceTouchMove}
          onTouchEnd={handleRaceTouchEnd}
          onTouchCancel={handleRaceTouchCancel}
        >
          <GLView style={StyleSheet.absoluteFill} onContextCreate={onContextCreate} />
          <TouchHud
            hud={hud}
            pressed={pressedButtons}
            onZoneRect={setZoneRect}
            onPause={pauseRace}
            onRecenter={recenterGyro}
            gyro={settings.controls.steerMode === 'gyro' && hud.gyroLive}
            manualThrottle={settings.controls.throttleMode === 'manual'}
            bike={VEHICLES[settings.vehicle].kind !== 'kart'}
            paused={paused}
          />
          {!!hud.warning && (
            <Text
              style={{
                position: 'absolute',
                top: 90,
                alignSelf: 'center',
                color: '#ffe8ad',
                backgroundColor: '#17202edd',
                padding: 8,
                borderRadius: 8,
              }}
            >
              ⚠ {hud.warning}
            </Text>
          )}
          {paused && (
            <PauseMenu
              onResume={resumeRace}
              onRestart={restartCurrentRace}
              onMenu={quitRace}
              diagnostics={versionDiagnostics()}
              gyroLabel={
                settings.controls.steerMode === 'gyro'
                  ? hud.gyroLive
                    ? 'GYROSCOPE : ACTIVÉ'
                    : 'GYROSCOPE : EN ATTENTE…'
                  : 'GYROSCOPE : DÉSACTIVÉ'
              }
              onToggleGyro={() =>
                setSettings({
                  ...settings,
                  controls: {
                    ...settings.controls,
                    steerMode: settings.controls.steerMode === 'gyro' ? 'buttons' : 'gyro',
                  },
                })
              }
              onCalibrateGyro={calibrateGyro}
              throttleLabel={THROTTLE_MODE_LABEL[settings.controls.throttleMode]}
              onToggleThrottle={() =>
                setSettings({
                  ...settings,
                  controls: {
                    ...settings.controls,
                    throttleMode: nextThrottleMode(settings.controls.throttleMode),
                  },
                })
              }
              controlMessage={controlMessage}
            />
          )}
        </View>
      )}

      {screen === 'results' && hud.results && (
        <ResultsScreen
          result={hud.results}
          circuitName={circuit.name}
          profile={profile}
          coinsEarned={coinsEarned}
          balance={garage.coins}
          onRestart={startRace}
          onQuit={quitRace}
        />
      )}
    </SafeAreaView>
  );
}

/* ------------------------------------------------------------------ */
/* Écran de menu                                                      */
/* ------------------------------------------------------------------ */

/** GL garage uses the same mesh factory as the race, and releases its frame loop. */
const NativeGarage: React.FC<{ profile: KartProfile; circuit: Circuit; reducedMotion: boolean; premium?: boolean }> = ({ profile, circuit, reducedMotion, premium = false }) => {
  const showroom = useRef<Showroom | null>(null);
  const raf = useRef<number>(0);
  const gesture = useRef({ x: 0, distance: 0 });
  useEffect(() => {
    showroom.current?.select(profile);
  }, [profile.id, profile.vehicleId]);
  useEffect(() => {
    if (!showroom.current) return;
    showroom.current.reducedMotion = reducedMotion;
    showroom.current.setCircuit(circuit);
    showroom.current.setBackdropVisible(!premium);
  }, [circuit.id, reducedMotion, premium]);
  useEffect(
    () => () => {
      cancelAnimationFrame(raf.current);
      showroom.current?.dispose();
      showroom.current = null;
    },
    [],
  );
  return (
    <GLView
      style={{ width: '100%', height: 260 }}
      onTouchStart={e => {
        const t = e.nativeEvent.touches;
        gesture.current = { x: t[0]?.pageX ?? 0, distance: t.length === 2 ? Math.hypot(t[0].pageX - t[1].pageX, t[0].pageY - t[1].pageY) : 0 };
      }}
      onTouchMove={e => {
        const t = e.nativeEvent.touches;
        if (t.length === 2) {
          const distance = Math.hypot(t[0].pageX - t[1].pageX, t[0].pageY - t[1].pageY);
          if (gesture.current.distance) showroom.current?.zoom((gesture.current.distance - distance) * 0.015);
          gesture.current.distance = distance;
        } else if (t.length === 1) {
          if (!gesture.current.distance) showroom.current?.rotate((t[0].pageX - gesture.current.x) * 0.012);
          gesture.current.distance = 0;
        }
        gesture.current.x = t[0]?.pageX ?? 0;
      }}
      onContextCreate={(gl: any) => {
        showroom.current = new Showroom(null, profile, gl);
        showroom.current.reducedMotion = reducedMotion;
        showroom.current.setCircuit(circuit);
        showroom.current.setBackdropVisible(!premium);
        const frame = (time: number) => {
          if (!showroom.current) return;
          showroom.current.frame(time, gl.drawingBufferWidth, gl.drawingBufferHeight);
          raf.current = requestAnimationFrame(frame);
        };
        raf.current = requestAnimationFrame(frame);
      }}
    />
  );
};

const MenuScreen: React.FC<{
  circuitIndex: number;
  setCircuitIndex: (n: number) => void;
  profileIndex: number;
  setProfileIndex: (n: number) => void;
  settings: Settings;
  setSettings: (s: Settings) => void;
  garage: GarageState;
  onGarageChange: (g: GarageState) => void;
  onStart: () => void;
  controlMessage: string;
  gyroLive: boolean;
  onCalibrateGyro: () => void;
}> = ({
  circuitIndex,
  setCircuitIndex,
  profileIndex,
  setProfileIndex,
  settings,
  setSettings,
  garage,
  onGarageChange,
  onStart,
  controlMessage,
  gyroLive,
  onCalibrateGyro,
}) => {
  const setControls = (patch: Partial<ControlSettings>) =>
    setSettings({ ...settings, controls: { ...settings.controls, ...patch } });
  const gyroLabel =
    settings.controls.steerMode === 'gyro'
      ? gyroLive
        ? 'GYROSCOPE : ACTIVÉ'
        : 'GYROSCOPE : EN ATTENTE…'
      : 'GYROSCOPE : DÉSACTIVÉ';
  const circuit = CIRCUITS[circuitIndex];
  const driver = ROSTER[profileIndex];
  const vehicle = VEHICLES[settings.vehicle];
  const owned = garage.owned.includes(vehicle.id);
  const profile = upgradedProfile(vehicleProfile(driver, vehicle), garage);
  const [upKind, setUpKind] = useState<UpgradeKind>('engine');
  const upLevel = garage.upgrades[vehicle.id]?.[upKind] ?? 0;
  const { width } = useWindowDimensions();
  const [showSettings, setShowSettings] = useState(false);
  const [garageOpen, setGarageOpen] = useState(false);
  const [garageTab, setGarageTab] = useState(0);
  const [garageMessage, setGarageMessage] = useState('');


  const statBar = (label: string, value: number) => (
    <View style={styles.statRow} key={label}>
      <Text style={styles.statLabel}>{label}</Text>
      <View style={styles.statTrack}>
        <View style={[styles.statFill, { width: `${Math.min(100, (value / 1.15) * 100)}%` }]} />
      </View>
    </View>
  );

  return (
    <ScrollView
      contentContainerStyle={[
        styles.menu,
        { flex: undefined, flexGrow: 1, paddingVertical: 20, minHeight: '100%' },
      ]}
      style={{ flex: 1 }}
    >
      <TouchableOpacity accessibilityRole="button" style={styles.toolButton} onPress={() => setGarageOpen(true)}><Text style={styles.toolText}>GARAGE TURBO KARTS</Text></TouchableOpacity>
      <Modal visible={garageOpen} animationType="fade" onRequestClose={() => setGarageOpen(false)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: '#0b1426' }}>
          <ScrollView contentContainerStyle={{ padding: 20, gap: 14 }}>
            <Text style={{ color: '#e4efff', fontSize: 26, fontWeight: '900' }}>GARAGE TURBO KARTS</Text>
            <TouchableOpacity style={styles.toolButton} onPress={() => setGarageOpen(false)}><Text style={styles.toolText}>Retour au menu</Text></TouchableOpacity>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {['MES VÉHICULES', 'BOUTIQUE', 'AMÉLIORATIONS'].map((label, i) => <TouchableOpacity key={label} accessibilityState={{ selected: garageTab === i }} style={[styles.toolButton, { borderColor: garageTab === i ? '#64e5ff' : '#34516c' }]} onPress={() => setGarageTab(i)}><Text style={styles.toolText}>{label}</Text></TouchableOpacity>)}
            </View>
            {garageOpen && <NativeGarage profile={profile} circuit={circuit} reducedMotion={settings.reducedMotion} premium />}
            <Text style={{ color: '#ffd866', fontSize: 18 }}>{garage.coins} Turbo Coins · {vehicle.price ?? 0} TC</Text>
            <Text style={{ color: 'white', fontSize: 22 }}>{vehicle.name}</Text>
            <Text style={{ color: '#b1cee4' }}>{vehicle.description}</Text>
            <Text style={{ color: '#b1cee4' }}>Vitesse ×{profile.speed.toFixed(2)} · Accélération ×{profile.accel.toFixed(2)} · Adhérence ×{profile.grip.toFixed(2)} · Freinage ×{(profile.brake ?? 1).toFixed(2)}</Text>
            <TouchableOpacity disabled={!owned && garage.coins < (vehicle.price ?? 0)} style={styles.toolButton} onPress={() => {
              const ng = { ...garage, owned: [...garage.owned] };
              if (!owned && !buyVehicle(ng, vehicle.id, vehicle.price ?? 0).ok) return;
              ng.selected = vehicle.id; onGarageChange(ng);
              setGarageMessage(owned ? `${vehicle.name} prêt pour la course` : `${vehicle.name} débloqué !`);
            }}><Text style={styles.toolText}>{owned ? 'Sélectionner pour la course' : `Acheter — ${vehicle.price ?? 0} TC`}</Text></TouchableOpacity>
            <Text accessibilityLiveRegion="polite" style={{ color: '#80ffce' }}>{garageMessage}</Text>
            {garageTab === 2 ? UPGRADE_KINDS.map(kind => {
              const level = garage.upgrades[vehicle.id]?.[kind] ?? 0, cost = upgradeCost(kind, level);
              return <TouchableOpacity key={kind} style={styles.toolButton} disabled={!owned || level >= 5 || garage.coins < cost} onPress={() => {
                const ng = { ...garage, upgrades: { ...garage.upgrades, [vehicle.id]: { ...garage.upgrades[vehicle.id] } } };
                if (buyUpgrade(ng, vehicle.id, kind).ok) onGarageChange(ng);
              }}><Text style={styles.toolText}>{UP_LABEL[kind]} · {level}/5 · ×{(1 + level * 0.03).toFixed(2)} {level >= 5 ? 'MAX' : `→ ×${(1 + (level + 1) * 0.03).toFixed(2)} · ${cost} TC`}</Text></TouchableOpacity>;
            }) : VEHICLES.map((v, i) => garage.owned.includes(v.id) === (garageTab === 0) && <TouchableOpacity key={v.id} style={styles.toolButton} onPress={() => { setSettings({ ...settings, vehicle: i }); setGarageMessage(''); }}><Text style={styles.toolText}>{v.name} · {v.price ?? 0} TC · V {v.speed.toFixed(2)} / A {v.accel.toFixed(2)} / G {v.grip.toFixed(2)}</Text></TouchableOpacity>)}
            <Text style={{ color: '#b1cee4' }}>Glisser : rotation 360° · Pincer : zoom</Text>
          </ScrollView>
        </SafeAreaView>
      </Modal>
      {!garageOpen && <NativeGarage profile={profile} circuit={circuit} reducedMotion={settings.reducedMotion} />}
      <View style={styles.menuGlow} />
      <Text style={styles.logo}>
        TURBO<Text style={styles.logoAccent}> KARTS</Text>
      </Text>
      <Text style={styles.logoSub}>A R E N A</Text>

      <View style={styles.pickerRow}>
        <TouchableOpacity
          onPress={() => setCircuitIndex((circuitIndex + CIRCUITS.length - 1) % CIRCUITS.length)}
        >
          <Icon name="chevronLeft" size={34} color="#9fb4ff" />
        </TouchableOpacity>
        <View style={{ alignItems: 'center' }}>
          <Text style={styles.pickerTitle}>{circuit.name}</Text>
          <Text style={styles.pickerSub}>
            {circuit.subtitle} · {circuit.difficulty ?? 'Intermédiaire'}
          </Text>
        </View>
        <TouchableOpacity onPress={() => setCircuitIndex((circuitIndex + 1) % CIRCUITS.length)}>
          <Icon name="chevronRight" size={34} color="#9fb4ff" />
        </TouchableOpacity>
      </View>

      <View style={styles.pickerRow}>
        <TouchableOpacity onPress={() => setProfileIndex((profileIndex + ROSTER.length - 1) % ROSTER.length)}>
          <Icon name="chevronLeft" size={34} color="#9fb4ff" />
        </TouchableOpacity>
        <View style={{ alignItems: 'center' }}>
          <Text
            style={[styles.pickerTitle, { color: '#' + driver.visorColor.toString(16).padStart(6, '0') }]}
          >
            {profile.name}
          </Text>
          <Text style={styles.pickerSub}>{profile.tagline}</Text>
        </View>
        <TouchableOpacity onPress={() => setProfileIndex((profileIndex + 1) % ROSTER.length)}>
          <Icon name="chevronRight" size={34} color="#9fb4ff" />
        </TouchableOpacity>
      </View>

      <View style={styles.pickerRow}>
        <TouchableOpacity
          accessibilityLabel="Véhicule précédent"
          onPress={() =>
            setSettings({ ...settings, vehicle: (settings.vehicle + VEHICLES.length - 1) % VEHICLES.length })
          }
        >
          <Icon name="chevronLeft" size={34} color="#9fb4ff" />
        </TouchableOpacity>
        <View style={{ alignItems: 'center', flex: 1 }}>
          <Text style={styles.pickerTitle}>{VEHICLES[settings.vehicle].name}</Text>
          <Text style={styles.pickerSub}>{VEHICLES[settings.vehicle].description}</Text>
        </View>
        <TouchableOpacity
          accessibilityLabel="Véhicule suivant"
          onPress={() => setSettings({ ...settings, vehicle: (settings.vehicle + 1) % VEHICLES.length })}
        >
          <Icon name="chevronRight" size={34} color="#9fb4ff" />
        </TouchableOpacity>
      </View>
      <View style={{ alignItems: 'center', gap: 8, width: '100%' }}>
        <Text style={{ color: '#ffd21f', fontWeight: '900', fontSize: 18 }}>🪙 {garage.coins} Turbo Coins</Text>
        {!owned ? (
          <TouchableOpacity accessibilityRole="button" style={[styles.toolButton, { borderColor: '#ffd21f' }]} onPress={() => onGarageChange((() => { const ng = { ...garage, owned: [...garage.owned] }; buyVehicle(ng, vehicle.id, vehicle.price ?? 0); return ng; })())}>
            <Text style={styles.toolText}>{(vehicle.price ?? 0) > 0 ? `Acheter — ${vehicle.price} TC` : 'Débloquer (gratuit)'}</Text>
          </TouchableOpacity>
        ) : (<Text style={{ color: '#4dffc8', fontWeight: '800' }}>✓ Véhicule possédé</Text>)}
        {owned && (<>
          <TouchableOpacity accessibilityRole="button" style={styles.toolButton} onPress={() => setUpKind(UPGRADE_KINDS[(UPGRADE_KINDS.indexOf(upKind) + 1) % UPGRADE_KINDS.length])}>
            <Text style={styles.toolText}>Amélioration : {UP_LABEL[upKind]} (niv. {upLevel}/5 · ×{upgradeMultiplier(garage, vehicle.id, upKind).toFixed(2)})</Text>
          </TouchableOpacity>
          <TouchableOpacity accessibilityRole="button" style={styles.toolButton} onPress={() => onGarageChange((() => { const ng = { ...garage, upgrades: { ...garage.upgrades } }; buyUpgrade(ng, vehicle.id, upKind); return ng; })())}>
            <Text style={styles.toolText}>Améliorer — {upLevel >= 5 ? 'MAX' : `${upgradeCost(upKind, upLevel)} TC`}</Text>
          </TouchableOpacity>
        </>)}
      </View>
      <TouchableOpacity
        style={styles.toolButton}
        onPress={() => {
          const levels = Object.keys(DIFFICULTIES) as Difficulty[];
          setSettings({
            ...settings,
            difficulty: levels[(levels.indexOf(settings.difficulty) + 1) % levels.length],
          });
        }}
      >
        <Text style={styles.toolText}>Difficulté : {DIFFICULTIES[settings.difficulty].name}</Text>
      </TouchableOpacity>
      <View style={{ width: Math.min(420, width * 0.8) }}>
        {statBar('Vitesse', profile.speed)}
        {statBar('Accélération', profile.accel)}
        {statBar('Adhérence', profile.grip)}
        {statBar('Maniabilité', profile.handling)}
      </View>

      <TouchableOpacity style={[styles.playButton, !owned && { opacity: 0.45 }]} onPress={owned ? onStart : undefined}>
        <Icon name="play" size={30} color="#0b1020" />
        <Text style={styles.playText}>{owned ? 'COURSE' : 'VERROUILLÉ'}</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.toolButton} onPress={() => setSettings({ ...settings, reducedMotion: !settings.reducedMotion })}>
        <Text style={styles.toolText}>Animations : {settings.reducedMotion ? 'réduites' : 'complètes'}</Text>
      </TouchableOpacity>
      {/* V4.1 — commandes : état réel, calibration, sensibilité, accélération */}
      <View style={styles.menuTools}>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityState={{ selected: settings.controls.steerMode === 'gyro' }}
          style={[styles.toolButton, settings.controls.steerMode === 'gyro' && styles.toolButtonActive]}
          onPress={() =>
            setControls({ steerMode: settings.controls.steerMode === 'gyro' ? 'buttons' : 'gyro' })
          }
        >
          <Icon name={settings.controls.steerMode === 'gyro' ? 'gyro' : 'touch'} size={20} color="#dbe4ff" />
          <Text style={styles.toolText}>{gyroLabel}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          accessibilityRole="button"
          style={[styles.toolButton, settings.controls.steerMode !== 'gyro' && { opacity: 0.45 }]}
          onPress={onCalibrateGyro}
        >
          <Icon name="refresh" size={18} color="#dbe4ff" />
          <Text style={styles.toolText}>RECALIBRER</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.toolButton}
          onPress={() => setControls({ sensitivity: nextSensitivity(settings.controls.sensitivity) })}
        >
          <Text style={styles.toolText}>{SENSITIVITY_LABEL[settings.controls.sensitivity]}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.toolButton}
          onPress={() => setControls({ throttleMode: nextThrottleMode(settings.controls.throttleMode) })}
        >
          <Text style={styles.toolText}>{THROTTLE_MODE_LABEL[settings.controls.throttleMode]}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.toolButton}
          onPress={() => setControls({ invertTilt: !settings.controls.invertTilt })}
        >
          <Text style={styles.toolText}>
            SENS DU GYRO : {settings.controls.invertTilt ? 'INVERSÉ' : 'NORMAL'}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.toolButton} onPress={() => setShowSettings(true)}>
          <Icon name="gear" size={20} color="#dbe4ff" />
          <Text style={styles.toolText}>Réglages</Text>
        </TouchableOpacity>
      </View>
      {!!controlMessage && (
        <Text accessibilityLiveRegion="polite" style={styles.controlMessage}>
          {controlMessage}
        </Text>
      )}
      <Text style={styles.versionBadge}>{versionBadge()}</Text>

      {showSettings && (
        <View style={styles.settingsPanel}>
          <Text style={styles.settingsTitle}>Qualité graphique</Text>
          {(['auto', 'low', 'high', 'ultra'] as const).map((q) => (
            <TouchableOpacity
              key={q}
              style={[styles.settingsRow, settings.quality === q && styles.settingsRowActive]}
              onPress={() => setSettings({ ...settings, quality: q })}
            >
              <Text style={styles.settingsLabel}>
                {q === 'auto'
                  ? 'Automatique (détection appareil)'
                  : q === 'low'
                    ? 'Basse'
                    : q === 'high'
                      ? 'Haute'
                      : 'Ultra'}
              </Text>
              {settings.quality === q && <Icon name="check" size={18} color="#4ade80" />}
            </TouchableOpacity>
          ))}
          <Text style={styles.settingsTitle}>Tours</Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {[1, 3, 5].map((l) => (
              <TouchableOpacity
                key={l}
                style={[styles.chip, settings.laps === l && styles.chipActive]}
                onPress={() => setSettings({ ...settings, laps: l })}
              >
                <Text style={styles.chipText}>{l}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <TouchableOpacity
            style={[styles.playButton, { marginTop: 18, height: 48 }]}
            onPress={() => setShowSettings(false)}
          >
            <Text style={[styles.playText, { fontSize: 16 }]}>FERMER</Text>
          </TouchableOpacity>
        </View>
      )}
    </ScrollView>
  );
};

/* ------------------------------------------------------------------ */
/* HUD tactile                                                        */
/* ------------------------------------------------------------------ */

const HoldButton: React.FC<{
  zoneId: TouchZoneId;
  pressed: boolean;
  parentOffset: { x: number; y: number };
  onZoneRect: (id: TouchZoneId, rect: TouchZoneRect | null) => void;
  accessibilityLabel: string;
  style: any;
  children: React.ReactNode;
}> = ({ zoneId, pressed, parentOffset, onZoneRect, accessibilityLabel, style, children }) => {
  const viewRef = useRef<View | null>(null);
  const localLayoutRef = useRef<{ x: number; y: number; width: number; height: number } | null>(null);
  const { width: winW, height: winH } = useWindowDimensions();

  const updateMeasuredRect = useCallback(() => {
    const local = localLayoutRef.current;
    if (local && local.width > 0 && local.height > 0) {
      onZoneRect(zoneId, {
        left: parentOffset.x + local.x,
        top: parentOffset.y + local.y,
        width: local.width,
        height: local.height,
      });
    }
    const node = viewRef.current as any;
    if (node && typeof node.measure === 'function') {
      node.measure((_x: number, _y: number, width: number, height: number, pageX: number, pageY: number) => {
        if (width > 0 && height > 0 && Number.isFinite(pageX) && Number.isFinite(pageY)) {
          onZoneRect(zoneId, { left: pageX, top: pageY, width, height });
        }
      });
    }
  }, [onZoneRect, parentOffset.x, parentOffset.y, zoneId]);

  useEffect(() => {
    updateMeasuredRect();
  }, [winW, winH, updateMeasuredRect]);

  useEffect(
    () => () => {
      onZoneRect(zoneId, null);
    },
    [onZoneRect, zoneId],
  );

  return (
    <View
      ref={viewRef}
      collapsable={false}
      accessible
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={[style, pressed && { opacity: 0.78 }]}
      onLayout={(e) => {
        localLayoutRef.current = e.nativeEvent.layout;
        updateMeasuredRect();
      }}
    >
      <View
        pointerEvents="none"
        style={{
          alignItems: 'center',
          justifyContent: 'center',
          gap: 4,
          transform: pressed ? [{ scale: 0.94 }] : undefined,
        }}
      >
        {children}
      </View>
    </View>
  );
};

/** V4.1 — cibles tactiles généreuses, jamais collées aux bords sûrs. */
const PAD_SIZE = 96;
const PAD_LEFT = 18;

const TouchHud: React.FC<{
  hud: any;
  pressed: HeldButtons;
  onZoneRect: (id: TouchZoneId, rect: TouchZoneRect | null) => void;
  onPause: () => void;
  /** Recentrage progressif du neutre (bouton affiché seulement en mode gyroscope). */
  onRecenter: () => void;
  /** Gyroscope réellement utilisable (données reçues), pas seulement demandé. */
  gyro: boolean;
  manualThrottle: boolean;
  bike: boolean;
  paused: boolean;
}> = ({ hud, pressed, onZoneRect, onPause, onRecenter, gyro, manualThrottle, bike, paused }) => {
  const turbo = hud.turbo ?? { ready: false, active: false, charge: 0, cooldown: 0, mastery: false, masteryCount: 0 };
  const turboLabel = turbo.active
    ? 'TURBO !'
    : turbo.ready
      ? `TURBO ${Math.round(turbo.charge * 100)}%`
      : turbo.cooldown > 0
        ? `RECHARGE ${turbo.cooldown.toFixed(1)}s`
        : 'TURBO';
  const tierColors = ['#8ea2c8', '#40c8ff', '#ff9a2e', '#c65cff'];
  const [topOffset, setTopOffset] = useState({ x: 16, y: 16 });
  const [controlsOffset, setControlsOffset] = useState({ x: 0, y: 0 });
  const pauseBtnRef = useRef<View | null>(null);
  const pauseLocalRef = useRef<{ x: number; y: number; width: number; height: number } | null>(null);
  const { width: winW, height: winH } = useWindowDimensions();

  const updatePauseRect = useCallback(() => {
    if (paused) {
      onZoneRect('pause', null);
      return;
    }
    const local = pauseLocalRef.current;
    if (local && local.width > 0 && local.height > 0) {
      onZoneRect('pause', {
        left: topOffset.x + local.x,
        top: topOffset.y + local.y,
        width: local.width,
        height: local.height,
      });
    }
    const node = pauseBtnRef.current as any;
    if (node && typeof node.measure === 'function') {
      node.measure((_x: number, _y: number, width: number, height: number, pageX: number, pageY: number) => {
        if (!paused && width > 0 && height > 0 && Number.isFinite(pageX) && Number.isFinite(pageY)) {
          onZoneRect('pause', { left: pageX, top: pageY, width, height });
        }
      });
    }
  }, [onZoneRect, paused, topOffset.x, topOffset.y]);

  useEffect(() => {
    updatePauseRect();
  }, [winW, winH, paused, updatePauseRect]);

  useEffect(
    () => () => {
      onZoneRect('pause', null);
    },
    [onZoneRect],
  );

  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      {/* chrono / tour / place — box-none pour laisser le bouton PAUSE cliquable */}
      <View
        style={styles.hudTop}
        pointerEvents="box-none"
        onLayout={(e) => {
          const { x, y } = e.nativeEvent.layout;
          setTopOffset((prev) => (prev.x === x && prev.y === y ? prev : { x, y }));
        }}
      >
        <View style={styles.hudCard} pointerEvents="none">
          <Text style={styles.hudLabel}>TOUR</Text>
          <Text style={styles.hudValue}>
            {hud.lap}/{hud.laps}
          </Text>
        </View>
        <View style={styles.hudCard} pointerEvents="none">
          <Text style={styles.hudLabel}>TEMPS</Text>
          <Text style={[styles.hudValue, { fontSize: 20 }]}>{formatTime(hud.time)}</Text>
        </View>
        <View style={styles.hudCard} pointerEvents="none">
          <Text style={styles.hudLabel}>PLACE</Text>
          <Text style={styles.hudValue}>
            {hud.place}
            <Text style={{ fontSize: 13, color: '#93a6cc' }}>/{hud.total}</Text>
          </Text>
        </View>
        <View style={[styles.gyroChip, { marginLeft: 'auto' }, gyro && styles.gyroChipOn]} pointerEvents="none">
          <View style={[styles.gyroDot, gyro && styles.gyroDotOn]} />
          <Text style={[styles.gyroChipText, gyro && { color: '#4dffc8' }]}>{gyro ? 'GYRO' : 'BOUTONS'}</Text>
        </View>
        {gyro && (
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Recentrer la direction gyroscopique"
            onPress={onRecenter}
            style={styles.recenterButton}
          >
            <Text style={styles.recenterText}>RECENTRER</Text>
          </TouchableOpacity>
        )}
        <View
          ref={pauseBtnRef}
          collapsable={false}
          onLayout={(e) => {
            pauseLocalRef.current = e.nativeEvent.layout;
            updatePauseRect();
          }}
        >
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Mettre en pause"
            style={styles.iconButton}
            onPress={onPause}
          >
            <Icon name="pause" size={18} color="#fff" />
            <Text style={styles.actionText}>PAUSE</Text>
          </TouchableOpacity>
        </View>
      </View>

      {!!hud.combatEvent && (<View pointerEvents="none" style={{ position: 'absolute', top: 84, alignSelf: 'center', backgroundColor: '#17202edd', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10 }}><Text style={{ color: '#ffe14d', fontWeight: '900' }}>{hud.combatEvent}</Text></View>)}
      <View pointerEvents="none" style={{ position: 'absolute', top: 84, left: 16, gap: 4 }}>
        <Text style={{ color: hud.shield ? '#4dffc8' : '#5f6f92', fontWeight: '800' }}>{hud.shield ? '🛡 Bouclier actif' : '🛡 —'}</Text>
        <Text style={{ color: '#ffd21f', fontWeight: '800' }}>🪙 {hud.coins ?? 0} · ❤ {Math.round(hud.health ?? 100)}</Text>
      </View>

      {/* compteur de vitesse */}
      <View style={styles.speedo} pointerEvents="none">
        <Text style={styles.speedValue}>{hud.speed}</Text>
        <Text style={styles.speedUnit}>km/h</Text>
        <View style={styles.driftMeter}>
          <View
            style={{
              width: `${Math.max(hud.tier > 0 ? 22 : 2, hud.charge * 100)}%`,
              height: '100%',
              backgroundColor: tierColors[hud.boosting ? 3 : hud.tier] ?? '#8ea2c8',
              borderRadius: 4,
            }}
          />
        </View>
        <Text
          style={[
            styles.turboChip,
            turbo.ready && !turbo.active && { color: '#40c8ff' },
            turbo.active && { color: '#e0a4ff' },
            turbo.mastery && { color: '#ffe14d' },
          ]}
        >
          {turbo.mastery
            ? `MAÎTRISE ×${turbo.masteryCount}`
            : turbo.active
              ? 'TURBO ACTIF'
              : turbo.ready
                ? `TURBO PRÊT ${Math.round(turbo.charge * 100)}%`
                : turbo.cooldown > 0
                  ? `RECHARGE ${turbo.cooldown.toFixed(1)}s`
                  : 'TURBO —'}
        </Text>
        {hud.best > 0 && <Text style={styles.bestLap}>Meilleur : {formatLap(hud.best)}</Text>}
      </View>

      {/* commandes : démontées pendant la pause pour invalider tout touch encore actif */}
      {!paused && (
        <View
          style={styles.controls}
          pointerEvents="box-none"
          onLayout={(e) => {
            const { x, y } = e.nativeEvent.layout;
            setControlsOffset((prev) => (prev.x === x && prev.y === y ? prev : { x, y }));
          }}
        >
          {!gyro && (
            <>
              <HoldButton
                zoneId="left"
                pressed={pressed.left}
                parentOffset={controlsOffset}
                onZoneRect={onZoneRect}
                accessibilityLabel="Gauche"
                style={[styles.padButton, { left: PAD_LEFT }]}
              >
                <Icon name="chevronLeft" size={40} color="#fff" />
              </HoldButton>
              <HoldButton
                zoneId="right"
                pressed={pressed.right}
                parentOffset={controlsOffset}
                onZoneRect={onZoneRect}
                accessibilityLabel="Droite"
                style={[styles.padButton, { left: PAD_LEFT + PAD_SIZE + 14 }]}
              >
                <Icon name="chevronRight" size={40} color="#fff" />
              </HoldButton>
            </>
          )}
          <View style={{ flex: 1 }} pointerEvents="none" />
          {manualThrottle && (
            <HoldButton
              zoneId="accel"
              pressed={pressed.accel}
              parentOffset={controlsOffset}
              onZoneRect={onZoneRect}
              accessibilityLabel="Accélérer"
              style={[styles.actionButton, styles.accelButton]}
            >
              <Text style={styles.actionText}>GAZ</Text>
            </HoldButton>
          )}
          <HoldButton
            zoneId="fire"
            pressed={pressed.fire}
            parentOffset={controlsOffset}
            onZoneRect={onZoneRect}
            accessibilityLabel="Tirer"
            style={[styles.actionButton, styles.fireButton, { opacity: hud.weapon ? 1 : 0.75 }]}
          >
            <Text style={{ fontSize: 20 }}>🎯</Text>
            <Text style={styles.actionText}>{hud.weapon ? 'TIR' : 'TIR —'}</Text>
          </HoldButton>
          <HoldButton
            zoneId="turbo"
            pressed={pressed.turbo}
            parentOffset={controlsOffset}
            onZoneRect={onZoneRect}
            accessibilityLabel="Turbo"
            style={[
              styles.actionButton,
              turbo.active
                ? styles.turboButtonActive
                : turbo.ready
                  ? styles.turboButtonReady
                  : styles.turboButtonIdle,
            ]}
          >
            <Icon name="bolt" size={24} color={turbo.ready || turbo.active ? '#fff' : '#8ea2c8'} />
            <Text style={[styles.actionText, !turbo.ready && !turbo.active && { color: '#8ea2c8' }]}>
              {turboLabel}
            </Text>
          </HoldButton>
          <HoldButton
            zoneId="brake"
            pressed={pressed.brake}
            parentOffset={controlsOffset}
            onZoneRect={onZoneRect}
            accessibilityLabel="Frein"
            style={[styles.actionButton, styles.brakeButton]}
          >
            <Icon name="shield" size={22} color="#fff" />
            <Text style={styles.actionText}>FREIN</Text>
          </HoldButton>
          <HoldButton
            zoneId="drift"
            pressed={pressed.drift}
            parentOffset={controlsOffset}
            onZoneRect={onZoneRect}
            accessibilityLabel={bike ? 'Glisse et turbo moto' : 'Dérapage'}
            style={[styles.actionButton, styles.driftButton]}
          >
            <Icon name="drift" size={24} color="#fff" />
            <Text style={styles.actionText}>{bike ? 'GLISSE / TURBO' : 'DÉRAPAGE'}</Text>
          </HoldButton>
        </View>
      )}

      {!paused && hud.countdown > 0 && (
        <View style={styles.countdownOverlay} pointerEvents="none">
          <CountdownPulse value={hud.countdown} />
        </View>
      )}
      {hud.boosting && <View style={styles.boostVignette} pointerEvents="none" />}
    </View>
  );
};

const PauseMenu: React.FC<{
  onResume: () => void;
  onRestart: () => void;
  onMenu: () => void;
  diagnostics: string;
  gyroLabel: string;
  onToggleGyro: () => void;
  onCalibrateGyro: () => void;
  throttleLabel: string;
  onToggleThrottle: () => void;
  controlMessage: string;
}> = ({
  onResume,
  onRestart,
  onMenu,
  diagnostics,
  gyroLabel,
  onToggleGyro,
  onCalibrateGyro,
  throttleLabel,
  onToggleThrottle,
  controlMessage,
}) => (
  <View style={styles.pauseOverlay} accessibilityViewIsModal>
    <Text style={styles.pauseTitle}>PAUSE</Text>
    <TouchableOpacity accessibilityRole="button" style={styles.pauseAction} onPress={onResume}>
      <Text style={styles.pauseActionText}>▶ REPRENDRE</Text>
    </TouchableOpacity>
    <TouchableOpacity accessibilityRole="button" style={styles.pauseAction} onPress={onRestart}>
      <Text style={styles.pauseActionText}>↻ RECOMMENCER LA COURSE</Text>
    </TouchableOpacity>
    <TouchableOpacity
      accessibilityRole="button"
      style={[styles.pauseAction, styles.pauseMenuAction]}
      onPress={onMenu}
    >
      <Text style={styles.pauseActionText}>MENU PRINCIPAL</Text>
    </TouchableOpacity>
    {/* V4.1 — commandes accessibles en course : état réel, recalibrage, accélération */}
    <View style={styles.pauseControls}>
      <TouchableOpacity accessibilityRole="button" style={styles.chip} onPress={onToggleGyro}>
        <Text style={styles.chipText}>{gyroLabel}</Text>
      </TouchableOpacity>
      <TouchableOpacity accessibilityRole="button" style={styles.chip} onPress={onCalibrateGyro}>
        <Text style={styles.chipText}>RECALIBRER</Text>
      </TouchableOpacity>
      <TouchableOpacity accessibilityRole="button" style={styles.chip} onPress={onToggleThrottle}>
        <Text style={styles.chipText}>{throttleLabel}</Text>
      </TouchableOpacity>
    </View>
    {!!controlMessage && <Text style={styles.controlMessage}>{controlMessage}</Text>}
    <Text style={styles.versionBadge}>{diagnostics}</Text>
  </View>
);

const CountdownPulse: React.FC<{ value: number }> = ({ value }) => {
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    anim.setValue(0);
    Animated.timing(anim, {
      toValue: 1,
      duration: 700,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [value, anim]);
  const scale = anim.interpolate({ inputRange: [0, 1], outputRange: [1.6, 0.85] });
  const opacity = anim.interpolate({ inputRange: [0, 0.25, 1], outputRange: [0, 1, 0.55] });
  return (
    <Animated.Text style={[styles.countdownText, { transform: [{ scale }], opacity }]}>{value}</Animated.Text>
  );
};

/* ------------------------------------------------------------------ */
/* Écran de résultats                                                 */
/* ------------------------------------------------------------------ */

const ResultsScreen: React.FC<{
  result: { place: number; time: number; laps: number[] };
  circuitName: string;
  profile: KartProfile;
  coinsEarned?: number;
  balance?: number;
  onRestart: () => void;
  onQuit: () => void;
}> = ({ result, circuitName, profile, coinsEarned, balance, onRestart, onQuit }) => (
  <ScrollView style={{flex:1, backgroundColor:'#070a16'}} contentContainerStyle={[styles.menu, { paddingBottom: 96, minHeight: '100%' }]}>
    <Text style={styles.resultsTitle}>{result.place === 1 ? 'VICTOIRE !' : `${result.place}e PLACE`}</Text>
    <Text style={styles.pickerSub}>
      {circuitName} · {profile.name}
    </Text>
    {!!coinsEarned && (<Text style={{ color: '#ffd21f', fontWeight: '900', fontSize: 18 }}>🪙 +{coinsEarned} Turbo Coins · Solde : {balance}</Text>)}
    <View style={styles.resultsCard}>
      <View style={styles.resultsRow}>
        <Text style={styles.hudLabel}>TEMPS TOTAL</Text>
        <Text style={styles.resultsValue}>{formatTime(result.time)}</Text>
      </View>
      {result.laps.map((l, i) => (
        <View style={styles.resultsRow} key={i}>
          <Text style={styles.hudLabel}>TOUR {i + 1}</Text>
          <Text style={styles.resultsValue}>{formatLap(l)}</Text>
        </View>
      ))}
    </View>
    <View style={{ flexDirection: 'row', gap: 12, marginTop: 24 }}>
      <TouchableOpacity style={styles.playButton} onPress={onRestart}>
        <Icon name="refresh" size={24} color="#0b1020" />
        <Text style={styles.playText}>REJOUER</Text>
      </TouchableOpacity>
      <TouchableOpacity style={[styles.toolButton, { paddingHorizontal: 24 }]} onPress={onQuit}>
        <Text style={styles.toolText}>Menu</Text>
      </TouchableOpacity>
    </View>
  </ScrollView>
);

/* ------------------------------------------------------------------ */
/* Styles                                                             */
/* ------------------------------------------------------------------ */

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#070a16' },
  menu: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#070a16',
    padding: 24,
    gap: 14,
  },
  menuGlow: {
    position: 'absolute',
    top: -120,
    width: 520,
    height: 520,
    borderRadius: 260,
    backgroundColor: '#2b3bff',
    opacity: 0.18,
  },
  logo: { fontSize: 46, fontWeight: '900', color: '#fff', letterSpacing: 2 },
  logoAccent: { color: '#ff3d6e' },
  logoSub: { fontSize: 16, letterSpacing: 12, color: '#7f93c8', marginTop: -8, marginBottom: 12 },
  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    maxWidth: 460,
  },
  pickerTitle: { fontSize: 22, fontWeight: '800', color: '#fff' },
  pickerSub: { fontSize: 13, color: '#8ea2c8', marginTop: 2 },
  statRow: { flexDirection: 'row', alignItems: 'center', marginTop: 8 },
  statLabel: { color: '#a7b8dd', width: 110, fontSize: 12, letterSpacing: 1 },
  statTrack: { flex: 1, height: 8, borderRadius: 4, backgroundColor: '#182140', overflow: 'hidden' },
  statFill: { height: '100%', backgroundColor: '#40c8ff', borderRadius: 4 },
  playButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#ffe14d',
    paddingHorizontal: 34,
    height: 62,
    borderRadius: 31,
    marginTop: 8,
  },
  playText: { color: '#0b1020', fontWeight: '900', fontSize: 22, letterSpacing: 2 },
  menuTools: { flexDirection: 'row', gap: 12, marginTop: 6 },
  toolButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 14,
    backgroundColor: '#121a33',
  },
  toolText: { color: '#dbe4ff', fontWeight: '700', fontSize: 13 },
  settingsPanel: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    top: 0,
    backgroundColor: '#070a16f2',
    padding: 30,
    justifyContent: 'center',
    gap: 10,
  },
  settingsTitle: { color: '#8ea2c8', fontSize: 12, letterSpacing: 2, marginTop: 12 },
  settingsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 14,
    borderRadius: 12,
    backgroundColor: '#121a33',
  },
  settingsRowActive: { backgroundColor: '#1d2a52', borderWidth: 1, borderColor: '#40c8ff' },
  settingsLabel: { color: '#e6ecff', fontSize: 15 },
  chip: { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10, backgroundColor: '#121a33' },
  chipActive: { backgroundColor: '#40c8ff' },
  chipText: { color: '#fff', fontWeight: '800' },
  /* HUD */
  hudTop: { position: 'absolute', top: 16, left: 16, right: 16, flexDirection: 'row', gap: 8 },
  hudCard: { backgroundColor: '#0a1122cc', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 12 },
  hudLabel: { color: '#7f93c8', fontSize: 10, letterSpacing: 2 },
  hudValue: { color: '#fff', fontWeight: '900', fontSize: 24 },
  iconButton: {
    marginLeft: 'auto',
    minWidth: 58,
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#0a1122e8',
    paddingHorizontal: 12,
    borderRadius: 12,
  },
  speedo: { position: 'absolute', right: 20, bottom: 132, alignItems: 'flex-end' },
  speedValue: { color: '#fff', fontWeight: '900', fontSize: 52, lineHeight: 54 },
  speedUnit: { color: '#8ea2c8', fontSize: 14, letterSpacing: 3, marginTop: -6 },
  driftMeter: {
    width: 132,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#0a1122cc',
    marginTop: 8,
    overflow: 'hidden',
  },
  bestLap: { color: '#8ea2c8', fontSize: 12, marginTop: 6 },
  controls: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 22,
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 18,
    gap: 10,
  },
  padButton: {
    position: 'absolute',
    bottom: 0,
    width: PAD_SIZE,
    height: PAD_SIZE,
    borderRadius: 28,
    backgroundColor: '#121a33cc',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#2b3b5e',
  },
  actionButton: {
    width: 88,
    height: 88,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    borderWidth: 1,
    borderColor: '#ffffff22',
  },
  driftButton: { backgroundColor: '#2b6bffdd' },
  brakeButton: { backgroundColor: '#ff3d6eda' },
  fireButton: { width: 64, height: 64, backgroundColor: '#ff9a2ee0' },
  accelButton: { width: 88, height: 58, borderRadius: 16, backgroundColor: '#2ed688aa' },
  turboButtonIdle: { backgroundColor: '#182036dd', borderColor: '#96a6d855' },
  turboButtonReady: { backgroundColor: '#40c8ff4d', borderColor: '#40c8ff', borderWidth: 2 },
  turboButtonActive: { backgroundColor: '#c65cff88', borderColor: '#e6b0ff', borderWidth: 2 },
  turboChip: { color: '#6e82b0', fontSize: 10, fontWeight: '900', letterSpacing: 1.4, marginTop: 4 },
  gyroChip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 8 },
  gyroChipOn: {},
  gyroDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#5f6f92' },
  gyroDotOn: { backgroundColor: '#4dffc8' },
  gyroChipText: { color: '#5f6f92', fontSize: 9, fontWeight: '900', letterSpacing: 1.2 },
  controlMessage: { color: '#80ffce', fontSize: 12, textAlign: 'center', paddingHorizontal: 24 },
  toolButtonActive: { borderWidth: 1, borderColor: '#40c8ff', backgroundColor: '#16244a' },
  actionText: { color: '#fff', fontWeight: '800', fontSize: 10, letterSpacing: 1 },
  pauseOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 30,
    elevation: 30,
    backgroundColor: '#070a16ee',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
    gap: 12,
  },
  pauseTitle: { color: '#fff', fontWeight: '900', fontSize: 34, letterSpacing: 4, marginBottom: 6 },
  pauseAction: {
    minHeight: 54,
    minWidth: 250,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 22,
    borderRadius: 14,
    backgroundColor: '#16244a',
    borderWidth: 1,
    borderColor: '#344a7a',
  },
  pauseMenuAction: { backgroundColor: '#121a33' },
  pauseControls: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center', marginTop: 8 },
  recenterButton: {
    height: 44,
    minWidth: 104,
    paddingHorizontal: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#4dffc866',
    backgroundColor: '#0a1a22cc',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  recenterText: { color: '#bff7e8', fontSize: 11, fontWeight: '900', letterSpacing: 1.2 },
  versionBadge: { color: '#46577e', fontSize: 10, letterSpacing: 1.6, fontWeight: '700', marginTop: 4 },
  pauseActionText: { color: '#eaf0ff', fontSize: 15, fontWeight: '900', letterSpacing: 1 },
  countdownOverlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  countdownText: { color: '#fff', fontSize: 140, fontWeight: '900' },
  boostVignette: {
    ...StyleSheet.absoluteFillObject,
    borderWidth: 26,
    borderColor: '#8b5cf622',
    borderRadius: 40,
  },
  resultsTitle: { color: '#ffe14d', fontSize: 40, fontWeight: '900', letterSpacing: 2 },
  resultsCard: {
    backgroundColor: '#121a33',
    borderRadius: 18,
    padding: 20,
    width: '100%',
    maxWidth: 420,
    gap: 10,
  },
  resultsRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  resultsValue: { color: '#fff', fontWeight: '800', fontSize: 18 },
});
