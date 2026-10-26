/**
 * Turbo Karts Arena — compression ASTC de l'APK.
 *
 * Les textures du jeu sont générées en mémoire (aucun PNG dans le bundle), mais
 * tous les assets binaires ajoutés dans `assets/` (polices d'icônes, sons, futurs
 * modèles GLB texturés) doivent être compressés en ASTC pour la GPU mobile.
 *
 * Usage :  node tools/compress-astc.mjs [--quality 6] [--block 6x6]
 * Prérequis : `astcenc` (ARM ASTC Encoder) dans le PATH.
 *   macOS : brew install astcenc
 *   Linux : https://github.com/ARM-software/astc-encoder/releases
 *
 * Le script est idempotent : il ignore les fichiers déjà compressés et écrit un
 * manifeste (`assets/astc-manifest.json`) lu par le moteur pour choisir la
 * variante de texture selon le support de l'appareil.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { extname, join, relative } from 'node:path';

const ROOT = 'assets';
const OUT = join(ROOT, 'astc');
const QUALITY = process.argv.includes('--quality')
  ? process.argv[process.argv.indexOf('--quality') + 1]
  : '6';
const BLOCK = process.argv.includes('--block')
  ? process.argv[process.argv.indexOf('--block') + 1]
  : '6x6';
const FORMAT = `-${BLOCK}`;
const COMPRESSIBLE = new Set(['.png', '.jpg', '.jpeg']);

if (!existsSync(ROOT)) {
  console.log(`ℹ️  Dossier "${ROOT}" absent : rien à compresser (textures procédurales).`);
  process.exit(0);
}

function hasAstcenc() {
  try {
    execFileSync('astcenc', ['-help'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

if (!hasAstcenc()) {
  console.error(
    '❌ astcenc introuvable.\n' +
      '   macOS : brew install astcenc\n' +
      '   Linux : télécharger sur github.com/ARM-software/astc-encoder/releases\n' +
      '   Puis relancer : node tools/compress-astc.mjs',
  );
  process.exit(1);
}

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (entry === 'astc') continue;
    const st = statSync(full);
    if (st.isDirectory()) out.push(...walk(full));
    else if (COMPRESSIBLE.has(extname(entry).toLowerCase())) out.push(full);
  }
  return out;
}

const files = walk(ROOT);
if (files.length === 0) {
  console.log('ℹ️  Aucune image à compresser.');
  process.exit(0);
}

mkdirSync(OUT, { recursive: true });
const manifest = {};
let saved = 0;

for (const file of files) {
  const rel = relative(ROOT, file);
  const target = join(OUT, rel.replace(/\.(png|jpe?g)$/i, '.astc'));
  mkdirSync(join(target, '..'), { recursive: true });
  try {
    execFileSync('astcenc', [FORMAT, file, target, `-${QUALITY}`, '-silent'], { stdio: 'inherit' });
    const before = statSync(file).size;
    const after = statSync(target).size;
    saved += before - after;
    manifest[rel] = {
      astc: relative(ROOT, target),
      block: BLOCK,
      quality: QUALITY,
      bytes: after,
    };
    console.log(`✅ ${rel} → ${(after / 1024).toFixed(0)} Ko (${(((before - after) / before) * 100).toFixed(0)} % de gain)`);
  } catch (e) {
    console.warn(`⚠️  échec sur ${rel}: ${e.message}`);
  }
}

writeFileSync(join(OUT, 'astc-manifest.json'), JSON.stringify(manifest, null, 2));
console.log(`\nTotal économisé : ${(saved / 1024 / 1024).toFixed(1)} Mo`);
console.log('Manifeste : assets/astc/astc-manifest.json');
console.log(
  'Note : Expo ne charge pas automatiquement les .astc. Côté natif, brancher\n' +
    'expo-gl/GLTFLoader sur le manifeste (voir docs/ASSETS.md) — le moteur\n' +
    'utilise les textures procédurales tant que la variante ASTC n’est pas chargée.',
);
