/**
 * Compile la preview navigateur.
 *  • preview/dist/            → version "serveur de dev" (modules séparés)
 *  • dist/turbo-karts-arena.html → FICHIER UNIQUE autonome
 *  • index.html → copie déployable GitHub Pages de ce même bundle autonome.
 */
import * as esbuild from 'esbuild';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

/**
 * Commit Git utilisé pour ce build (V4.1).
 * `TKA_GIT_COMMIT` permet de le fournir hors dépôt ; sinon on interroge git.
 * Si aucun commit n'est disponible, on injecte une chaîne vide : le jeu affiche
 * alors l'identifiant de secours explicite « sans-git » (jamais un faux hash).
 */
function resolveGitCommit() {
  if (process.env.TKA_GIT_COMMIT) return process.env.TKA_GIT_COMMIT.trim();
  try {
    return execFileSync('git', ['rev-parse', '--short=7', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}
const gitCommit = resolveGitCommit();
if (!gitCommit) console.warn('⚠️  Commit Git indisponible : la version affichera « Build sans-git ».');

mkdirSync('preview/dist', { recursive: true });
mkdirSync('dist', { recursive: true });
const watch = process.argv.includes('--watch');

const base = {
  entryPoints: ['preview/main.ts'],
  bundle: true,
  format: 'esm',
  target: ['es2020'],
  logLevel: 'info',
  sourcemap: false,
  minify: true,
  // Identification de version centralisée (`src/core/version.ts`).
  define: { __TKA_GIT_COMMIT__: JSON.stringify(gitCommit) },
};

/* ---------- 1. build séparé (dev) ---------- */
const html = readFileSync('preview/index.html', 'utf8')
  .replace('/*TKA_BOOT_DIAGNOSTICS*/', () => readFileSync('preview/boot-diagnostics.js', 'utf8'))
  .split('./preview/main.ts').join('./preview.js');
writeFileSync('preview/dist/index.html', html);

if (watch) {
  const ctx = await esbuild.context({ ...base, outfile: 'preview/dist/preview.js', sourcemap: true, minify: false });
  await ctx.watch();
  console.log('watch…');
} else {
  await esbuild.build({ ...base, outfile: 'preview/dist/preview.js' });
}

/* ---------- 2. build fichier unique ---------- */
const res = await esbuild.build({ ...base, write: false, outfile: 'preview.js' });
const js = res.outputFiles[0].text;
// On retire l'import map (plus utile : three est bundlé) et on injecte le script inline.
const single = html
  .replace(/<script type="importmap">[\s\S]*?<\/script>/, '')
  // ⚠️ remplacement par FONCTION : le JS minifié contient des séquences `$&`,
  // `$1`… qu'un remplacement par chaîne interpréterait (corruption du bundle).
  .replace(
    '<script type="module" src="./preview.js"></script>',
    () => `<script type="module">\n${js}\n</script>`,
  );
writeFileSync('dist/turbo-karts-arena.html', single);
writeFileSync('index.html', single);
const kb = (single.length / 1024).toFixed(0);
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const commitLabel = gitCommit ? `Build ${gitCommit}` : 'Build sans-git';
console.log(`\n🏷️  Version ${pkg.version} · ${commitLabel}`);
console.log(`\n✅ dist/turbo-karts-arena.html (${kb} Ko, autonome, hors ligne)`);
console.log('✅ preview/dist/index.html (build de dev)');
console.log('✅ index.html (bundle déployable GitHub Pages)');

/* ---------- 3. PWA (root / GitHub Pages, development preview, portable dist) ---------- */
const assets = ['manifest.webmanifest', 'icon.svg', 'icons/icon-192.png', 'icons/icon-512.png'];
const workerTemplate = readFileSync('service-worker.js', 'utf8')
  .replace(/const CACHE_VERSION = '[^']*';/, "const CACHE_VERSION = 'development';");
const hash = createHash('sha256').update(single).update(workerTemplate);
for (const asset of assets) hash.update(readFileSync(asset));
const version = hash.digest('hex').slice(0, 16);
const worker = workerTemplate.replace("const CACHE_VERSION = 'development';", `const CACHE_VERSION = '${version}';`);
writeFileSync('service-worker.js', worker);
for (const directory of ['preview/dist', 'dist']) {
  mkdirSync(`${directory}/icons`, { recursive: true });
  for (const asset of assets) writeFileSync(`${directory}/${asset}`, readFileSync(asset));
  // The development preview uses an external bundle; it must also be available offline.
  const scopedWorker = directory === 'preview/dist'
    ? worker.replace("const APP_SHELL = [", "const APP_SHELL = ['./preview.js', ")
    : worker;
  writeFileSync(`${directory}/service-worker.js`, scopedWorker);
}
writeFileSync('dist/index.html', single);
console.log(`✅ PWA assets + versioned offline shell (${version})`);
