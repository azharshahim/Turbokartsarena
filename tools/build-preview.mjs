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

/**
 * Le build est-il fait avec des sources modifiées non commitées ?
 * Les sorties de build elles-mêmes (index.html, service-worker.js) ne comptent
 * pas : elles sont régénérées à chaque compilation. Tout autre fichier suivi
 * modifié ⇒ suffixe `+local`, pour qu'un bundle jamais publié ne puisse pas
 * revendiquer un commit propre.
 */
const BUILD_OUTPUTS = new Set(['index.html', 'service-worker.js']);
/** Les captures de tests sont régénérées : elles ne rendent pas un build « sale ». */
const GENERATED_PREFIXES = ['docs/v4.1-captures/'];
function isSourceDirty() {
  if (process.env.TKA_BUILD_FORCE_CLEAN === '1') return false;
  try {
    const out = execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return out
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .some((line) => {
        // Format porcelain : deux colonnes d'état puis un espace (` M index.html`).
        const path = line.slice(3).trim().replace(/^"|"$/g, '');
        if (BUILD_OUTPUTS.has(path)) return false;
        return !GENERATED_PREFIXES.some((prefix) => path.startsWith(prefix));
      });
  } catch {
    return false;
  }
}

const gitCommit = resolveGitCommit();
const buildLocal = Boolean(gitCommit) && isSourceDirty();
const commitLabel = gitCommit ? `${gitCommit}${buildLocal ? '+local' : ''}` : 'sans-git';
if (!gitCommit) console.warn('⚠️  Commit Git indisponible : la version affichera « Build sans-git ».');
else if (buildLocal) console.warn('⚠️  Sources non commitées : le build sera marqué « +local ».');


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
  define: {
    __TKA_GIT_COMMIT__: JSON.stringify(gitCommit),
    __TKA_BUILD_LOCAL__: JSON.stringify(buildLocal),
  },
};

/* ---------- 1. build séparé (dev) ---------- */
const html = readFileSync('preview/index.html', 'utf8')
  .replace('/*TKA_BOOT_DIAGNOSTICS*/', () => readFileSync('preview/boot-diagnostics.js', 'utf8'))
  .split('./preview/main.ts').join('./preview.js')
  // Le badge est aussi écrit en dur dans le HTML : lisible sans JavaScript.
  .split('<div id="versionBadge">V4.1.0-dev · Build —</div>')
  .join(`<div id="versionBadge">V4.1.0-dev · Build ${commitLabel}</div>`)
  .replace(
    /<meta charset="utf-8" \/>/,
    () => `<meta charset="utf-8" />\n    <meta name="tka-build" content="${commitLabel}" />`,
  );
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
  )
  .split('<div id="versionBadge">V4.1.0-dev · Build —</div>')
  .join(`<div id="versionBadge">V4.1.0-dev · Build ${commitLabel}</div>`);
writeFileSync('dist/turbo-karts-arena.html', single);
writeFileSync('index.html', single);
const kb = (single.length / 1024).toFixed(0);
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
console.log(`\n🏷️  Version ${pkg.version} · Build ${commitLabel}`);
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
