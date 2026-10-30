/**
 * Turbo Karts Arena — identification centralisée de la version (V4.1).
 *
 * Un seul endroit décide de ce qui est affiché : le menu, le HUD de pause, les
 * diagnostics techniques et les tests lisent tous ce module. Aucun numéro de
 * version ne doit être écrit « en dur » ailleurs dans le jeu.
 *
 * Le build est dérivé du commit Git qui a produit le bundle :
 *  - web (esbuild, `tools/build-preview.mjs`) : `define: { __TKA_GIT_COMMIT__ }` ;
 *  - application Expo/Metro : variable `EXPO_PUBLIC_TKA_BUILD` lue au bundling ;
 *  - à défaut (dépôt sans `.git`, archive, binaire sans métadonnée) : l'identifiant
 *    de secours EXPLICITE `sans-git` est affiché — jamais un faux hash.
 *
 * Version fonctionnelle de cette mission : **V4.1.0-dev**.
 * Tant que la branche n'est pas fusionnée et validée, le canal reste `dev` :
 * l'affichage ne doit jamais prétendre à une version publique stable.
 */

/* Injecté au build par esbuild ; absent sous Metro/Node (guard `typeof`). */
declare const __TKA_GIT_COMMIT__: string | undefined;

export interface VersionNumber {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
}

/** Numéro fonctionnel de la mission en cours. */
export const APP_VERSION: VersionNumber = { major: 4, minor: 1, patch: 0 };

/**
 * `dev` tant que la version n'est pas fusionnée puis validée sur appareil.
 * Passer à `stable` uniquement après fusion + validation (mission suivante).
 */
export type VersionChannel = 'dev' | 'stable';
export const VERSION_CHANNEL: VersionChannel = 'dev';

/** Identifiant de secours quand aucun commit n'est disponible. */
export const BUILD_FALLBACK_ID = 'sans-git';
/** Longueur du hash court affiché (identique à `git rev-parse --short`). */
export const BUILD_ID_LENGTH = 7;

/** « 4.1.0 » — sans canal : ne jamais afficher seul sur un build de dev. */
export const APP_VERSION_STRING = `${APP_VERSION.major}.${APP_VERSION.minor}.${APP_VERSION.patch}`;

/** « 4.1.0-dev » ou « 4.1.0 » selon le canal. */
export function formatVersion(version: VersionNumber = APP_VERSION, channel: VersionChannel = VERSION_CHANNEL): string {
  const base = `${version.major}.${version.minor}.${version.patch}`;
  return channel === 'dev' ? `${base}-dev` : base;
}

/** Étiquette affichée dans le menu : « V4.1.0-dev ». */
export const VERSION_LABEL = `V${formatVersion()}`;

/** `true` pour une version de développement : ne jamais la présenter comme publiée. */
export const IS_DEV_BUILD = VERSION_CHANNEL === 'dev';

/** Hash court Git valide, sinon `null` (jamais de chaîne inventée). */
export function normalizeCommit(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim().toLowerCase().replace(/^refs\/heads\//, '');
  if (!/^[0-9a-f]{4,40}$/.test(value)) return null;
  return value.slice(0, BUILD_ID_LENGTH);
}

/**
 * Commit réellement utilisé pour le build.
 * Ordre : valeur explicite → surcharge d'exécution → injection esbuild → Metro/Expo.
 */
export function resolveBuildCommit(explicit?: string | null): string | null {
  const fromExplicit = normalizeCommit(explicit);
  if (fromExplicit) return fromExplicit;

  const runtime = (globalThis as { __TKA_BUILD_COMMIT__?: unknown }).__TKA_BUILD_COMMIT__;
  const fromRuntime = normalizeCommit(runtime);
  if (fromRuntime) return fromRuntime;

  if (typeof __TKA_GIT_COMMIT__ !== 'undefined') {
    const fromBundle = normalizeCommit(__TKA_GIT_COMMIT__);
    if (fromBundle) return fromBundle;
  }

  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  const fromEnv = normalizeCommit(env?.EXPO_PUBLIC_TKA_BUILD);
  if (fromEnv) return fromEnv;

  return null;
}

/** « 2bd9c14 » ou le repli explicite « sans-git ». */
export function buildId(commit?: string | null): string {
  return resolveBuildCommit(commit) ?? BUILD_FALLBACK_ID;
}

/** Valeur du repli : le build n'est pas rattaché à un commit (à signaler dans les diagnostics). */
export function isFallbackBuild(commit?: string | null): boolean {
  return resolveBuildCommit(commit) === null;
}

/** « V4.1.0-dev · Build 2bd9c14 » */
export function versionBadge(commit?: string | null): string {
  return `${VERSION_LABEL} · Build ${buildId(commit)}`;
}

/** Libellé long pour les écrans de diagnostics techniques. */
export function versionDiagnostics(commit?: string | null): string {
  const id = buildId(commit);
  const suffix = isFallbackBuild(commit) ? ' (commit indisponible)' : '';
  return `${VERSION_LABEL} · Build ${id}${suffix} · ${IS_DEV_BUILD ? 'canal développement' : 'version publiée'}`;
}

/** Objet structuré exposé aux diagnostics (`window.__tka.version()`, écran pause). */
export function versionInfo(commit?: string | null) {
  return {
    version: APP_VERSION_STRING,
    label: VERSION_LABEL,
    channel: VERSION_CHANNEL,
    isDev: IS_DEV_BUILD,
    build: buildId(commit),
    buildFallback: isFallbackBuild(commit),
    badge: versionBadge(commit),
    diagnostics: versionDiagnostics(commit),
  };
}
