/**
 * Turbo Karts Arena — réglages de commande persistés (V4.1).
 *
 * Module pur : aucune dépendance React Native ni DOM, donc testable sous Node et
 * identique dans les deux hôtes (Expo / preview web). Le stockage est injecté
 * (`localStorage` sur le web, `AsyncStorage` côté natif).
 *
 * Sauvegardé :
 *  - mode de commande (boutons ou gyroscope) ;
 *  - sensibilité du gyroscope (doux / normal / sport) ;
 *  - calibration (position neutre retenue, en degrés) ;
 *  - accélération automatique ou manuelle ;
 *  - sens du gyroscope (filet de sécurité si l'appareil inverse l'axe).
 *
 * Les Turbo Coins et le garage vivent dans `economy.ts` et ne sont pas touchés ici.
 */

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export type SteerMode = 'buttons' | 'gyro';
export type ThrottleMode = 'auto' | 'manual';
export type GyroSensitivity = 'soft' | 'normal' | 'sport';

export interface ControlSettings {
  steerMode: SteerMode;
  throttleMode: ThrottleMode;
  sensitivity: GyroSensitivity;
  /** Position neutre du téléphone, en degrés (axe « volant »). */
  calibration: number;
  /** Inverse le sens de direction du gyroscope. */
  invertTilt: boolean;
}

export const CONTROL_SETTINGS_KEY = 'turbokarts.v4.1.controls.v1';

export const DEFAULT_CONTROL_SETTINGS: ControlSettings = {
  steerMode: 'buttons',
  throttleMode: 'auto',
  sensitivity: 'normal',
  calibration: 0,
  invertTilt: false,
};

/** Bornes de sécurité : une calibration aberrante ne doit pas rendre le jeu injouable. */
export const CALIBRATION_LIMIT = 35;

export const THROTTLE_MODE_LABEL: Record<ThrottleMode, string> = {
  auto: 'ACCÉLÉRATION : AUTOMATIQUE',
  manual: 'ACCÉLÉRATION : MANUELLE',
};

export const STEER_MODE_LABEL: Record<SteerMode, string> = {
  buttons: 'GYROSCOPE : DÉSACTIVÉ',
  gyro: 'GYROSCOPE : ACTIVÉ',
};

export const SENSITIVITY_LABEL: Record<GyroSensitivity, string> = {
  soft: 'SENSIBILITÉ : DOUCE',
  normal: 'SENSIBILITÉ : NORMALE',
  sport: 'SENSIBILITÉ : SPORT',
};

const SENSITIVITIES: GyroSensitivity[] = ['soft', 'normal', 'sport'];
const THROTTLES: ThrottleMode[] = ['auto', 'manual'];
const STEERS: SteerMode[] = ['buttons', 'gyro'];

const clampCalibration = (value: unknown): number => {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(-CALIBRATION_LIMIT, Math.min(CALIBRATION_LIMIT, n));
};

const pick = <T extends string>(list: readonly T[], value: unknown, fallback: T): T =>
  typeof value === 'string' && (list as readonly string[]).includes(value) ? (value as T) : fallback;

/** Tolérant : un stockage corrompu retombe sur les valeurs par défaut, jamais sur une exception. */
export function sanitizeControlSettings(raw: unknown): ControlSettings {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_CONTROL_SETTINGS };
  const r = raw as Record<string, unknown>;
  return {
    steerMode: pick(STEERS, r.steerMode, DEFAULT_CONTROL_SETTINGS.steerMode),
    throttleMode: pick(THROTTLES, r.throttleMode, DEFAULT_CONTROL_SETTINGS.throttleMode),
    sensitivity: pick(SENSITIVITIES, r.sensitivity, DEFAULT_CONTROL_SETTINGS.sensitivity),
    calibration: clampCalibration(r.calibration),
    invertTilt: r.invertTilt === true,
  };
}

/**
 * Lecture avec migration douce de l'ancien réglage booléen `gyro`
 * (l'app native mémorisait seulement `gyro: boolean`).
 */
export function loadControlSettings(
  storage: Pick<StorageLike, 'getItem'> | null | undefined,
  legacyGyro?: boolean,
): ControlSettings {
  let parsed: unknown = null;
  try {
    const raw = storage?.getItem(CONTROL_SETTINGS_KEY);
    if (raw) parsed = JSON.parse(raw);
  } catch {
    parsed = null;
  }
  const settings = sanitizeControlSettings(parsed);
  if (!parsed && typeof legacyGyro === 'boolean') {
    settings.steerMode = legacyGyro ? 'gyro' : 'buttons';
  }
  return settings;
}

export function saveControlSettings(storage: Pick<StorageLike, 'setItem'> | null | undefined, settings: ControlSettings): void {
  try {
    storage?.setItem(CONTROL_SETTINGS_KEY, JSON.stringify(sanitizeControlSettings(settings)));
  } catch {
    /* stockage plein ou indisponible : la partie continue avec les réglages en mémoire */
  }
}

/** Cycle d'appui court : boutons → gyroscope → boutons. */
export function nextSteerMode(current: SteerMode): SteerMode {
  return current === 'buttons' ? 'gyro' : 'buttons';
}

export function nextSensitivity(current: GyroSensitivity): GyroSensitivity {
  return SENSITIVITIES[(SENSITIVITIES.indexOf(current) + 1) % SENSITIVITIES.length];
}

export function nextThrottleMode(current: ThrottleMode): ThrottleMode {
  return THROTTLES[(THROTTLES.indexOf(current) + 1) % THROTTLES.length];
}
