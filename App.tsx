/**
 * Turbo Karts Arena — couche React Native (Expo).
 *
 * Le rendu 3D tourne dans une `GLView` (expo-gl) pilotée par le MOTEUR PARTAGÉ
 * (`src/render/world.ts`), exactement le même code que la preview web.
 * Le HUD est en React Native pur (aucun WebView) : 60 FPS garantis.
 *
 * Entrées :
 *  - Boutons tactiles (accélération automatique, boutons gauche/droite + dérapage)
 *  - Gyroscope (expo-sensors) calibré sur l'angle de repos
 *  - Manette Bluetooth (mappage clavier/gamepad via la preview web)
 */

import { StatusBar } from 'expo-status-bar';
import { Gyroscope } from 'expo-sensors';
import { GLView } from 'expo-gl';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Platform,
  SafeAreaView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';

import { PhysicsEngine } from './src/render/world';
import { CIRCUITS, type Circuit } from './src/game/circuits';
import { ROSTER, type KartProfile } from './src/game/roster';
import { autoQuality, QUALITY, type QualityLevel } from './src/core/config';
import { formatLap, formatTime } from './src/core/race';
import Icon from './src/ui/icons';

type Screen = 'menu' | 'race' | 'results';

interface Settings {
  quality: QualityLevel | 'auto';
  gyro: boolean;
  sound: boolean;
  laps: number;
}

const DEFAULT_SETTINGS: Settings = { quality: 'auto', gyro: false, sound: true, laps: 3 };

export default function App() {
  const [screen, setScreen] = useState<Screen>('menu');
  const [circuitIndex, setCircuitIndex] = useState(0);
  const [profileIndex, setProfileIndex] = useState(0);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [hud, setHud] = useState({
    speed: 0,
    tier: 0,
    charge: 0,
    boosting: false,
    lap: 1,
    laps: 3,
    place: 1,
    total: 6,
    time: 0,
    countdown: 0,
    best: 0,
    results: null as null | { place: number; time: number; laps: number[] },
  });

  const engineRef = useRef<PhysicsEngine | null>(null);
  const inputRef = useRef({ steer: 0, drift: false, brake: false });
  const gyroRef = useRef({ angle: 0, rest: 0, enabled: false });
  const hudTimer = useRef<any>(null);

  /* ---------------- gyroscope ---------------- */
  useEffect(() => {
    if (!settings.gyro) {
      gyroRef.current.enabled = false;
      return;
    }
    let sub: { remove: () => void } | null = null;
    Gyroscope.setUpdateInterval(16);
    sub = Gyroscope.addListener(({ y, z }) => {
      // Lacet ≈ intégration de la vitesse angulaire : on utilise la projection
      // (y = tangage, z = roulis) pour un pilotage "inclinaison du téléphone".
      const angle = Math.atan2(z, 9.81);
      const g = gyroRef.current;
      if (!g.enabled) {
        g.rest = angle;
        g.enabled = true;
      }
      g.angle = angle;
      void y;
    });
    return () => sub?.remove();
  }, [settings.gyro]);

  /* ---------------- boucle de HUD ---------------- */
  const startHudLoop = useCallback(() => {
    if (hudTimer.current) clearInterval(hudTimer.current);
    hudTimer.current = setInterval(() => {
      const e = engineRef.current;
      if (!e) return;
      const race = e.race;
      const p = race.player;
      setHud({
        speed: Math.round(p.kmh),
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
        results:
          race.phase === 'finished'
            ? { place: p.state.place, time: p.state.finishTime, laps: p.state.lapTimes }
            : null,
      });
      if (race.phase === 'finished') {
        clearInterval(hudTimer.current);
        hudTimer.current = null;
        setTimeout(() => setScreen('results'), 1600);
      }
    }, 66);
  }, [settings.laps]);

  useEffect(() => () => hudTimer.current && clearInterval(hudTimer.current), []);

  /* ---------------- démarrage / GLView ---------------- */
  const circuit: Circuit = CIRCUITS[circuitIndex];
  const profile: KartProfile = ROSTER[profileIndex];

  const onContextCreate = useCallback(
    async (gl: any) => {
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
      const engine = new PhysicsEngine({
        gl,
        canvas: null,
        width: dims.width,
        height: dims.height,
        pixelRatio: 1, // expo-gl rend déjà à la résolution du framebuffer natif
        quality: QUALITY[level],
        circuit,
        profile,
        laps: settings.laps,
        onFrame: () => undefined,
      });
      engine.onFinish = () => startHudLoop();
      engineRef.current = engine;
      startHudLoop();

      // boucle de rendu pilotée par requestAnimationFrame (expo-gl l'expose)
      const loop = (t: number) => {
        const i = inputRef.current;
        const g = gyroRef.current;
        let steer = i.steer;
        if (settings.gyro && g.enabled) {
          const delta = g.angle - g.rest;
          steer = Math.max(-1, Math.min(1, delta * 3.2));
        }
        engine.setInput({ steer, drift: i.drift, brake: i.brake, throttle: 1 });
        engine.frame(t);
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    },
    [circuit, profile, settings, startHudLoop],
  );

  const startRace = () => {
    setScreen('race');
  };

  const quitRace = () => {
    engineRef.current?.dispose();
    engineRef.current = null;
    setScreen('menu');
  };

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
          onStart={startRace}
        />
      )}

      {screen === 'race' && (
        <View style={StyleSheet.absoluteFill}>
          <GLView style={StyleSheet.absoluteFill} onContextCreate={onContextCreate} />
          <TouchHud
            hud={hud}
            onSteer={(v) => (inputRef.current.steer = v)}
            onDrift={(v) => (inputRef.current.drift = v)}
            onBrake={(v) => (inputRef.current.brake = v)}
            onQuit={quitRace}
            gyro={settings.gyro}
          />
        </View>
      )}

      {screen === 'results' && hud.results && (
        <ResultsScreen
          result={hud.results}
          circuitName={circuit.name}
          profile={profile}
          onRestart={() => {
            engineRef.current?.restart();
            setScreen('race');
            startHudLoop();
          }}
          onQuit={quitRace}
        />
      )}
    </SafeAreaView>
  );
}

/* ------------------------------------------------------------------ */
/* Écran de menu                                                      */
/* ------------------------------------------------------------------ */

const MenuScreen: React.FC<{
  circuitIndex: number;
  setCircuitIndex: (n: number) => void;
  profileIndex: number;
  setProfileIndex: (n: number) => void;
  settings: Settings;
  setSettings: (s: Settings) => void;
  onStart: () => void;
}> = ({ circuitIndex, setCircuitIndex, profileIndex, setProfileIndex, settings, setSettings, onStart }) => {
  const circuit = CIRCUITS[circuitIndex];
  const profile = ROSTER[profileIndex];
  const { width } = useWindowDimensions();
  const [showSettings, setShowSettings] = useState(false);

  const statBar = (label: string, value: number) => (
    <View style={styles.statRow} key={label}>
      <Text style={styles.statLabel}>{label}</Text>
      <View style={styles.statTrack}>
        <View style={[styles.statFill, { width: `${Math.min(100, (value / 1.15) * 100)}%` }]} />
      </View>
    </View>
  );

  return (
    <View style={styles.menu}>
      <View style={styles.menuGlow} />
      <Text style={styles.logo}>
        TURBO<Text style={styles.logoAccent}> KARTS</Text>
      </Text>
      <Text style={styles.logoSub}>A R E N A</Text>

      <View style={styles.pickerRow}>
        <TouchableOpacity onPress={() => setCircuitIndex((circuitIndex + CIRCUITS.length - 1) % CIRCUITS.length)}>
          <Icon name="chevronLeft" size={34} color="#9fb4ff" />
        </TouchableOpacity>
        <View style={{ alignItems: 'center' }}>
          <Text style={styles.pickerTitle}>{circuit.name}</Text>
          <Text style={styles.pickerSub}>{circuit.subtitle}</Text>
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
          <Text style={styles.pickerTitle}>{profile.name}</Text>
          <Text style={styles.pickerSub}>{profile.tagline}</Text>
        </View>
        <TouchableOpacity onPress={() => setProfileIndex((profileIndex + 1) % ROSTER.length)}>
          <Icon name="chevronRight" size={34} color="#9fb4ff" />
        </TouchableOpacity>
      </View>

      <View style={{ width: Math.min(420, width * 0.8) }}>
        {statBar('Vitesse', profile.speed)}
        {statBar('Accélération', profile.accel)}
        {statBar('Adhérence', profile.grip)}
        {statBar('Maniabilité', profile.handling)}
      </View>

      <TouchableOpacity style={styles.playButton} onPress={onStart}>
        <Icon name="play" size={30} color="#0b1020" />
        <Text style={styles.playText}>COURSE</Text>
      </TouchableOpacity>

      <View style={styles.menuTools}>
        <TouchableOpacity style={styles.toolButton} onPress={() => setSettings({ ...settings, gyro: !settings.gyro })}>
          <Icon name={settings.gyro ? 'gyro' : 'touch'} size={20} color="#dbe4ff" />
          <Text style={styles.toolText}>{settings.gyro ? 'Gyroscope' : 'Boutons'}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.toolButton} onPress={() => setShowSettings(true)}>
          <Icon name="gear" size={20} color="#dbe4ff" />
          <Text style={styles.toolText}>Réglages</Text>
        </TouchableOpacity>
      </View>

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
                {q === 'auto' ? 'Automatique (détection appareil)' : q === 'low' ? 'Basse' : q === 'high' ? 'Haute' : 'Ultra'}
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
          <TouchableOpacity style={[styles.playButton, { marginTop: 18, height: 48 }]} onPress={() => setShowSettings(false)}>
            <Text style={[styles.playText, { fontSize: 16 }]}>FERMER</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
};

/* ------------------------------------------------------------------ */
/* HUD tactile                                                        */
/* ------------------------------------------------------------------ */

const TouchHud: React.FC<{
  hud: any;
  onSteer: (v: number) => void;
  onDrift: (v: boolean) => void;
  onBrake: (v: boolean) => void;
  onQuit: () => void;
  gyro: boolean;
}> = ({ hud, onSteer, onDrift, onBrake, onQuit, gyro }) => {
  const tierColors = ['#8ea2c8', '#40c8ff', '#ff9a2e', '#c65cff'];
  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      {/* chrono / tour / place */}
      <View style={styles.hudTop} pointerEvents="none">
        <View style={styles.hudCard}>
          <Text style={styles.hudLabel}>TOUR</Text>
          <Text style={styles.hudValue}>
            {hud.lap}/{hud.laps}
          </Text>
        </View>
        <View style={styles.hudCard}>
          <Text style={styles.hudLabel}>TEMPS</Text>
          <Text style={[styles.hudValue, { fontSize: 20 }]}>{formatTime(hud.time)}</Text>
        </View>
        <View style={styles.hudCard}>
          <Text style={styles.hudLabel}>PLACE</Text>
          <Text style={styles.hudValue}>
            {hud.place}
            <Text style={{ fontSize: 13, color: '#93a6cc' }}>/{hud.total}</Text>
          </Text>
        </View>
        <TouchableOpacity style={styles.iconButton} onPress={onQuit}>
          <Icon name="pause" size={18} color="#fff" />
        </TouchableOpacity>
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
        {hud.best > 0 && <Text style={styles.bestLap}>Meilleur : {formatLap(hud.best)}</Text>}
      </View>

      {/* commandes */}
      <View style={styles.controls} pointerEvents="box-none">
        {!gyro && (
          <>
            <TouchableOpacity
              style={[styles.padButton, { left: 18 }]}
              onPressIn={() => onSteer(-1)}
              onPressOut={() => onSteer(0)}
            >
              <Icon name="chevronLeft" size={38} color="#fff" />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.padButton, { left: 126 }]}
              onPressIn={() => onSteer(1)}
              onPressOut={() => onSteer(0)}
            >
              <Icon name="chevronRight" size={38} color="#fff" />
            </TouchableOpacity>
          </>
        )}
        <View style={{ flex: 1 }} />
        <TouchableOpacity
          style={[styles.actionButton, { backgroundColor: '#ff3d6ecc' }]}
          onPressIn={() => onBrake(true)}
          onPressOut={() => onBrake(false)}
        >
          <Icon name="shield" size={22} color="#fff" />
          <Text style={styles.actionText}>FREIN</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.actionButton, styles.driftButton]}
          onPressIn={() => onDrift(true)}
          onPressOut={() => onDrift(false)}
        >
          <Icon name="drift" size={24} color="#fff" />
          <Text style={styles.actionText}>DÉRAPAGE</Text>
        </TouchableOpacity>
      </View>

      {hud.countdown > 0 && (
        <View style={styles.countdownOverlay} pointerEvents="none">
          <CountdownPulse value={hud.countdown} />
        </View>
      )}
      {hud.boosting && (
        <View style={styles.boostVignette} pointerEvents="none" />
      )}
    </View>
  );
};

const CountdownPulse: React.FC<{ value: number }> = ({ value }) => {
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    anim.setValue(0);
    Animated.timing(anim, { toValue: 1, duration: 700, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
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
  onRestart: () => void;
  onQuit: () => void;
}> = ({ result, circuitName, profile, onRestart, onQuit }) => (
  <View style={styles.menu}>
    <Text style={styles.resultsTitle}>{result.place === 1 ? 'VICTOIRE !' : `${result.place}e PLACE`}</Text>
    <Text style={styles.pickerSub}>
      {circuitName} · {profile.name}
    </Text>
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
  </View>
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
  pickerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', width: '100%', maxWidth: 460 },
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
  iconButton: { marginLeft: 'auto', backgroundColor: '#0a1122cc', padding: 10, borderRadius: 12 },
  speedo: { position: 'absolute', right: 24, bottom: 150, alignItems: 'flex-end' },
  speedValue: { color: '#fff', fontWeight: '900', fontSize: 62, lineHeight: 64 },
  speedUnit: { color: '#8ea2c8', fontSize: 14, letterSpacing: 3, marginTop: -6 },
  driftMeter: { width: 150, height: 10, borderRadius: 5, backgroundColor: '#0a1122cc', marginTop: 8, overflow: 'hidden' },
  bestLap: { color: '#8ea2c8', fontSize: 12, marginTop: 6 },
  controls: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 24,
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 18,
    gap: 10,
  },
  padButton: {
    position: 'absolute',
    bottom: 0,
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: '#121a33cc',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#2b3b5e',
  },
  actionButton: {
    width: 104,
    height: 104,
    borderRadius: 52,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  driftButton: { backgroundColor: '#2b6bffcc' },
  actionText: { color: '#fff', fontWeight: '800', fontSize: 11, letterSpacing: 1 },
  countdownOverlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  countdownText: { color: '#fff', fontSize: 140, fontWeight: '900' },
  boostVignette: {
    ...StyleSheet.absoluteFillObject,
    borderWidth: 26,
    borderColor: '#8b5cf622',
    borderRadius: 40,
  },
  resultsTitle: { color: '#ffe14d', fontSize: 40, fontWeight: '900', letterSpacing: 2 },
  resultsCard: { backgroundColor: '#121a33', borderRadius: 18, padding: 20, width: '100%', maxWidth: 420, gap: 10 },
  resultsRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  resultsValue: { color: '#fff', fontWeight: '800', fontSize: 18 },
});
