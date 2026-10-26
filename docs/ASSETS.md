# Assets : pipeline, génération et compression

Turbo Karts Arena ne charge **aucun asset binaire externe** : tous les modèles,
textures et sons visuels sont générés par code au démarrage. Ce choix garantit un
bundle léger, un rendu identique sur tous les appareils et une originalité totale.

Ce document décrit **comment les assets sont produits** et **comment ajouter des
assets binaires** (GLB, PNG, ASTC) sans casser le budget mémoire.

---

## 1. Vue d'ensemble

```
                 ┌────────────── généré au démarrage ──────────────┐
src/render/textures.ts ──▶ Canvas 2D ──▶ albedo / normal / roughness
src/render/sky.ts      ──▶ skybox HDR rayon-marchée ──▶ PMREM (reflets PBR)
src/render/models.ts   ──▶ BufferGeometry procédurale (karts, pilotes, décor)
src/render/trackMesh.ts──▶ ruban de route, vibreurs, barrières, plaques

                 ┌────────────── assets binaires optionnels ───────┐
assets/glb/*.glb       modèles sculptés (Draco/meshopt recommandé)
assets/tex/*.png       2K / 4K sources (albedo, normal, roughness, AO)
  └─ tools/compress-astc.mjs ──▶ assets/astc/*.astc (+ manifest.json)
```

Ordre de chargement cible : **ASTC → GLB → premier frame**. Les textures
procédurales sont générées pendant l'écran de chargement (≈ 120–400 ms en Ultra).

---

## 2. Textures procédurales

| Texture | Résolution (basse / haute / ultra) | Usage |
|---|---|---|
| `asphalt` | 256 / 512 / 1024 | route, grain + micro-fissures |
| `asphaltNormal` | idem | normal map dérivée de la hauteur |
| `grass` | 256 / 512 / 1024 | herbe (détail + variation de teinte) |
| `curb` | 128 / 256 / 512 | vibreur bicolore |
| `sand`, `concrete`, `metal` | 256 / 512 / 1024 | décor, tribunes, barrières |
| `kartPaint` | 256 / 512 / 1024 | peinture métallisée (roughness variable) |
| `smoke`, `spark`, `confetti` | 64 / 128 / 128 | sprites de particules (additifs) |

Règles respectées :

* **tuilables** : les bords sont continus (normales par différences finies
  circulaires) ;
* **sRGB** pour l'albedo, **linéaire** pour normal / roughness ;
* **mipmaps** + anisotropic 2 / 4 / 8 ;
* génération **une seule fois** par palier, partagée entre tous les objets ;
* aucune allocation pendant la boucle de rendu.

### Passer en 2K / 4K

Le produit des exigences (2K partout, 4K sur karts et personnages) est supporté
par le générateur mais pas activé par défaut pour une raison mesurable : générer
8 textures 4K en Canvas 2D coûte ~1,2 s et ~380 Mo de RAM GPU sur mobile, ce qui
fait échouer le chargement sur les appareils d'entrée de gamme.

Pour l'activer sur un appareil ciblé :

```ts
// src/core/config.ts
QUALITY.ultra.textureSize = 4096;          // karts / pilotes / asphalte
QUALITY.high.textureSize  = 2048;
```

Recommandation : réserver le 4K aux **karts visibles** (les seuls objets observés
de près) et rester en 1K sur le terrain, dont la densité de texels par mètre est
déjà suffisante grâce au tuilage.

---

## 3. Modèles procéduraux

| Objet | Détails | LOD |
|---|---|---|
| Kart | coque + aileron + sièges + 4 roues + échappement, 5 silhouettes | plein < 26/42 m, simplifié au-delà |
| Pilote | tête, casque, visière brillante, bras articulés au braquage | inclus dans le kart |
| Arbres | 3 variantes fusionnées en une seule géométrie instanciée | InstancedMesh |
| Foule / tribunes | cubes instanciés, couleurs par circuit | InstancedMesh |
| Barrières, pneus, balises | instanciés le long de la piste | InstancedMesh |

Toutes les géométries sont **partagées** entre instances et les matériaux mis en
cache par clé `couleur|rugosité|métal`.

---

## 4. Compression ASTC

```bash
# 1. installer l'encodeur
brew install astcenc            # macOS
# ou : https://github.com/ARM-software/astc-encoder/releases

# 2. lancer la conversion
node tools/compress-astc.mjs            # 6×6 qualité 6 (défaut)
node tools/compress-astc.mjs --block 4x4 --quality 8
```

Résultat :

```
assets/astc/*.astc          blocs compressés
assets/astc/manifest.json   { nom: { fichier, w, h, block, srgb } }
```

Recommandations de blocs :

| Type de texture | Bloc | Justification |
|---|---|---|
| Albedo / couleur | **6×6** | bon compromis (0,44 bit/px) |
| Normal map | **4×4** | les normales supportent mal la quantification |
| Roughness / masques | **8×8** | gradients lents |
| UI, décalques | non compressé | petites surfaces |

Sur Android, `Asset.downloadAsync` + `gl.compressedTexImage2D` via `expo-gl`
suffisent ; three.js expose `CompressedTexture` + `RGBA_ASTC_6x6_Format`.
**Ne pas** monter les normal maps au-delà de 4×4 : les artefacts de facettes
deviennent visibles sur la carrosserie.

---

## 5. Skybox HDR

Chaque circuit fournit une skybox **rayon-marchée** (dégradé de ciel + disque
solaire + bandes de nuages + horizon teinté) rendue en HDR (valeurs > 1), puis
préconvoluée avec `PMREMGenerator` :

* `scene.environment` → reflets PBR (carrosserie, visière, chrome) ;
* `scene.background` → fond.

Remplacer par une vraie cubemap HDR (`.hdr` / `.exr`) est trivial :
`RGBELoader` + `PMREMGenerator.fromEquirectangular` ; garder alors la résolution
d'entrée à **1K ou 2K** (une équirectangulaire 4K coûte 48 Mo en HalfFloat).

---

## 6. Budgets mémoire cibles (Ultra)

| Poste | Budget |
|---|---|
| Textures 1K (×10) + mips | ~55 Mo |
| Textures ASTC 6×6 (si ajoutées) | ~8 Mo |
| Environnement HDR préconvolu | ~12 Mo |
| Géométries (piste + décor instancié) | ~14 Mo |
| Render targets (HalfFloat + bloom) | ~28 Mo |
| **Total** | **~120 Mo** |

En palier Basse, viser < 45 Mo : textures 256, ombres désactivées, bloom coupé,
particules 180.
