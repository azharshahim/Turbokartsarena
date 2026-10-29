# Turbo Karts Arena

Jeu de course de karts et de motos arcade 3D, **100 % original**, pour Android (Expo / React Native + three.js).
Version 2.0 : huit circuits, douze pilotes, quatre karts, quatre motos et cinq adversaires IA.
Paysage, qualité graphique adaptative et PWA hors connexion. Les performances réelles dépendent de l’appareil.

Voir [le dossier de revue V2](docs/V2.md) pour les nouveautés, les validations et la procédure Android.

> Ce dépôt contient **deux hôtes pour un seul moteur** :
>
> | Hôte | Entrée | Rôle |
> |---|---|---|
> | App Android (Expo, `expo-gl`) | `App.tsx` | Livrable principal |
> | Preview navigateur | `preview/main.ts` | Même moteur, jouable immédiatement, sert de banc d'essai |
>
> Toute la logique de jeu vit dans `src/` et est partagée : **aucune règle de gameplay n'est dupliquée**.

---

## 1. Démarrage rapide

### Installation Android depuis Chrome (PWA)

La version web inclut le manifeste, les icônes PNG et un service worker pour le
mode hors connexion. Voir [installation et validation PWA](docs/PWA.md) pour
les fichiers à héberger en HTTPS, les tests et les vérifications sur téléphone.

### Preview jouable (aucune installation)

```bash
open dist/turbo-karts-arena.html      # fichier unique, fonctionne hors ligne
```

ou, pour développer avec le rechargement à chaud :

```bash
npm run preview:build     # compile preview/dist + dist/*.html
npm run preview:serve     # http://localhost:5173/preview/dist/index.html
```

> La preview est un fichier HTML autonome (≈ 620 Ko, JS inline, zéro requête réseau) :
> elle s'affiche même dans une iframe sandboxée.

### Application Android

```bash
npm install
npx expo start --android        # appareil / émulateur
# ou
npx expo run:android            # build natif local (nécessite Android SDK)
eas build -p android --profile preview   # APK via EAS
```

L'app utilise `expo-gl` (contexte OpenGL natif) : le moteur lui rend le même
framebuffer, puis appelle `gl.endFrameEXP()` à chaque frame.

---

## 2. Commandes

| Action | Clavier (preview) | Tactile (Android) | Gyroscope |
|---|---|---|---|
| Accélérer | **automatique** | automatique | automatique |
| Diriger | `←` `→` (ou `Q`/`D`) | boutons ‹ › | incliner l'appareil |
| Dérapage | `Espace` / `Maj` | bouton DÉRAPAGE | — |
| Freiner / marche arrière | `↓` (ou `S`) | bouton FREIN | — |
| Pause | `P` / `Échap` | bouton ⏸ | — |

**Accélération automatique** : le kart accélère seul. En tactile paysage, le pouce gauche
maintient GAUCHE/DROITE et le droit peut maintenir FREIN/DÉRAPAGE simultanément.
PAUSE suspend la simulation (et reprend sans réinitialiser chrono ou tour) ; `P` et
`Échap` font la même chose sur clavier. Une perte de focus / un changement d'onglet
met automatiquement la course en pause. En portrait sur le web, un rappel invite à
tourner l'appareil. Le dérapage maintenu dans un virage charge la jauge
<span>bleu → orange → violet</span>, puis son relâchement convertit la charge en turbo.

---

## 3. Architecture

```
src/
├── core/                 moteur de jeu — TypeScript pur, testable sans navigateur
│   ├── config.ts         tous les réglages de « feeling » + paliers de qualité
│   ├── math.ts           maths sans allocation, bruit de valeur, RNG déterministe
│   ├── track.ts          spline fermée, largeur variable, dévers, requêtes O(1)
│   ├── kart.ts           physique du kart, dérapage/turbo, collisions
│   ├── ai.ts             pilotes IA (anticipation de courbure + profil de vitesse)
│   ├── hazards.ts        dangers dérivés du tracé, avertissements et placement des panneaux
│   └── race.ts           tours, classement, événements, pas fixe 120 Hz
├── game/
│   ├── roster.ts         12 pilotes originaux (archétypes + silhouettes)
│   ├── circuits.ts       8 circuits + palettes / ambiances
│   └── vehicles.ts       véhicules indépendants des pilotes et niveaux de difficulté
├── render/               three.js
│   ├── world.ts          moteur partagé Android ↔ web (caméra, LOD, résolution adaptative)
│   ├── trackMesh.ts      ruban de route, vibreurs, lignes, plaques de turbo, barrières
│   ├── models.ts         matériaux partagés et décor
│   ├── vehicles.ts       huit modèles détaillés, roues animées et pilotes articulés
│   ├── roadside.ts       panneaux, glissières, tunnels, viaducs, trafic et pluie
│   ├── showroom.ts       garage 3D partagé navigateur / Android
│   ├── sky.ts            skybox HDR procédurale + environnement PBR préconvolué
│   ├── particles.ts      systèmes de particules en pooling (1 draw call chacun)
│   ├── postfx.ts         bloom, flou radial, aberration, lignes de vitesse, FXAA
│   └── textures.ts       textures 2K procédurales (albedo + normal + roughness)
└── ui/icons.tsx          icônes SVG inline (aucune police externe)
```

### Boucle de jeu

```
hôte (rAF / expo-gl)
  └─ engine.frame(t)
       ├─ Race.update(dt)            ← accumulateur, pas fixe 1/120 s (max 8 pas/frame)
       │    ├─ entrées joueur / IA
       │    ├─ Kart.step()           ← physique, piste, dérapage, turbo, respawn
       │    ├─ resolveKartCollisions() ← impulsion + masses
       │    └─ tours, classement, événements (particules, HUD…)
       ├─ syncKarts()                ← transform visuel + LOD + particules
       ├─ updateCamera()             ← caméra amortie, FOV dynamique, tremblement
       ├─ postfx.render()
       └─ adaptResolution()          ← résolution dynamique
```

---

## 4. Le moteur de conduite (le cœur du travail)

### Modèle physique

Modèle **arcade à dérive latérale amortie** plutôt qu'une simulation de pneus :

* le kart a une vitesse longitudinale `vf` et latérale `vl` dans son repère ;
* l'adhérence amortit `vl` selon la surface (`gripRoad`, `gripDrift`, `gripDirt`) ;
* le lacet est cybernétique : le taux de rotation cible dépend de la vitesse, avec
  une perte d'autorité à haute vitesse (arcade, pas réaliste) ;
* un plafond d'angle de dérive évite les tête-à-queue sur l'herbe.

Réglages clés (dans `src/core/config.ts`, tous modifiables) :

| Paramètre | Valeur | Effet |
|---|---|---|
| `maxSpeed` | 42 m/s (151 km/h) | vitesse de pointe |
| `accel` | 16 m/s² | 0 → 100 km/h en ~2,6 s |
| `gripRoad` / `gripDrift` | 9,2 / 2,35 | adhérence / glisse volontaire |
| `turnRate` | 2,35 rad/s | agilité |
| `brakeDecel` | 48 m/s² | freinage franc |

### Dérapage et les 3 turbos

```
        maintien du dérapage + braquage dans le virage
charge ──▶ 0,62  ──▶ 1,35  ──▶ 2,15
palier      bleu      orange     violet
boost       +20 %     +29 %      +40 % de vitesse max, 0,8 / 1,3 / 1,9 s
```

* la charge monte avec la **durée**, l'**angle de braquage** et la **vitesse** ;
* relâcher (ou freiner) déclenche une **impulsion immédiate** (+2,6 à +7 m/s) :
  c'est le « coup de pied » qui rend le turbo satisfaisant ;
* un nouveau dérapage pendant un boost **prolonge** le turbo (facteur 0,85) ;
* les plaques au sol déclenchent un boost de piste indépendant.

Temps mesurés par les tests : bleu 0,44 s · orange 0,84 s · violet 1,30 s.

### Piste

* spline **Catmull-Rom centripète** fermée (pas de boucles ni de pointes) ;
* **lissage Laplacien** + **limiteur de courbure** garantissant des rayons ≥ ~12 m ;
* ré-échantillonnage à pas constant (2 m) → requêtes `s` / `lateral` en O(1) par
  fenêtre glissante autour de l'index courant ;
* largeur variable (les épingles s'élargissent), dévers dans les virages ;
* surfaces : route, vibreur, herbe, plaque de turbo ;
* zones de réapparition automatiques (immobile 2,6 s ou hors piste 5,5 s) ;
* largeur demandée augmentée de **25 %** sur les trois circuits. `TrackSample.halfWidth`
  reste l'unique source pour la chaussée, les bordures, la surface/limite hors-piste,
  l'IA et le placement du décor. Dans les épingles, un plafond par rayon intérieur
  limite l'élargissement pour garder 1,8 m d'espace intérieur quand la largeur historique le permet ;
  les lignes, dénivelés, contrôles et grille de départ restent inchangés.

### IA

Contrôleur en trois termes, réglé par une **calibration automatique**
(`tools/sweep8.ts` balaie les gains et note chaque combinaison sur des courses
complètes ; `tools/lc.ts` vérifie la courbure réelle de chaque circuit) :

1. **anticipation de courbure** `cap visé += ffGain·κ·v` (stable à haute vitesse) ;
2. **correction de cap** (gain fort) ;
3. **correction latérale** bornée par `atan` (rattrapage doux).

S'y ajoutent un **profil de vitesse** (`v_entrée = √(v_virage² + 2·a·d)`, qui fait
freiner *avant* le virage), le dérapage opportuniste, l'évitement des karts
devant, la visée des plaques et un rubber-band pour l'équilibre.

Résultats mesurés : 3 tours bouclés sur les 3 circuits, 0 blocage,
**80–92 % du temps sur la piste**, temps au tour 32–41 s (mesuré par `tools/t_seed.ts`).

### Collisions

Cercles + impulsion avec restitution 0,42, séparation pondérée par la masse
(`teo` 0,82 ↔ `iron` 1,35), petit couple de rotation et « bump » visuel.
O(n²) avec n ≤ 8 karts : négligeable.

---

## 5. Rendu

### Matériaux et textures

* **PBR** : albedo + normal map + roughness map sur tous les matériaux de surface ;
* textures **procédurales** générées au chargement (asphalte, herbe, sable, béton,
  peinture métallisée, vibreur bicolore, métal, fumée, halo) : dépôt autonome,
  100 % tuilables, et résolution adaptée au palier (256 / 512 / 1024) ;
* normales dérivées de la hauteur par différences finies (bords tuilables) ;
* environnement **HDR préconvolué (PMREM)** généré depuis la skybox → reflets
  cohérents sur la carrosserie, les visières et le chrome, sans fichier .hdr.

### Éclairage

* soleil directionnel avec **ombres douces PCF** (carte 512/1024/2048 selon le palier),
  qui **suit le joueur** pour garder une bonne densité de texels ;
* hémisphérique coloré par circuit + lumière d'appoint neutre ;
* ACES Filmic + exposition par circuit ; murs néon, balises et plaques de turbo en
  luminance > 1 pour alimenter le bloom.

### Post-traitement

Chaîne `RenderPass → Bloom → [passe maison] → OutputPass → FXAA` :

* **bloom** UnrealBloom (seuil 0,82 : seules les vraies zones HDR débordent) ;
* **flou de mouvement radial** (6 taps pondérés vers le point de fuite) ;
* **aberration chromatique** radiale proportionnelle à la vitesse ;
* **lignes de vitesse** procédurales (bandes angulaires additives) ;
* **vignette** + flash de turbo teinté selon le palier ;
* étalonnage (contraste / saturation) puis tone mapping ACES et conversion sRGB.

Le render target du composer est en **HalfFloat** (obligatoire pour un bloom correct) ;
l'anticrénelage est assuré par **FXAA** (le MSAA matériel sur cible HalfFloat est
mal supporté par plusieurs pilotes mobiles).

### Particules

5 systèmes (`fumée`, `étincelles`, `poussière`, `éclaboussures`, `confettis`),
chacun en **un seul `THREE.Points`** et **un seul appel de dessin**, avec des
tableaux typés pré-alloués : **zéro allocation à l'exécution**, recyclage circulaire,
budget piloté par le palier de qualité (180 / 900 / 2200 particules).

---

## 6. Performance (objectif 60 FPS)

| Levier | Implémentation |
|---|---|
| **Pas fixe découplé du rendu** | 120 Hz de simulation, jusqu'à 8 pas/frame |
| **Résolution dynamique** | ratio de pixels ajusté dans `[0.62 … ×3]` selon la moyenne des frames, jusqu'à la résolution native |
| **LOD karts** | silhouette simplifiée au-delà de 42 m (26 m en qualité basse) |
| **InstancedMesh** | végétation, foule, barrières, pneus, balises néon |
| **Post-traitement fondu** | 1 seule passe maison plein écran |
| **Pooling** | particules, matériaux et géométries partagés ; aucun `new` dans la boucle chaude |
| **Budget textures** | 256 / 512 / 1024 selon le palier, mipmaps + anisotropie 2/4/8 |
| **Culling** | `frustumCulled = false` uniquement sur les objets globaux (ciel, particules) |

### Paliers de qualité

| | Basse | Haute | Ultra |
|---|---|---|---|
| Résolution max | 0,79 Mpx | 1,7 Mpx | 3,1 Mpx |
| Ombres | ✗ | 1024 | 2048 |
| Bloom | ✗ | 0,55 | 0,80 |
| Flou / aberration | ✗ / ✗ | ✓ / ✓ | ✓ / ✓ |
| Particules | 180 | 900 | 2200 |
| Végétation | 60 | 220 | 420 |
| Distance de vue | 260 m | 420 m | 600 m |

**Détection automatique** (`autoQuality`) : croise le nom du GPU
(`Mali-4xx/T7xx`, `Adreno 3xx/4xx`, `PowerVR SGX` → basse ; `Adreno 6xx+`,
`Immutalis`, `Apple A14+` → ultra), la RAM (`deviceMemory` / `totalMemory`) et le
nombre de cœurs. L'utilisateur peut forcer un palier dans les réglages.

### Compression ASTC

Les textures du jeu sont **procédurales** (aucun PNG dans le bundle), donc rien à
compresser par défaut. Pour tout asset binaire ajouté dans `assets/` :

```bash
brew install astcenc                 # ou binaire ARM
node tools/compress-astc.mjs         # 6×6, qualité 6 → assets/astc/ + manifeste
```

---

## 7. Qualité visuelle : ce qui est fait / limites assumées

| Demandé | État |
|---|---|
| Style 3D coloré semi-réaliste | ✅ modèles procéduraux stylisés (karts, pilotes, arbres, tribunes) |
| Matériaux PBR (albedo/normal/roughness) | ✅ partout, avec environnement HDR |
| Textures 2K (4K karts/persos) | ⚠️ **procédurales**, 256–1024 selon le palier. Passer en 2K/4K est un réglage (`textureSize`) mais coûte cher en chargement/rAM ; voir §9 |
| Éclairage dynamique, ombres douces, reflets | ✅ soleil PCF, PMREM, lumière d'appoint |
| Skybox HDR par circuit | ✅ skybox rayon-marchée HDR (pas de fichier .hdr externe) |
| Bloom, flou de mouvement, aberration, lignes de vitesse | ✅ |
| Particules (fumée, étincelles, poussière, éclaboussures) | ✅ + confettis |
| Résolution dynamique jusqu'au natif | ✅ |
| 3 niveaux de qualité + détection appareil | ✅ |
| Textures compressées ASTC, LOD, pooling | ✅ outil + LOD + pooling ; ASTC sur les assets externes |

**Limites honnêtes** :

* les modèles sont **procéduraux stylisés**, pas des GLB sculptés : le rendu est
  propre et coloré, mais pas « AAA ». Le chemin d'ajout de GLB est décrit ci-dessous ;
* le post-traitement et le flou radial ont été validés sur SwiftShader (CPU) dans
  le bac à sable — le pipeline est standard, mais **les 60 FPS doivent être
  mesurés sur appareil réel** (le HUD affiche FPS / particules / ratio de rendu) ;
* l'audio n'est pas encore implémenté (voir feuille de route).

---

## 8. Tests

```bash
npm test                 # tests moteur / géométrie / IA sur les huit circuits
npm run test:v2          # matrice circuits/véhicules, physique moto, modèles et panneaux
npm run test:browser     # scénarios Playwright pause, commandes, orientation et console
npm run test:browser:v2  # garage, pilotes, huit véhicules/circuits et budget de rendu
npm run test:pwa         # installation, hors connexion et mises à jour du cache
npm run typecheck        # vérifie les types React Native + preview
npx expo export --platform android --output-dir /tmp/tka-android-export  # bundle Expo Android
```

Couvre : convention d'axes (verrouillée — c'est le bug le plus vicieux du projet),
géométrie des 3 pistes (rayons jouables, pas d'auto-intersection, déterminisme),
accélération 0-100, vitesse de pointe, freinage, marche arrière, les 3 paliers de
dérapage, la récompense du turbo, le plafond de vitesse, les collisions (dont
l'influence de la masse), une course complète en IA sur les 3 circuits (3 tours,
pas de blocage, temps au tour cohérents), le classement, le compte à rebours,
le formatage des temps, la détection de qualité et l'équilibrage du casting.
`npm run test:browser` utilise Playwright/Chromium : lance `npx playwright install chromium`
si le navigateur n'est pas encore installé.

**Conventions verrouillées par les tests** (source de bugs historiques) :

```
forward = (sin h, cos h)        right = forward × up = (−cos h, sin h)
⇒ h croissant = virage à GAUCHE
⇒ input.steer = +1 = DROITE à l'écran
⇒ curvature > 0 = virage à GAUCHE ; lateral > 0 = à DROITE
⇒ corde d'un virage à gauche = lateral > 0
```

---

## 9. Feuille de route

1. **Audio** : moteur (WebAudio/expo-av) avec pitch lié au régime, crissements,
   impacts, compte à rebours, musique par circuit.
2. **Assets GLB haut de gamme** : remplacer les karts procéduraux par des modèles
   sculptés + textures 2K/4K ASTC (le `KartModel` est déjà une façade isolée).
3. **Multijoueur** : la simulation à pas fixe et déterministe est prête pour un
   netcode « input-delay » (les `RaceEvent` sont déjà sérialisables).
4. **Mode carrière** : coupes, déblocages, réglages de kart.
5. **Manette** : le mappage clavier est prêt, ajouter le HID Android.
6. **Réglage fin des 60 FPS** sur une matrice d'appareils réels.

---

## 10. Crédits et originalité

Univers, noms, palettes, tracés et modèles sont **originaux** et créés pour ce
projet : Nova Vex, Bram Krugg, Suki Marlow, Teo Rask, Mara Iron, Glint, Hex Duval,
Zera Kwon ; les circuits Côte Solaire, Canyon Écarlate et Néon Nuit.
Aucune référence, asset, nom ou mécanique déposée d'une franchise existante.
