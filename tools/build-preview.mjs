/**
 * Compile la preview navigateur.
 *  • preview/dist/            → version "serveur de dev" (modules séparés)
 *  • dist/turbo-karts-arena.html → FICHIER UNIQUE autonome
 *  • index.html → copie déployable GitHub Pages de ce même bundle autonome.
 */
import * as esbuild from 'esbuild';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

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
};

/* ---------- 1. build séparé (dev) ---------- */
const html = readFileSync('preview/index.html', 'utf8').split('./preview/main.ts').join('./preview.js');
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
console.log(`\n✅ dist/turbo-karts-arena.html (${kb} Ko, autonome, hors ligne)`);
console.log('✅ preview/dist/index.html (build de dev)');
console.log('✅ index.html (bundle déployable GitHub Pages)');
