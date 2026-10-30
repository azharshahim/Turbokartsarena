/**
 * Mission nº10 — fausse alerte « contexte WebGL : course » sur l'écran VICTOIRE.
 *
 * Mécanisme : `PhysicsEngine.dispose()` appelle `renderer.forceContextLoss()`
 * (extension WEBGL_lose_context). Le navigateur met alors en file un événement
 * `webglcontextlost` **asynchrone**. Si l'observateur posé par `observeRenderer`
 * n'a pas été détaché avant la destruction, il voit cette perte volontaire et
 * appelle `renderFailure()` : alerte affichée sur un écran qui n'a plus besoin
 * du GPU.
 *
 * 1. Reproduction du mécanisme avec une file d'événements asynchrone identique
 *    à celle du navigateur (ordre fautif → alerte, ordre corrigé → silence,
 *    perte réelle → alerte conservée).
 * 2. Vérification statique de `preview/main.ts` : chaque destruction de
 *    renderer est précédée, dans la même fonction, du détachement de son
 *    observateur. C'est cette vérification qui échoue avant la correction.
 */
import * as assert from 'node:assert';
import { readFileSync } from 'node:fs';

/* ---------- 1. mécanisme ---------- */

/** Canvas minimal : EventTarget + extension de perte asynchrone (comme Chromium). */
function makeCanvas() {
  const canvas = new EventTarget();
  let lost = false;
  const gl = {
    isContextLost: () => lost,
    getExtension: (name: string) => name === 'WEBGL_lose_context' ? {
      loseContext() { lost = true; setTimeout(() => canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true })), 0); },
    } : null,
  };
  return { canvas, gl, forceContextLoss: () => gl.getExtension('WEBGL_lose_context')!.loseContext() };
}

/** Même contrat que `observeRenderer` : attache, puis fonction de détachement. */
function observe(canvas: EventTarget, onFailure: () => void) {
  let disposed = false;
  const onLost = (event: Event) => { if (disposed) return; event.preventDefault(); onFailure(); };
  canvas.addEventListener('webglcontextlost', onLost);
  return () => { disposed = true; canvas.removeEventListener('webglcontextlost', onLost); };
}

const tick = () => new Promise(resolve => setTimeout(resolve, 5));

// Ordre fautif (ancien showResults) : destruction puis observateur oublié → fausse alerte.
{
  const { canvas, forceContextLoss } = makeCanvas();
  let failures = 0;
  observe(canvas, () => failures++);
  forceContextLoss();
  assert.equal(failures, 0, 'la perte est asynchrone : rien de synchrone');
  await tick();
  assert.equal(failures, 1, 'reproduction : alerte émise après une perte volontaire');
}

// Ordre corrigé : détachement, puis destruction → aucune alerte.
{
  const { canvas, forceContextLoss } = makeCanvas();
  let failures = 0;
  const release = observe(canvas, () => failures++);
  release();
  forceContextLoss();
  await tick();
  assert.equal(failures, 0, 'ordre corrigé : aucune alerte');
}

// Perte réelle (pilote GPU) pendant la course : l'alerte doit subsister.
{
  const { canvas } = makeCanvas();
  let failures = 0;
  observe(canvas, () => failures++);
  canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
  assert.equal(failures, 1, 'véritable perte : alerte conservée');
}

/* ---------- 2. ordre dans preview/main.ts ---------- */

const source = readFileSync('preview/main.ts', 'utf8');

/** Corps de la fonction nommée (accolades équilibrées, suffisant pour ce fichier). */
function functionBody(name: string) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `fonction ${name} introuvable`);
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) return source.slice(open, i + 1);
  }
  throw new Error(`fonction ${name} non terminée`);
}

/** Toutes les fonctions de main.ts qui détruisent un renderer. */
const names = [...source.matchAll(/function (\w+)\(/g)].map(m => m[1]);
const pairs: Array<[dispose: RegExp, release: string]> = [
  [/\bengine(\?\.|\.)dispose\(\)/, 'releaseRaceContext()'],
  [/\bshowroom(\?\.|\.)dispose\(\)/, 'releaseGarageContext()'],
];
let checked = 0;
for (const name of names) {
  const body = functionBody(name);
  for (const [dispose, release] of pairs) {
    const at = body.search(dispose);
    if (at < 0) continue;
    checked++;
    const releaseAt = body.indexOf(release);
    assert.ok(releaseAt >= 0 && releaseAt < at, `${name} : « ${release} » doit précéder la destruction du renderer`);
  }
}
assert.ok(checked >= 5, `au moins startEngine, quitToMenu, startRace, showResults et stopGarage (${checked} vérifiées)`);
// L'écran de résultats est précisément le cas signalé.
assert.ok(functionBody('showResults').includes('releaseRaceContext()'), 'showResults détache l’observateur course');

console.log(`Mission 10 OK — perte volontaire silencieuse, perte réelle signalée, ${checked} destructions ordonnées`);
