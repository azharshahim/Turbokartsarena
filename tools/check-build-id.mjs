/**
 * Mission nº12 — vérification du numéro de build publié.
 *
 * But : garantir qu'un bundle livré (le `index.html` servi par GitHub Pages et le
 * `dist/` généré) n'annonce jamais un commit qui ne contient pas son code.
 *
 * Un build est « propre » quand il porte l'identifiant d'un commit dont les
 * sources sont identiques à celles du HEAD vérifié. Les fichiers produits par le
 * build lui-même (index.html, service-worker.js, dist/, captures) sont ignorés :
 * ils ne font que matérialiser la compilation du commit affiché.
 *
 * Le script lit la version **committée** (`git show HEAD:index.html`), pas le
 * fichier de travail : une recompilation locale ne peut donc pas masquer une
 * incohérence dans le dépôt.
 *
 * Usage : node tools/check-build-id.mjs
 * Échec ⇒ sortie non nulle avec la cause exacte.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

/**
 * Un clone superficiel (`actions/checkout` par défaut, `--depth 1`) ne contient
 * pas le commit affiché : on tente de le récupérer avant de conclure. Sans lui,
 * le contrôle de parenté est simplement ignoré avec un avertissement explicite —
 * un clone superficiel n'est pas une incohérence de version.
 */
function commitAvailable(commit) {
  try {
    git('cat-file', '-e', `${commit}^{commit}`);
    return true;
  } catch {
    /* absent du clone */
  }
  try {
    execFileSync('git', ['fetch', '--no-tags', '--depth=1', 'origin', commit], { stdio: 'ignore' });
  } catch {
    /* réseau indisponible ou SHA non servi */
  }
  try {
    git('cat-file', '-e', `${commit}^{commit}`);
    return true;
  } catch {
    return false;
  }
}
const warnings = [];

const failures = [];
const infos = [];

/** Fichiers qui matérialisent un build : exclus de la comparaison de sources. */
const BUILD_OUTPUTS = [
  ':(exclude)index.html',
  ':(exclude)service-worker.js',
  ':(exclude)dist/**',
  ':(exclude)preview/dist/**',
  ':(exclude)docs/v4.1-captures/**',
  ':(exclude)node_modules/**',
];

let html;
try {
  html = git('show', 'HEAD:index.html');
} catch {
  failures.push('index.html est absent du commit HEAD : rien à vérifier.');
  html = '';
}

const meta = html.match(/<meta name="tka-build" content="([^"]*)" \/>/);
if (!meta) {
  failures.push('le bundle committé ne porte pas de marqueur <meta name="tka-build"> (build non traçable).');
}

if (meta) {
  const id = meta[1].trim();
  infos.push(`marqueur de build committé : « ${id} »`);
  const clean = id.match(/^([0-9a-f]{7})(\+local)?$/);
  if (!clean) {
    failures.push(`identifiant de build invalide : « ${id} » (attendu 7 hexadécimaux, éventuellement +local).`);
  } else if (clean[2]) {
    failures.push(`le bundle committé porte « ${id} » : un build avec sources non commitées ne doit pas être livré.`);
  } else {
    const commit = clean[1];
    let known = true;
    if (!commitAvailable(commit)) {
      warnings.push(`commit ${commit} absent du clone (dépôt superficiel) : contrôle de parenté ignoré — lancez « git fetch --unshallow » pour un audit complet.`);
      known = false;
    }
    if (known) {
      try {
        git('merge-base', '--is-ancestor', commit, 'HEAD');
      } catch {
        failures.push(`le commit ${commit} affiché n'est pas un ancêtre de HEAD.`);
        known = false;
      }
    }
    if (known) {
      const changed = git('diff', '--name-only', commit, 'HEAD', '--', '.', ...BUILD_OUTPUTS);
      if (changed) {
        const files = changed.split('\n');
        failures.push(`le build annonce ${commit} mais ${files.length} fichier(s) source diffèrent de HEAD : ${files.slice(0, 12).join(', ')}`);
      } else {
        infos.push(`✅ les sources de ${commit} sont identiques à HEAD (hors fichiers de build).`);
      }
    }
  }
}

/* Cohérence des manifestes avec le module de version (source unique). */
const versionTs = readFileSync('src/core/version.ts', 'utf8');
const declared = versionTs.match(/APP_VERSION: VersionNumber = \{ major: (\d+), minor: (\d+), patch: (\d+) \}/);
if (!declared) failures.push('src/core/version.ts : APP_VERSION introuvable.');
const version = declared ? `${declared[1]}.${declared[2]}.${declared[3]}` : null;
if (declared) {
  if (declared[3] !== '0') failures.push(`APP_VERSION (${version}) doit rester sur une révision majeure (patch 0) pendant la V4.1.`);
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  if (pkg.version !== `${version}-dev`) failures.push(`package.json (${pkg.version}) ≠ version applicative (${version}-dev).`);
  const app = JSON.parse(readFileSync('app.json', 'utf8'));
  if (app.expo?.version !== version) failures.push(`app.json (${app.expo?.version}) ≠ version applicative (${version}).`);
  if (typeof app.expo?.android?.versionCode !== 'number') failures.push('app.json : versionCode manquant.');
  if (app.expo?.extra?.gitCommit !== 'auto') {
    failures.push("app.json : extra.gitCommit doit valoir « auto » (aucun hash codé en dur).");
  }
  if (!versionTs.includes("VERSION_CHANNEL: VersionChannel = 'dev'")) {
    failures.push('src/core/version.ts : le canal doit rester « dev » tant que la V4.1 n\'est pas validée.');
  }
}
if (/['"`][0-9a-f]{7,40}['"`]/.test(versionTs)) failures.push('src/core/version.ts contient un hash de commit en dur.');

for (const line of infos) console.log(`  ${line}`);
for (const line of warnings) console.warn(`  ⚠️  ${line}`);
if (failures.length) {
  console.error('\n❌ Numéro de build incohérent :');
  for (const failure of failures) console.error(`   • ${failure}`);
  process.exit(1);
}
console.log('\n✅ Version et build cohérents (commit réel, sources identiques, manifestes alignés).');
