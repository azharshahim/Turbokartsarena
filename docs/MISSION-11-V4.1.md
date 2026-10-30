# Mission nº11 — V4.1.0-dev : commandes, gyroscope, ressenti et HUD

**Branche** : `arena/7cfa1d23-turbokartsarena`, créée depuis `main` @
`2bd9c14d27d033015b0476cedf70e28b562bf56e` (dernier PR fusionné : nº8).
**Version fonctionnelle** : `V4.1.0-dev` — **développement**, pas une version
publique stable. Aucun merge, aucune publication, aucun APK compilé.
**Périmètre** : étape 1 de la V4.1 (commandes + gyroscope + ressenti + HUD + version).

Documents liés :

- [Audit des commandes existantes](MISSION-11-AUDIT-COMMANDES.md) (état avant, défauts).
- Captures : [docs/v4.1-captures/](v4.1-captures/) (générées par le test navigateur).
- Dossier de la mission précédente : [MISSION-10-FAUSSE-ALERTE-WEBGL.md](MISSION-10-FAUSSE-ALERTE-WEBGL.md) (stabilité WebGL).

---

## 1. Résumé des changements

| Domaine | Avant (V4.0) | V4.1.0-dev |
|---|---|---|
| Direction tactile | 2 boutons ronds 96 px | 2 **zones** de 95 px (jusqu'à 108 px sur grand écran), cluster gauche, marges sûres, appuis simultanés 4 doigts |
| Accélération | figée à 100 % | **automatique par défaut**, mode **manuel** avec bouton GAZ explicite, réglage mémorisé |
| Frein | bouton FREIN + `↓` | idem + **icône + libellé** lisibles, jamais sous le pouce du dérapage (colonne séparée) |
| Dérapage | bouton bleu, turbo automatique | bouton DÉRAPAGE à **anneau de palier**, mini-turbo de **maîtrise**, sortie stabilisée |
| Turbo | automatique, jauge passive | **bouton TURBO** avec état PRÊT / % / ACTIF / RECHARGE + flash de palier + jauge de maîtrise |
| Gyroscope | débit de rotation, gain fixe, aucun repli | **orientation** (gravité projetée), 3 sensibilités, zone morte, filtrage, calibration, **repli automatique** |
| Version | `3.0.0-dev` + « V4 » en dur | `4.1.0-dev` centralisé, badge `V4.1.0-dev · Build 2bd9c14` |
| HUD | plat, `bottom: 6px` | cluster haut lisible, safe-areas Android, vitesse centrée, pause 48 px |

Aucun circuit, véhicule, pilote ou contenu n'a été supprimé (12 circuits,
14 véhicules, 8 pilotes — vérifié par `test:v3` et `test:mission11`).
Turbo Coins et sauvegardes conservés à l'octet près (`turbokarts.v3.garage.v1`).

---

## 2. Commandes tactiles (paysage Android)

### 2.1 Disposition mesurée

Mesures réelles au navigateur, viewport **915 × 412 @2×** (`test:browser:mission11`,
§2) :

```
leftBtn   95×95  @ 12,307      fireBtn   80×80  @ 734,233
rightBtn  95×95  @ 115,307     turboBtn  80×80  @ 823,233
                               brakeBtn  80×80  @ 734,322
                               driftBtn  80×80  @ 823,322
pauseBtn 119×48  @ 784,12      speedo   223×78  @ 346,328
minimap   84×84  @ 14,203 (au-dessus du cluster gauche, plus sous les pouces)
```

- **Aucun chevauchement** entre les 7 zones interactives (vérifié par assertions).
- **Toutes les cibles ≥ 44 px** (recommandation Android) — les plus petites font 80 px.
- Marges : `max(12px, env(safe-area-inset-*))` à gauche/droite, `max(10px, …)` en bas,
  pause à `top: max(12px, env(safe-area-inset-top))`.
- Tailles fluides : `--pad: clamp(76px, 23vh, 108px)`, `--act: clamp(62px, 19.5vh, 96px)`.
  Sur un écran de 640 px de haut, les zones grandissent ; sur un écran très court
  (≤ 430 px), elles se réduisent pour ne pas manger la piste.
- Conteneur `pointer-events: none` : les zones ne bloquent jamais la vue ;
  `touch-action: none` sur chaque zone : aucun zoom/scroll parasite.

### 2.2 Multi-touch et changements de direction rapides

Le suivi existant a été **conservé** (il fonctionnait) et étendu :

- une entrée `pointerTargets: Map<pointerId, HTMLElement>` + `touchPointers`
  (compteur par action) ; chaque pointeur est capturé (`setPointerCapture`) ;
- `pointerup`, `pointercancel`, `blur`, `visibilitychange`, pause → remise à zéro
  **indépendante** de chaque doigt ;
- 4 appuis simultanés testés (gauche + dérapage + turbo + frein) sans perte.

Nouveau : `TouchAction` accepte désormais `turbo` et `accel`
(`src/core/touchControls.ts`), donc les deux nouveaux boutons utilisent exactement
le même mécanisme que les anciens.

### 2.3 Accélération

- **Défaut : automatique** (`throttle = 1`) — rien ne change pour un joueur habitué.
- **Option manuelle** : menu/pause → `ACCÉLÉRATION : MANUELLE`. Le bouton **GAZ**
  apparaît (bouton vert, `#accelBtn`), `throttle = 1` maintenu, `0` relâché.
  Le moteur ne demande aucune modification : `input.throttle` existait déjà
  (`src/core/kart.ts` §accélération/drag).
- Clavier inchangé : `↑`/`W`/`Z` accélèrent aussi (utile en manuel, sans effet en auto).

### 2.4 Frein / marche arrière

Bouton `FREIN` rose avec **icône bouclier + libellé**, colonne séparée du dérapage :
le pouce droit peut tenir DÉRAPAGE **et** presser FREIN/TURBO sans ambiguïté
(80 px de côté, 9 px de gouttière, zones distinctes). Le comportement physique est
inchangé (frein puis marche arrière à l'arrêt, 33 m/s → ≤ 0,9 m/s en < 45 m).

### 2.5 Dérapage : le « premier vrai gain de fun »

Objectif : rendre le dérapage **désirable**. Trois réglages seulement, dans
`PHYSICS.drift` (`src/core/config.ts`) — **aucune réécriture de la physique** :

| Paramètre | Effet |
|---|---|
| `scrubBase: 1.25` / `scrubSteer: 0.95` | le dérapage **conserve mieux la vitesse** : c'est un outil de virage, plus une punition |
| `exitLateralKeep: 0.45` | en sortie, une partie de la vitesse latérale est réalignée sur le cap → plus de tête-à-queue à la remise des gaz |
| `masteryHold: 1.05 s` + `masteryBonus: 0.7 s` + `masteryKick: 3.2` | **mini-turbo de maîtrise** : tenir le palier **violet** ≥ 1,05 s puis relâcher donne +0,7 s de boost et une impulsion supplémentaire |

Ainsi que `steerReturn: 17` / `steerEngage: 13` / `steerEngageDrift: 16` :
le rappel au centre est **plus rapide** que la mise en virage (amortissement
asymétrique). Résultat : pas de coup de volant brutal, mais un retour au centre franc.

Le mini-turbo de maîtrise était explicitement conditionné à « simple et sans
régression » : il tient en **10 lignes** dans `endDrift`, ne touche ni les paliers,
ni le plafond de vitesse, ni l'IA. `masteryCount` et `masteryFlash` sont exposés au
HUD (flash « MAÎTRISE + »).

### 2.6 Turbo

- **Bouton** `#turboBtn` (cyan, éclair), colonne de droite, à portée du pouce.
- États : `TURBO` (gris, jauge vide) → `TURBO 45 %`… (jauge qui se remplit en
  dérapant) → `TURBO PRÊT` (pulsation cyan) → `ACTIF` (fond plein, pulsation rapide).
- **Déclenchement** : le bouton libère le boost immédiatement (impulsion + durée),
  même hors dérapage. `reentryLockout: 0.32 s` empêche de ré-armer un dérapage dans
  la foulée (anti-spam).
- La jauge du bas (`#driftMeter` + libellé) reste : elle donne la **charge** et le
  palier ; le bouton donne l'**action**. Le retour visuel est du DOM/CSS pur :
  aucun coût GPU.

---

## 3. Gyroscope

### 3.1 Le problème corrigé

L'ancien code utilisait `atan2(z, 9.81)` (Android) et `gamma * 1.6` (web) : une
**vitesse angulaire**, pas une inclinaison. Un gyroscope mesure une rotation :
immobile, il renvoie 0. D'où une direction qui dérive, ne revient pas au centre et
ne répond pas quand on tient le téléphone tranquille.

### 3.2 La nouvelle chaîne (`src/core/gyro.ts`, module pur, testé sous Node)

```
beta/gamma  ──►  gravité dans le référentiel appareil
             g = (sinγ·cosβ, −sinβ, −cosγ·cosβ)
                 │
                 ├─ axes écran selon screen.orientation.angle (0/90/180/270)
                 │     right, up  (le paysage n'est plus « gamma »)
                 │
                 └─► tilt = atan2(g·right, −g·up)   [degrés]
                        │
      calibration (±35°) → zone morte → courbe douce → lissage temporel → limite de vitesse
                        │
                        └─► steer ∈ [−1, +1]  (+1 = droite à l'écran)
```

Propriétés garanties (et verrouillées par `test:mission11` §5) :

- **neutre à 0°** une fois calibré, **téléphone à plat ⇒ 0** (aucune oscillation) ;
- **10° d'inclinaison ⇒ ~10° de volant**, symétrique gauche/droite ;
- **indépendant de l'angle d'écran** : testé pour 0°, 90°, 180°, 270° avec les poses
  physiques correspondantes (matrices de rotation réelles) ;
- convention navigateur inversée détectée et corrigée automatiquement
  (`gu > 0.02` ⇒ demi-tour de référentiel) ;
- filtrage **dépendant du temps** (`damp`, pas du framerate) et limitation de
  variation (`maxRate`) : pas de coup de volant involontaire, même à 120 Hz.

### 3.3 Sensibilités (avec zone morte et filtrage)

| Réglage | Zone morte | Course max | Lissage | Vitesse max |
|---|---|---|---|---|
| **Doux** | 4,5° | 32° | 9 /s | 2,2 /s |
| **Normal** (défaut) | 3° | 21° | 15 /s | 4,2 /s |
| **Sport** | 2° | 13° | 22 /s | 7 /s |

Courbe de réponse : `t²(3−2t)·0.35 + t·0.65` — précision autour du centre,
verrouillage franc en butée.

### 3.4 État affiché = état réel

- Le libellé (`GYROSCOPE : ACTIVÉ / DÉSACTIVÉ / EN ATTENTE…`) est **dérivé d'un
  échantillon horodaté** (`hasSignal(now)`), jamais d'une intention.
- Sans données : refus explicite, message clair, **retour immédiat aux boutons
  tactiles** (jamais de course bloquée). Vérifié en conditions réelles de
  « pas de capteur » : Chromium sans capteur émet des `deviceorientation` à
  `beta/gamma` nuls — le jeu les ignore, échoue proprement et laisse les boutons.
- **Permission** : `DeviceMotionEvent.requestPermission()` est appelée sur le web
  quand elle existe (iOS/Safari) ; refus ⇒ message + boutons. Sur Android/Chrome
  il n'y a pas de prompt : on teste directement la présence de données.
- **Interruption** : au-delà de `GYRO_SIGNAL_TIMEOUT_MS = 1200 ms` sans échantillon
  (onglet gelé, capteur coupé, appareil posé), repli automatique sur les boutons +
  toast « capteur muet, retour aux boutons ».
- **Changement d'orientation** : `orientationchange`, `resize` et
  `visualViewport.resize` relisent l'angle d'écran ; l'inclinaison est recalculée dans le nouveau référentiel ; le volant est
  recadré sans saut.
- **Calibration** : bouton `RECALIBRER` (menu **et** pause) : la position actuelle
  du téléphone devient le zéro. `±35°` borné, persistée. Une calibration automatique
  est aussi faite au départ de chaque course quand le gyroscope est le mode actif.
- **Sens du gyro** : bouton `SENS DU GYRO : NORMAL / INVERSÉ` (certains joueurs
  inclinent dans l'autre sens) — persisté.

### 3.5 Persistance

Nouvelle clé, séparée du garage :
`turbokarts.v4.1.controls.v1` (`localStorage` web / `AsyncStorage` Android) :

```json
{ "steerMode": "gyro", "sensitivity": "normal", "throttleMode": "manual",
  "invertTilt": false, "calibration": -4.5 }
```

Lecture tolérante : JSON corrompu → valeurs par défaut ; calibration re-bornée à
±35° ; l'ancien booléen `storedInput` (V4.0) est migré s'il existe. Les clés du
garage et des Turbo Coins ne sont **jamais** touchées.

---

## 4. HUD, ergonomie et accessibilité

- Cluster haut-gauche : `TOUR 1/3`, `TEMPS`, `PLACE 6/6` — hiérarchie visuelle claire
  (chiffres > libellés), tailles en `clamp()`.
- **PAUSE** en haut-droite, 119 × 48 px, marge d'encoche respectée.
- **Vitesse** centrée en bas (`#speedo`, 223 × 78 px, chiffres tabulaires, ombre) :
  lisible sans regarder un coin ; ne masque pas les zones d'action.
- `TURBO PRÊT` / % + jauge de dérapage sous la vitesse ; pastille `GYRO` verte en
  haut à droite quand le capteur est réellement actif.
- Classement (`#places`) décalé sous le HUD haut, opacité 0,9, ne recouvre pas les
  obstacles centraux.
- Tous les boutons : `:focus-visible` (3 px, cyan), `aria-pressed` sur les bascules,
  `aria-label` sur les icônes, textes ≥ 8 px en `clamp` mais **libellés** en clair
  (`TIR`, `TURBO`, `FREIN`, `DÉRAPAGE`).
- Aucun effet graphique ajouté : le HUD est du DOM (web) / des `View` (Android).

---

## 5. Numéro de version

### 5.1 Centralisation

`src/core/version.ts` est la **seule** source de vérité :

| Élément | Valeur |
|---|---|
| `APP_VERSION_STRING` | `4.1.0` |
| `VERSION_LABEL` | `V4.1.0-dev` |
| `IS_DEV_BUILD` | `true` |
| `BUILD_FALLBACK_ID` | `sans-git` |
| `versionBadge()` | `V4.1.0-dev · Build 2bd9c14` |

- Le build est **dérivé du commit Git** : `tools/build-preview.mjs` lit
  `TKA_GIT_COMMIT` (CI) sinon `git rev-parse --short=7 HEAD`, et l'injecte via
  `define.__TKA_GIT_COMMIT__`. Sans dépôt (archive zip, APK hors git), le badge
  affiche `sans-git` — un identifiant **explicite**, jamais un faux hash.
- Repli runtime supplémentaire : `process.env.EXPO_PUBLIC_GIT_COMMIT` /
  `__TKA_GIT_COMMIT__` si présents (`globalThis` casté, pour rester compatible
  `tsconfig.preview.json`).

### 5.2 Où c'est affiché

1. **Menu principal**, en bas, discret : `V4.1.0-dev · Build 2bd9c14`.
2. **Diagnostics techniques** : la pause affiche `versionDiagnostics()`
   (version, canal, commit, hôte, FPS, qualité, particules, gyroscope, réglages).
3. Le rapport de builds (`preview:build`) journalise la même ligne.

### 5.3 Distinction développement / public

- `package.json` = `4.1.0-dev`, `app.json` = `4.1.0` + `versionCode 41` +
  `extra.appVersion`/`extra.gitCommit`.
- `IS_DEV_BUILD = true` ⇒ badge suffixé `-dev` et sous-titre
  « ARENA · V4.1 EN DÉVELOPPEMENT ».
- La V4.1.0 **n'est présentée nulle part comme une version publique stable** :
  la release `android-latest` reste `prerelease: true` et n'est publiée que sur
  dispatch manuel depuis `main` (aucune publication effectuée ici).

---

## 6. Fichiers modifiés / ajoutés

### Nouveaux

| Fichier | Rôle |
|---|---|
| `src/core/version.ts` | identité de version + build Git, badge, diagnostics |
| `src/core/controlSettings.ts` | modèle de réglages, clé de persistance, sanitisation, migration |
| `src/core/gyro.ts` | gravité → axes écran, `tiltDegrees`, presets, `TiltSteering` |
| `tools/tests-mission11.ts` | suite Node (15 sections, physique + géométrie + persistance + statique WebGL) |
| `tools/browser-mission11.mjs` | suite Playwright DOM/senseur (7 zones, multi-touch, gyro simulé, version) |
| `docs/MISSION-11-AUDIT-COMMANDES.md` | audit avant travaux |
| `docs/MISSION-11-V4.1.md` | ce document |
| `docs/v4.1-captures/*.png` | captures du nouveau HUD |

### Modifiés

| Fichier | Nature |
|---|---|
| `preview/main.ts` | modèle de commandes, turbo, gyro, calibration, HUD, `__tka`, libellés |
| `preview/index.html` | CSS HUD safe-area, clusters, boutons TURBO/GAZ, puces, badge version |
| `App.tsx` | même modèle côté Expo : `DeviceMotion`, `TiltSteering`, turbo, HUD, pause, version |
| `src/core/touchControls.ts` | `TouchAction` étendu (`turbo`, `accel`), compteur `accel` |
| `src/core/kart.ts` | entrée `turbo`, amortissement asymétrique, maîtrise de dérapage, verrouillage, réalignement de sortie |
| `src/core/config.ts` | constantes V4.1 (direction, dérapage, maîtrise) |
| `src/render/world.ts` | transmission de `turbo`, exposition `stats.turbo` |
| `package.json` | `4.1.0-dev`, script `test:mission11`, `test:browser:mission11` |
| `app.json` | `4.1.0`, `versionCode 41`, `extra` version+commit |
| `tools/build-preview.mjs` | résolution du commit, `define`, log de version |
| `.github/workflows/android-apk.yml` | exécution de `test:mission10`, `test:mission11`, du test navigateur V4.1 + artefact des captures |
| `index.html`, `service-worker.js` | reconstruits par `npm run preview:build` (bundle déployable) |

**Non modifiés (garantie de non-régression)** : `src/core/track.ts`,
`src/core/ai.ts`, `src/core/vehicles.ts`, `src/core/economy.ts`,
`src/render/*` hors `world.ts`, `src/core/materials.ts` (aucune allocation GPU
ajoutée — vérifié statiquement par `test:mission11` §15).

---

## 7. Résultats des tests

Tous exécutés dans cet environnement (Node 22, Chromium 131 software GL).

| Commande | Résultat |
|---|---|
| `npm run typecheck` (`tsc --noEmit` + `tsc -p tsconfig.preview.json`) | ✅ 0 erreur |
| `npm test` | ✅ **45 / 45** |
| `npm run test:v2` | ✅ **199 checks** |
| `npm run test:v3` | ✅ 12 circuits, 14 véhicules, safe-area 6 résolutions |
| `npm run test:v4` | ✅ 3 blocs OK |
| `npm run test:mission10` | ✅ perte silencieuse / signalée / 5 destructions ordonnées |
| `npm run test:mission11` | ✅ **Mission 11 terminée** (15 sections) |
| `npm run test:browser` | ✅ PASS (HUD, pause, `P`, auto-pause, multi-poigneurs, 0 erreur) |
| `npm run test:browser:android` | ✅ `"status": "PASS"`, `pageErrors: []` |
| `npm run test:browser:mission11` | ✅ **PASS** (7 zones, turbo, gaz, gyro simulé, version, captures) |
| `npm run preview:build` | ✅ `index.html` + `dist/turbo-karts-arena.html` (749 Ko) + PWA |

### 7.1 Les 15 vérifications demandées

| # | Vérification | Couverture | Résultat |
|---|---|---|---|
| 1 | Boutons gauche/droite | Node (géométrie) + navigateur (95 px, marges, `steer` ±1) | ✅ |
| 2 | Multi-touch | Navigateur : 4 pointeurs simultanés, libération indépendante | ✅ |
| 3 | Accélération automatique | Node + navigateur (`throttle = 1` en auto) | ✅ |
| 4 | Freinage | Node : 33 m/s → ≤ 0,9 m/s en < 45 m | ✅ |
| 5 | Dérapage | Node : paliers 0,62 / 1,35 / 2,15 s, boost, maîtrise | ✅ |
| 6 | Turbo | Navigateur : PRÊT/90 %, bouton → `isBoosting`, verrouillage 0,32 s | ✅ |
| 7 | Gyroscope on/off | Navigateur : activation (capteur simulé) puis désactivation explicite | ✅ |
| 8 | Calibration | Navigateur : `RECALIBRER` ⇒ `steer ≈ 0`, calibration persistée | ✅ |
| 9 | Sans permission / sans capteur | Navigateur : reste `DÉSACTIVÉ`, boutons visibles, course non bloquée | ✅ |
| 10 | Changement d'orientation | Node : 0/90/180/270° avec poses physiques (matrices) ; navigateur : angle réel | ✅ |
| 11 | Persistance | Node : clé dédiée, JSON corrompu, calibration bornée, migration booléen | ✅ |
| 12 | Affichage de version | Navigateur : `V4.1.0-dev · Build <sha7|sans-git>`, canal `dev` | ✅ |
| 13 | Course complète | `test:v2` (course IA de bout en bout) + navigateur (départ, tours, chrono) | ✅ |
| 14 | Victoire + retour au garage | `test:mission11` (course complète + économie) et `test:browser` (écrans, pause, reprise) | ✅ |
| 15 | Non-régression WebGL | `test:mission10`, `test:browser:android` (`PASS`), statique §15 | ✅ |

### 7.2 Simulé ≠ réel (à lire avant de conclure)

**Ce qui a été réellement vérifié** : le code s'exécute, les calculs sont justes, le
DOM se comporte comme attendu, les scènes 3D se dessinent (moteur logiciel), les
suites de non-régression passent, y compris les scénarios « perte de contexte WebGL ».

**Ce qui n'a *pas* été vérifié** : aucun téléphone physique n'était disponible dans
cet environnement.

- Les tests gyroscopiques utilisent des **événements simulés**
  (`new DeviceOrientationEvent('deviceorientation', { beta, gamma })`) avec des poses
  calculées pour l'angle d'écran réellement rapporté (Chromium mobile émulé annonce
  `angle === 90`). Le CDP `DeviceOrientation.setDeviceOrientationOverride` ne remplit
  pas `beta/gamma` ici — il n'est **pas** utilisé.
- Aucun APK n'a été compilé (pas de JDK/SDK Android, et consigne : éviter les builds
  répétitifs). La CI du dépôt produira l'APK de la PR.
- Les mesures de FPS/latence proviennent d'un rendu **logiciel** : elles ne disent
  rien de l'Adreno 830.

**Conclusion honnête** : la V4.1 est validée **en simulation**. La sensation de
conduite et la qualité du gyroscope doivent être confirmées au pouce, sur un
Samsung réel (§8).

---

## 8. Procédure de validation sur Samsung (Chrome Android)

1. Sur la branche, lancer `npm run preview:build`, puis servir `index.html` en
   **HTTPS** (ou sur `localhost` via `node tools/serve-preview.mjs`) : les capteurs
   d'orientation sont interdits en contexte non sécurisé.
2. Sur le téléphone : Chrome → l'URL → **Ajouter à l'écran d'accueil** (mode PWA),
   puis ouvrir **en paysage** (rotation automatique activée).
3. **Menu principal** → vérifier en bas `V4.1.0-dev · Build …` (noter le hash et le
   communiquer en cas de bug).
4. `ACCÉLÉRATION : AUTOMATIQUE` (défaut) → `COURSE`.
5. **Zone 1 — direction** : maintenir GAUCHE puis DROITE, enchaîner des
   changements rapides ; vérifier qu'un doigt qui glisse hors de la zone ne bloque
   pas la direction.
6. **Zone 2 — multi-touch** : pouce gauche sur DROITE, pouce droit sur DÉRAPAGE,
   puis ajouter TURBO avec l'index : les 3 doivent agir en même temps.
7. **Zone 3 — frein** : freiner à fond depuis la vitesse max ; vérifier l'arrêt
   sans tête-à-queue, puis la marche arrière à l'arrêt.
8. **Zone 4 — dérapage + maîtrise** : dérapage maintenu jusqu'au palier violet,
   tenir ~1 s, relâcher : flash « MAÎTRISE + » attendu, boost plus long.
9. **Zone 5 — turbo** : vérifier `TURBO 0 %` au départ, la montée en dérapant,
   `TURBO PRÊT` + pulsation, puis l'appui : poussée immédiate, état `ACTIF`.
10. **Zone 6 — gyroscope** : pause → `GYROSCOPE : ACTIVÉ`. Si Chrome demande
    l'autorisation « Mouvement et orientation », accepter. Tenir le téléphone
    naturellement → `RECALIBRER` → vérifier que le kart va droit.
    Incliner à droite → le kart tourne à droite (sinon `SENS DU GYRO : INVERSÉ`).
    Tester `DOUX` / `NORMAL` / `SPORT` : le sport doit être nettement plus nerveux.
11. **Zone 7 — capteur indisponible** : dans Chrome Android,
    `chrome://flags` → désactiver les capteurs de mouvement (ou refuser la
    permission), relancer : le jeu doit afficher `GYROSCOPE : DÉSACTIVÉ`, garder les
    boutons tactiles et **la course doit rester jouable**.
12. **Orientation** : tourner le téléphone en portrait puis revenir en paysage
    pendant la course ; la direction doit rester cohérente (pas d'inversion).
13. **Persistance** : quitter l'app, la rouvrir → mode gyroscope, sensibilité et
    mode d'accélération conservés ; les **Turbo Coins et le garage** inchangés.
14. **Pause / HUD** : bouton PAUSE accessible au pouce, diagnostics lisibles
    (version, FPS, qualité, état gyro), reprise sans remise à zéro du chrono.
15. **Fin de course** : victoire → écran de résultats → retour garage ; rien ne doit
    rester figé, aucune erreur console (`chrome://inspect`).

> Critère d'acceptation : 60 FPS stables sur Côte Solaire (qualité Auto), aucune
> régression par rapport à la mission nº10 (pas de perte de contexte, pas d'image
> noire après un retour d'arrière-plan).

### Limites connues du gyroscope

- **Ce n'est pas un volant absolu** : c'est une inclinaison relative à la
  calibration. Il faut recalibrer après avoir changé de position (assis/debout,
  en voiture). C'est pour cela que `RECALIBRER` est accessible **en pause**.
- **Téléphone à plat** (posé sur une table, ou tenu écran vers le plafond) : plus
  d'axe de gravité dans le plan → braquage 0 (volontaire, sinon oscillation).
- **Dérive lente** : l'accéléromètre seul ne compense pas le lacet ; un long virage
  peut demander un micro-recalibrage. La calibration automatique au départ limite
  le problème.
- **Pas de retour de force ni de position** : impossible de « sentir » la butée,
  contrairement à un vrai volant.
- **Latence variable** : de 8 à 30 ms selon les appareils ; le lissage masque la
  gigue mais ajoute ~50 ms de retard perceptible en Sport.
- **Chrome exige HTTPS/localhost** et peut demander une permission ; Firefox
  Android et certains navigateurs intégrés (WebView d'applications) ne fournissent
  aucune donnée → repli automatique.
- **Bruit magnétique / coques métalliques** : peuvent fausser `alpha` (sans effet
  ici) et, plus rarement, `beta`.
- Sur **Android natif (Expo)**, c'est `DeviceMotion.rotation` qui est utilisé
  (mêmes formules) ; la disponibilité dépend du capteur fusionné du téléphone et
  `DeviceMotion.requestPermissionsAsync` n'existe pas sur Android (aucune
  permission à demander).

---

## 9. Non-régression

- **Circuits / véhicules / pilotes** : intacts (`test:v3` : 12 / 14 ; `test:v2` :
  course complète IA sur chaque circuit).
- **Économie** : clé `turbokarts.v3.garage.v1` non modifiée ; achat/amélioration
  couverts par `test:browser:v2` ; la V4.1 n'ajoute **aucun** coût.
- **WebGL (missions 9 & 10)** : aucune allocation ajoutée, `dispose()` ordonné
  conservé, aucun post-traitement supplémentaire ; `test:mission10` et
  `test:browser:android` (contexte perdu, rotation, shaders en échec, module non
  téléchargé) restent verts.
- **Physique** : mêmes équations ; seuls des **paramètres** de direction/dérapage ont
  changé (+ un bonus de maîtrise optionnel).

## 10. Hors périmètre (assumé)

- Aucun nouveau circuit, véhicule, personnage ou mode de jeu (pas de V4.2).
- Pas de refonte audio (le son n'existe pas encore).
- Pas de refonte de l'IA ni des collisions.
- Pas de merge, pas de publication, pas d'APK manuel.
