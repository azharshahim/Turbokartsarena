# Mission nº11 — Audit des commandes existantes (état V4.0 → `2bd9c14`)

> Document d'audit réalisé **avant** toute modification, sur la base `main` au commit
> `2bd9c14d27d033015b0476cedf70e28b562bf56e` (dernier PR fusionné : nº8).
> Objectif : lister ce qui fonctionne, ce qui gêne le joueur, et ce qui doit être
> conservé tel quel. Les mesures « après » sont dans
> [MISSION-11-V4.1.md](MISSION-11-V4.1.md).

## 1. Méthode

1. Lecture du code des deux hôtes pour un même moteur : `App.tsx` (Android, Expo) et
   `preview/main.ts` + `preview/index.html` (navigateur, aussi livré en PWA).
2. Lecture des modules partagés : `src/core/touchControls.ts`, `src/core/kart.ts`,
   `src/core/config.ts`, `src/render/world.ts`.
3. Exécution des suites existantes (`npm test`, `test:v2`…`test:mission10`,
   `test:browser`, `test:browser:android`) pour distinguer « bug » et « choix assumé ».
4. Mesures réelles des zones tactiles au navigateur, viewport **915 × 412 @2×**
   (paysage Android type Pixel/Samsung, barre de navigation exclue).
5. Aucune validation sur téléphone physique n'a été possible dans cet
   environnement (voir §6 : ce qui reste à faire sur un Samsung réel).

## 2. État initial, commande par commande

### 2.1 Direction (`#leftBtn` / `#rightBtn`, `touchPointers.steer`)

| Constat | Détail |
|---|---|
| Deux boutons ronds de **96 × 96 px**, collés à gauche | Corrects, mais `margin-right: 12px`, sans `safe-area` sur la taille (uniquement via le padding du conteneur). |
| Suivi multi-touch | Bon : `Pointer Events` + `setPointerCapture`, une carte `pointerTargets` par `pointerId`. **À conserver absolument.** |
| Conflit possible | Le doigt qui glisse d'un bouton à l'autre sans relâcher ne change pas de direction. |
| Retour au centre | Aucun amortissement côté entrée : `steer` passe de −1 à +1 instantanément (le lissage n'était que dans la physique), d'où des à-coups. |
| Clavier | `← →`, `Q/D`, `A/D` — fonctionnel. |

### 2.2 Accélération

| Constat | Détail |
|---|---|
| Accélérateur | **Câblé en dur** : `throttle: 1` dans la boucle de course, dans `clearHeldInputs`, dans `restartRace`, dans `App.tsx` (`setInput({ …, throttle: 1 })`). |
| Conséquence | Le joueur ne module jamais sa vitesse : impossible de lever le pied dans un virage serré, seule la touche FREIN agit (et elle freine *tout en gardant les gaz*). |
| Défaut classé | **P1 — sensation de conduite**. C'est le principal frein au « fun » : la voiture est un train sur rails. |

### 2.3 Freinage

| Constat | Détail |
|---|---|
| Bouton FREIN | 104 × 104 px, rouge, libellé « FREIN » lisible. |
| Clavier | `↓` / `S`. |
| Comportement | Frein **et** marche arrière confondus : à l'arrêt, maintenir FREIN fait reculer. Utile, mais l'état n'est jamais signalé au joueur. |
| Défaut classé | **P2 — lisibilité** (pas bloquant). |

### 2.4 Dérapage

| Constat | Détail |
|---|---|
| Bouton DÉRAPAGE | 104 × 104 px, bleu, à droite. |
| Paliers | 3 (bleu / orange / violet), boost 0,8 / 1,3 / 1,9 s, plafond 2,6 s. |
| Turbo | **Automatique** : il partait au relâchement du dérapage. Il n'existait aucun bouton TURBO, donc aucune décision du joueur, donc aucune sensation de récompense. |
| Maîtrise | Aucune : tenir le palier violet 2 s ou 0,2 s donnait le même boost. |
| Grattage | `scrub` élevé : le dérapage coûtait cher en vitesse, alors qu'il est censé être l'outil des virages rapides. |
| Défaut classé | **P0 — cœur du plaisir de jeu** (arcade). |

### 2.5 Turbo

| Constat | Détail |
|---|---|
| Affichage | Jauge `#driftMeter` sous la vitesse + libellé « TURBO PRÊT » conditionnel. |
| Manque | Aucun état « disponible / actif / en recharge » lisible d'un coup d'œil ; aucun moyen de déclencher le turbo à la demande ; aucun retour visuel « punchy » (les particules existaient, le HUD non). |
| Défaut classé | **P0**. |

### 2.6 Gyroscope — le point le plus défaillant

| Constat | Détail |
|---|---|
| Commande | Un unique bouton `#inputToggle` affichant `📱 Gyroscope` / `⌨️ Boutons / clavier`, mémorisé dans un **booléen** `storedInput`. |
| Mesure | `gyro.angle` provenait d'un `atan2` sur les **vitesses** de rotation (`event.gamma * 1.6` sur le web, `y/z` d'`expo-sensors Gyroscope` sur Android) : ce n'est pas une inclinaison, c'est un **débit**, donc un volant qui ne tient pas sa position. |
| Gain | Fixe (×3,2), aucune zone morte, aucun filtrage. Micro-tremblements amplifiés, dérive permanente. |
| Calibration | Aucune commande : `rest` était réinitialisé à chaque `clearHeldInputs` (donc à chaque pause, perte de focus, changement d'onglet). |
| Orientation d'écran | **Ignorée** : en paysage, l'axe horizontal du téléphone n'est pas `gamma`. Le sens de braquage pouvait s'inverser. |
| Perte de capteur | Aucune détection : après un refus de permission, un capteur absent ou un onglet gelé, le bouton **continuait d'afficher « Gyroscope »** et les boutons tactiles restaient masqués (`body.gyro-on`). **Le jeu devenait injouable.** |
| Permission | Aucun appel à `DeviceMotionEvent.requestPermission()` (iOS/Safari) ; sur Android/Chrome, aucun message si le capteur est absent. |
| Défaut classé | **P0 — bloquant**, contraire à l'exigence « l'état affiché doit correspondre à la réalité ». |

### 2.7 Zones tactiles et ergonomie

| Constat | Détail |
|---|---|
| Barre de commandes | `#controls` : hauteur fixe **190 px** collée en bas, `pointer-events: none` sur le conteneur (bonne pratique conservée). |
| Tailles | Direction 96 px, actions 104 px — confortables, mais **fixes** : sur un écran de 412 px de haut, 104 px = 25 % de la hauteur. |
| Minimap | 132 × 132 px à `left: 18px; bottom: 22px` → **sous les boutons de direction** (qui occupent 96 px + 14 px de marge). Recouvrement effectif, et le tracé devient illisible car il passe sous les pouces. |
| Bords | `padding` avec `env(safe-area-inset-*)` sur le conteneur, mais `#places` et le HUD haut n'avaient pas de marge sûre ; le bouton PAUSE était à `top: 12px` sans tenir compte de l'encoche en paysage. |
| Chevauchement des actions | FREIN et DÉRAPAGE étaient **côte à côte** avec 12 px d'écart : impossible de maintenir l'un et de presser l'autre avec le même pouce sans ambiguïté. |
| Retour visuel | `transform: scale(0.93)` + `brightness` — correct, conservé. |
| Défaut classé | **P1**. |

### 2.8 HUD de course

| Constat | Détail |
|---|---|
| Présent | Vitesse (34–56 px), tour, chrono, place, classement, meilleur tour, minimap, jauge de dérapage. |
| Manque | Pas de lisibilité hiérarchisée (tout au même niveau), pas d'état du turbo, pas de numéro de version, `#speedo` collé au bord bas (`bottom: 6px`) donc sous la barre de gestes Android sur certains appareils. |
| Défaut classé | **P2**, sauf la version : **P1** (traçabilité des rapports de bug). |

### 2.9 Sauvegardes et économie

| Constat | Détail |
|---|---|
| Garage / Turbo Coins | `turbokarts.v3.garage.v1` (web `localStorage`, Android `AsyncStorage`). Fonctionne, testé (`test:v2`, `test:browser:v2`). **Ne pas toucher.** |
| Réglages | Seul un booléen `storedInput` était mémorisé : ni sensibilité, ni calibration, ni mode d'accélération. |
| Défaut classé | **P1** (réglages perdus à chaque session). |

### 2.10 Numéro de version

| Constat | Détail |
|---|---|
| `package.json` | `3.0.0-dev` alors que le code estampille « V4 ». |
| UI | `A R E N A · V4 EN DÉVELOPPEMENT` en dur dans le HTML, aucune information de build. |
| Android | `app.json` : `3.0.0` / `versionCode` obsolète. |
| Défaut classé | **P1** — impossible de savoir quelle version tourne sur le téléphone du joueur. |

### 2.11 Android (Expo) vs navigateur

| Point | Android (`App.tsx`) | Navigateur (`preview/`) |
|---|---|---|
| Direction | `TouchHud` : zones rectangulaires gauche/droite, `onZoneRect` mesuré au layout | boutons ronds, `Pointer Events` |
| Accélération | `throttle: 1` en dur | `throttle: 1` en dur |
| Gyroscope | `expo-sensors` **Gyroscope** (débit de rotation) | `deviceorientation` + `gamma * 1.6` |
| Capteur absent | `isAvailableAsync` non utilisé → écran sans direction | idem, boutons masqués |
| Pause | bouton dédié + auto-pause sur `AppState` | `P`/`Échap` + auto-pause sur `visibilitychange` |
| Différence notable | le tactile Android passe par des `View` `onTouchStart` (pas de multi-poigneurs capturés) → appuis simultanés moins fiables que les `Pointer Events` du web |

## 3. Synthèse des défauts (avant)

| # | Défaut | Gravité | Effet joueur |
|---|---|---|---|
| 1 | Gyroscope annoncé actif sans données, boutons masqués | **P0** | course injouable, aucun recours |
| 2 | Turbo automatique, aucune décision, aucun état lisible | **P0** | dérapage sans intérêt |
| 3 | Accélérateur figé à 100 % | **P1** | conduite « sur rails » |
| 4 | Dérapage trop punitif (grattage élevé), aucune maîtrise | **P0** | on évite le dérapage |
| 5 | FREIN/DÉRAPAGE côte à côte, conflits de pouce | **P1** | appuis ratés en course |
| 6 | Minimap sous les boutons de direction | **P1** | trajectoire illisible |
| 7 | Aucun réglage mémorisé hors mode de direction | **P1** | re-réglage à chaque session |
| 8 | Version incohérente (`3.0.0-dev` vs « V4 ») | **P1** | support impossible |
| 9 | Marche arrière non signalée | **P2** | apprentissage par essai |
| 10 | `#speedo` sous la barre de gestes | **P2** | vitesse partiellement masquée |

## 4. Ce qui fonctionnait et a été conservé

- **Suivi multi-touch par `pointerId`** avec `setPointerCapture`, libération
  indépendante et `touchcancel` → repris tel quel, étendu à deux nouveaux boutons.
- **Retour visuel d'appui** (scale + brightness) et `:focus-visible` clavier.
- **Pause** : bouton, `P`/`Échap`, auto-pause sur perte de focus, reprise sans
  remise à zéro du chrono (validé par `test:browser`).
- **Modèle physique** : aucun réécriture. Rapport de direction, adhérence,
  collisions, paliers de dérapage, IA, classement : inchangés dans leur logique.
- **Sauvegarde garage / Turbo Coins** (`turbokarts.v3.garage.v1`) : format et clés
  intacts.
- **Corrections WebGL des missions 9 & 10** : perte de contexte, `dispose()` ordonné,
  budgets GPU, HDR/tone-mapping — aucune allocation ajoutée (vérifié par
  `test:mission11` §15 et `test:browser:android`).
- **Titres, circuits, véhicules, pilotes** : aucun contenu supprimé (12 circuits,
  14 véhicules, 8 pilotes — vérifié par `test:v3`).

## 5. Contraintes déduites de l'audit

1. Toute nouvelle commande doit rester **Pointer Events** (le tactile Android natif
   devra suivre le même modèle côté `App.tsx`).
2. Le gyroscope doit être **piloté par l'orientation** (gravité projetée sur les axes
   de l'écran), jamais par un débit de rotation.
3. L'état affiché doit être **dérivé d'un échantillon réellement reçu** (horodatage),
   avec repli automatique.
4. Les réglages doivent être **persistés séparément** du garage, avec migration de
   l'ancien booléen.
5. Aucun ajout de rendu GPU : le HUD est du DOM (web) / du `View` (Android).

## 6. Ce que cet audit ne couvre pas

- **Validation sur téléphone physique** : aucune. Les mesures ci-dessus proviennent
  de Chromium (moteur logiciel) et de la lecture du code. Les latences réelles du
  capteur d'un Samsung Galaxy (Adreno 830), le comportement sous One UI et la
  position exacte de la barre de gestes restent à vérifier — procédure au §7 de
  [MISSION-11-V4.1.md](MISSION-11-V4.1.md).
- **Manettes HID**, **audio** : hors périmètre de cette étape.
