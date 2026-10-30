# Mission nº12 — Audit final de la V4.1 (version `V4.1.0-dev`)

**Branche** : `arena/7cfa1d23-turbokartsarena` (branche de la **PR nº9**, non fusionnée).
**Base** : `main` @ `2bd9c14` · **commit audité** : `1b37067` (mission nº11).
**Objectif** : ne rien ajouter de majeur, seulement corriger ce qui est réellement
cassé, et rendre la V4.1 présentable pour un test sur Samsung.

Documents liés : [audit des commandes](MISSION-11-AUDIT-COMMANDES.md),
[rapport V4.1](MISSION-11-V4.1.md), [captures](v4.1-captures/).

---

## 1. Workflow GitHub Actions de la PR nº9

| Élément | Valeur |
|---|---|
| Run | [#41101218372](https://github.com/azharshahim/Turbokartsarena/actions/runs/41101218372) |
| Commit validé | `1b37067` (tête de la PR nº9) |
| Début → fin | 17:44:46 → 18:05:55 UTC (≈ 21 min) |
| Conclusion | ✅ **success** (typecheck, `npm test`, `test:v2/v3/v4`, `test:mission10/11`, build, Playwright web + Android simulé, narrowing, GPU, PWA, APK) |

Aucune cause d'échec à corriger : le workflow était vert. Les suites de la
mission nº12 ont simplement été **ajoutées** à ce même workflow pour les prochains
runs, et aucune compilation supplémentaire n'a été lancée à la main.

---

## 2. Problèmes détectés

| # | Problème | Gravité | Constat | Statut |
|---|---|---|---|---|
| 1 | **Le build affiché ne correspondait pas au code livré** : le bundle annonçait `Build 2bd9c14` (fusion de la PR nº8, *avant* la V4.1) | **P1** | Le bundle avait été compilé **avant** le commit de la V4.1 ; rien ne détectait l'incohérence. C'est exactement le point signalé en revue. | ✅ corrigé |
| 2 | Aucun garde-fou automatique : n'importe quel bundle pouvait annoncer n'importe quel commit | **P1** | Aucun test ne reliait version affichée ↔ contenu compilé. | ✅ corrigé (`test:build-id`) |
| 3 | Un build compilé avec des **sources non commitées** ne se distinguait pas d'un build propre | **P2** | `git rev-parse HEAD` seul ne dit rien de l'état du dossier de travail. | ✅ corrigé (suffixe `+local`) |
| 4 | Le badge du menu était écrit « en dur » dans le HTML avec un texte de remplacement `—` | **P2** | Si le JS échoue (WebGL bloqué, vieux WebView), le joueur voit `Build —`. | ✅ corrigé (écrit au build) |
| 5 | **APK Android** : `app.json` déclarait `gitCommit: "auto"` mais rien ne fournissait le commit à Metro → l'app native aurait affiché `sans-git` | **P1** | Chemin `EXPO_PUBLIC_TKA_BUILD` jamais alimenté. | ✅ corrigé (env du job APK) |
| 6 | Confort tactile mesuré sur **un seul** viewport (915×412) | **P2** | Aucune preuve pour les écrans 800×360, 851×393, 960×412, tablettes. | ✅ corrigé (5 écrans) |
| 7 | Le bouton **GAZ** (accélération manuelle) n'avait jamais été vérifié en géométrie | **P2** | Risque de chevauchement avec FREIN/DÉRAPAGE. | ✅ vérifié (aucun chevauchement) |
| 8 | Le bouton **TIR** n'était couvert par aucun test navigateur | **P3** | Un bouton mort passerait inaperçu. | ✅ vérifié |
| 9 | Référence de documentation obsolète dans l'en-tête de `tools/tests-mission11.ts` | **P3** | Pointait vers un fichier inexistant. | ✅ corrigé |

### Ce qui n'a **pas** été « corrigé » (et pourquoi)

- **Vitesse de pointe après un turbo** : un dérapage palier 3 suivi du boost donne
  un pic ≈ **229 km/h** pour une pointe nominale de **145 km/h** (×1,58). C'est le
  comportement **arcade d'origine** (`boostMult` 1,4 + impulsion 9,2 m/s, inchangés
  par la V4.1) : le modifier aurait changé le ressenti validé précédemment.
  Vérifié : l'impulsion de maîtrise (`masteryKick`) **ne relève pas ce pic**
  (écart < 0,5 %), elle n'allonge que la durée.
- **Gain maximal des améliorations** : ×1,32 sur la pointe au niveau 5 partout
  (≈ 214 km/h). Formule `1 + 0,03 × niveau` **inchangée** depuis la V3.
- **Bouton PAUSE à 48 px de haut** : au-dessus du minimum Android (44 px), il tient
  sur une seule ligne avec 119 px de large : conservé tel quel.

---

## 3. Corrections effectuées

### 3.1 Chaîne de version / build

| Fichier | Changement |
|---|---|
| `src/core/version.ts` | `BUILD_LOCAL_SUFFIX`, `isLocalBuild()`, `buildId()` suffixé pour les builds sales, `versionInfo()` expose `commit` et `local`, diagnostics explicites (« sources non commitées », « commit indisponible »), test qui refuse un hash en dur |
| `tools/build-preview.mjs` | détection `git status --porcelain` (les sorties de build ne comptent pas) ⇒ `+local` ; **marqueur `<meta name="tka-build" content="…">`** dans le HTML livré ; badge statique du menu écrit au build ; log `Version 4.1.0-dev · Build …` |
| `tools/check-build-id.mjs` *(nouveau)* + `npm run test:build-id` | lit le `index.html` **committé**, vérifie que le commit affiché existe, est un ancêtre de HEAD et que **les sources entre ce commit et HEAD sont identiques** (hors fichiers de build) ; vérifie que `package.json`, `app.json`, `src/core/version.ts` sont alignés et qu'aucun hash n'est codé en dur ; échoue si le bundle porte `+local` ou un badge `—` |
| `.github/workflows/android-apk.yml` | `test:mission12`, `test:build-id`, audit de mise en page, et `EXPO_PUBLIC_TKA_BUILD: ${{ github.sha }}` sur le build APK |

Résultat concret : le bundle livré porte désormais
`<meta name="tka-build" content="1b37067">` et affiche
`V4.1.0-dev · Build 1b37067` — c'est-à-dire **le commit qui contient réellement
le code compilé** (et non `2bd9c14`, la fusion de la PR nº8).

Convention retenue, sans numéro codé en dur :

```
bundle compilé à partir d'un dossier propre      →  Build 1b37067
bundle compilé avec des sources modifiées        →  Build 1b37067+local
bundle compilé hors dépôt Git (zip, APK sans .git) →  Build sans-git
```

`test:build-id` refuse toute combinaison où les sources du commit affiché
diffèrent de celles du `HEAD` vérifié : un bundle ne peut donc plus mentir sur
son origine.

### 3.2 Tests ajoutés

| Fichier | Rôle |
|---|---|
| `tools/tests-mission12.ts` *(nouveau, `npm run test:mission12`)* | 184 vérifications : version/badge/repli/local, marqueur du bundle livré, sauvegardes (coins, véhicules, améliorations, records, migration), conduite des 14 véhicules (pointe, 0-100, freinage, virage, gains d'amélioration), dérapage/mini-turbo, régressions statiques |
| `tools/browser-android-landscape.mjs` *(nouveau, `npm run test:browser:android:layout`)* | mesures réelles sur **5 écrans** paysage : cibles ≥ 44 px, marges ≥ 8 px, aucun chevauchement entre commandes **et** avec le HUD, `touch-action: none`, puis pause → reprise, rotation portrait → paysage, multi-touch, bouton TIR et mode d'accélération manuel |

---

## 4. Vérifications par domaine

### 4.1 Commandes tactiles (mesures réelles)

| Écran (paysage) | Direction | Actions (TIR/TURBO/FREIN/DÉRAPAGE) | PAUSE |
|---|---|---|---|
| 915×412 (S23/S24) | 94,8 × 94,8 px | 80,3 × 80,3 px | 118,6 × 48 |
| 851×393 (A54) | 90,4 × 90,4 px | 76,6 × 76,6 px | 118,6 × 48 |
| 800×360 (petit) | 82,8 × 82,8 px | 70,2 × 70,2 px | 118,6 × 48 |
| 960×412 (S Ultra) | 94,8 × 94,8 px | 80,3 × 80,3 px | 118,6 × 48 |
| 1280×800 (tablette) | 108 × 108 px | 96 × 96 px | 118,6 × 48 |

- **Aucun chevauchement** entre les 7 commandes, ni avec la minimap, le classement,
  le compteur de vitesse ou le bouton GAZ.
- **Marges** : 12 px minimum sur les bords, 10 px en bas, pause sous l'encoche.
- **Multi-touch** : 4 doigts simultanés (direction + dérapage + turbo + frein).
- **Après pause** : `steer` repart immédiatement (−1 / +1).
- **Après rotation portrait → paysage** : les 7 zones sont recalculées, ≥ 44 px, et
  la direction répond.
- **Mode manuel** : le bouton GAZ apparaît sans recouvrir les autres commandes.
- **Bouton TIR** : présent, lisible, sans erreur au clic (`firePlayerWeapon()`).

### 4.2 Gyroscope

Revu et re-testé (aucune régression) : activation seulement après un **échantillon
réel**, bouton `GYROSCOPE : ACTIVÉ / DÉSACTIVÉ / EN ATTENTE…`, `RECALIBRER`,
`sensibilité Doux / Normal / Sport`, `SENS DU GYRO`, neutralité à 0°, cohérence en
paysage (angle d'écran 0/90/180/270), persistance, et **repli automatique** sur les
boutons après 1,2 s sans données (les commandes tactiles ne sont jamais masquées
avant réception d'un signal valide). Détails et limites : §4.5 du
[rapport V4.1](MISSION-11-V4.1.md).

### 4.3 Conduite (banc d'essai, 14 véhicules)

| Mesure | Gabarit vérifié | Constat |
|---|---|---|
| Vitesse de pointe (sans boost) | 120 – 180 km/h | 140 → 163 km/h selon le véhicule |
| 0 → 100 km/h | 1,2 – 4,5 s | 1,79 – 2,27 s |
| Freinage 33 m/s → arrêt | 5 – 30 m | 10,6 – 13,2 m |
| Vitesse de rotation en virage | 0,8 – 3,2 rad/s | 1,69 – 2,11 rad/s |
| Gain max des améliorations (pointe) | ×1,05 – ×1,45 | ×1,27 – ×1,32 |
| Écart entre véhicules | > 8 km/h | 23 km/h (140 → 163) |

Les différences entre karts, motos, cross et touring sont conservées ; aucune
accélération excessive introduite (les paramètres moteur n'ont pas bougé en V4.1).

### 4.4 Stabilité WebGL (missions nº9 et nº10)

- `test:mission10` ✅ — perte volontaire silencieuse, perte réelle signalée,
  5 destructions ordonnées.
- `test:browser:android` ✅ — `"status": "PASS"`, `pageErrors: []`, rotation,
  contexte perdu, shaders en échec, module non téléchargé.
- Statique : `dispose()` conserve l'ordre `postfx → environmentTarget → sun.shadow →
  renderer`, et `forceContextLoss()` reste **réservé au web** (`!this.isNative`).
- Aucune allocation GPU ni post-traitement ajouté par la V4.1.

### 4.5 Sauvegardes

| Donnée | Clé | Vérification |
|---|---|---|
| Turbo Coins, véhicules, améliorations, records, sélection, stats, anti-abus | `turbokarts.v3.garage.v1` | 1 234 TC, 10 véhicules, améliorations niv. 3/5, records et 17 courses relus **intacts** |
| Réglages de commandes | `turbokarts.v4.1.controls.v1` | clé distincte : sauver les réglages **ne réécrit pas** le garage |
| Migration | ancien booléen V4.0 | converti en `steerMode`, le reste par défaut |
| Sauvegarde corrompue | — | retour aux valeurs par défaut, jamais d'exception |

Aucune sauvegarde n'a été réinitialisée ni migrée destructivement.

---

## 5. Résultats des tests

| Commande | Résultat |
|---|---|
| `npm run typecheck` (`tsc --noEmit` + `tsconfig.preview.json`) | ✅ 0 erreur |
| `npm test` | ✅ 45 / 45 |
| `npm run test:v2` | ✅ 199 checks |
| `npm run test:v3` | ✅ 12 circuits, 14 véhicules, safe-area |
| `npm run test:v4` | ✅ 3 blocs |
| `npm run test:mission10` | ✅ |
| `npm run test:mission11` | ✅ |
| **`npm run test:mission12`** | ✅ **184 vérifications** |
| **`npm run test:build-id`** | ✅ commit affiché = sources identiques à HEAD |
| `npm run test:browser` | ✅ PASS (0 erreur) |
| `npm run test:browser:mission11` | ✅ PASS |
| **`npm run test:browser:android:layout`** | ✅ PASS sur 5 écrans paysage |
| `npm run test:browser:android` | ✅ `status: PASS`, `pageErrors: []` |
| `npm run test:pwa` | ✅ 5 blocs (installation, hors-ligne, mise à jour du cache) |
| `npm run preview:build` | ✅ `index.html`, `dist/`, PWA |

## 6. Version générée

```
Turbo Karts Arena — V4.1.0-dev
Build : 1b37067          ← commit réel du code compilé (calculé, jamais écrit à la main)
```

- `package.json` → `4.1.0-dev` · `app.json` → `4.1.0` / `versionCode 41`
- `src/core/version.ts` → source unique (`APP_VERSION`, `VERSION_CHANNEL = 'dev'`)
- Manifeste du bundle → `<meta name="tka-build" content="1b37067">`
- Menu → badge discret ; pause → diagnostics complets (version, build, FPS, qualité,
  gyroscope, réglages)
- **Jamais affiché comme stable** : `-dev` partout, canal `dev`, release Android en
  `prerelease`.

## 7. Limites : ce qui exige un test sur Samsung

1. **Capteur réel** : latence et dérive de l'accéléromètre/fusion Samsung, comportement
   sous One UI, permission éventuelle de Chrome. Les tests utilisent des événements
   simulés — ils valident la logique, pas le capteur.
2. **Ressenti au pouce** : taille perçue des zones, effort, chaleur, position de la
   barre de gestes par rapport aux commandes.
3. **FPS réels** : les mesures viennent d'un rendu logiciel (SwiftShader), pas de
   l'Adreno 830.
4. **APK** : aucun binaire compilé ici (ni JDK ni SDK Android) ; l'APK de la CI est
   le seul moyen de valider l'hôte natif (`DeviceMotion`).
5. **Repli capteur** : la procédure de refus de permission est documentée mais n'a
   pas été exécutée sur un appareil.

## 8. PR et état de fusion

- **PR nº9** : https://github.com/azharshahim/Turbokartsarena/pull/9
- Branche : `arena/7cfa1d23-turbokartsarena` (mise à jour, aucune nouvelle PR créée)
- Workflow du commit audité : ✅ vert
- **Prête à être fusionnée ?** Techniquement **oui** (build vérifié, suites vertes),
  mais la règle de la mission reste : **attendre la validation explicite** du
  propriétaire après essai sur Samsung. Aucun merge, aucune publication effectués.
