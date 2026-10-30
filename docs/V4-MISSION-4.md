# Mission 4 — rapport de chantier, V4 NON LIVRÉE

## Situation GitHub

Travail repris depuis `369acecbd046801891bbae39f80012aaae35cb71` (PR nº 5).
La session Arena impose la branche `arena/263c429d-turbokartsarena`, distincte de la tête de PR nº 5 (`arena/6558fb9b-turbokartsarena`). Aucune branche supplémentaire ni nouvelle PR créée par l'agent. Aucun push vers l'ancienne branche ou main.

Commit fonctionnel poussé : `61587e9` (géométrie, garage, tests et procédure de capture).
PR : https://github.com/azharshahim/Turbokartsarena/pull/5 — OPEN, DRAFT, tête `369acec`, état de fusion CLEAN lors de la vérification. Les nouveaux commits **ne figurent pas dans cette PR**, car sa branche tête est différente.

Tentative unique : `gh workflow run android-apk.yml --ref arena/263c429d-turbokartsarena -f publish_release=false`.
Résultat : **HTTP 403: Resource not accessible by integration**. Aucun nouveau run créé ; aucune relance. Les autorisations GitHub de l'intégration doivent être corrigées pour lancer ce workflow.

Le dernier run associé à l'ancien incrément était vert (`40988935967`, commit `369acec`) ; il ne valide PAS les nouveaux changements.
Pages indique `built` à https://azharshahim.github.io/Turbokartsarena/ ; aucune nouvelle publication demandée. Ce statut n'est pas une validation du présent chantier.
Aucun commit de fusion. Aucun nouvel APK validé ou lien de téléchargement pour ces changements.

## Implémenté dans cet incrément (pas encore validé visuellement)

- Géométrie supplémentaire sur les 14 véhicules : bandes de roulement en relief, ressorts hélicoïdaux, détails mécaniques par famille.
- Karts : doubles triangles avant, arches de roues arrière, renforts du siège baquet, prises d'air, ailettes de diffuseur, collecteur et lèvre d'échappement, feu arrière. Les karts `formula` achetables utilisent aussi la carrosserie Formula.
- Motos : ressort arrière, radiateur à ailettes, repose-pieds, chaînes, panneaux latéraux, ouïes, ailettes sport ou protections cross, bouchon de réservoir.
- Trois niveaux géométriques alignés sur les réglages existants `low/high/ultra`. Les noms des réglages historiques ne sont pas changés. LOD et batching conservés.
- Rotation des roues calculée à partir du rayon de chaque modèle au lieu d'un rayon unique.
- Garage web dédié accessible depuis le menu, trois sections possessions/boutique/améliorations, caractéristiques comparables, prix et solde, achat et retour d'état, sélection pour la course, sept améliorations avec niveaux/coûts/gains. Réutilisation du même canevas 3D et de l'économie V3.
- Écran garage natif dédié en Modal, trois sections, même économie, sélection du véhicule, sept améliorations, rotation et pincement sur GLView. Non exécuté sur appareil Android.
- Showroom : zoom tactile web à deux pointeurs, rotation libre, annulation des gestes, cadrage corrigé au zoom, anneau lumineux et sol métallique plus lisse. Ce sol n'est PAS un miroir avec réflexion planaire.
- Préférence système `prefers-reduced-motion` et option explicite pour le garage web. Flash de déverrouillage web désactivé en mode réduit.
- Aucune modification de la clé de sauvegarde V3, des soldes ou de la liste des possessions initiales.

## Ressources / licences

Aucun modèle glTF/GLB, texture, vidéo ou son externe ajouté. Toutes les nouvelles géométries sont originales, générées par code dans `src/render/vehicles.ts` et `showroom.ts`. Aucun nouvel asset de texture. Aucune nouvelle licence tierce requise pour ces ajouts ; Three.js et les autres dépendances gardent leurs licences existantes. La dépendance Chromium utilisée pour une tentative locale est hors dépôt, non intégrée au jeu et non ajoutée au lockfile.

## Tests effectivement exécutés

| Vérification | Résultat local |
|---|---|
| `npm run typecheck` | OK (application native et preview) |
| `npm test` | OK, 45 tests moteur |
| `npm run test:v2` | OK, 199 contrôles |
| `npm run test:v3` | OK |
| `npm run test:v4` | OK, inclut les 14 véhicules aux trois qualités, géométrie finie, pivots, budgets statiques |
| `npm run preview:build` | OK, bundle autonome et shell PWA générés |
| `npm run test:browser` | Bloqué avant tests : Chromium Playwright absent |
| `npm run test:browser:v2` | Bloqué avant tests : Chromium Playwright absent |
| `npm run test:pwa` | Bloqué avant tests : Chromium Playwright absent |
| APK local | Non exécuté : Java et SDK Android absents |
| GitHub Actions nouveau commit | Non exécuté : dispatch refusé HTTP 403 |

Les budgets de géométrie vérifiés (<65 000 triangles et <100 meshes par véhicule détaillé) ne sont pas des mesures FPS, mémoire ou draw calls de la scène complète. Aucune mesure Samsung ni validation de conduite humaine.

## Captures réelles : procédure prête, preuves absentes

Aucune capture comparative produite dans cette session. Ne pas déclarer la refonte visuellement validée.

1. `npx playwright install chromium` a échoué sur les trois miroirs avec `ECONNRESET` (hôtes de téléchargement hors réseau autorisé).
2. Un binaire alternatif obtenu depuis npm via `@sparticuz/chromium@131.0.1`, hors dépôt, s'extrait mais ne démarre pas : `error while loading shared libraries: libnss3.so: cannot open shared object file`.
3. Le workflow APK a été enrichi pour construire la V3 publiée (`4c8fcb57bfc1d1bf5ed3eda5963107a018767831`), exécuter `tools/visual-v4.mjs` et déposer l'artefact `v3-v4-real-renders`. Son lancement est bloqué par le 403 ci-dessus.

Ce script prévoit les huit sujets demandés : kart, moto, garage, désert, tropical, neige, cadeau, accueil. Il capture les véritables scènes et showroom du jeu dans Chromium/SwiftShader, même viewport, sans image générée. Le cadeau utilise un gros plan de la caméra moteur sur son mesh existant ; les paysages sont des vues de course. Le script ajoute des assertions de navigation, de fonds insuffisants et d'amélioration du garage. Il n'a PAS encore été exécuté avec succès ; les captures devront être examinées après son exécution, pas seulement produites.

Pour relancer après correction des droits GitHub : Actions → Android APK → Run workflow → branche `arena/263c429d-turbokartsarena`, publication de release désactivée. La PR nº 5 reste sur une autre branche ; ne pas confondre ce run avec ses checks.

## Manquant / conditions empêchant toute fusion

- Pas de refonte nouvelle des paysages dans cet incrément : univers cinématographiques, animations environnementales et différenciation à compléter.
- Pas de portions multi-surfaces ni physique échantillonnée sur la portion réellement traversée ; surfaces principales du premier incrément conservées.
- Pas de nouvelles projections spécifiques poussière/sable/neige ou de nouvelles suspensions réellement articulées/animées. Les animations V3 existantes ne sont pas présentées comme des ajouts.
- Cadeaux agrandis/rubans/halos existants conservés ; nouveaux symboles, collecte spectaculaire et son dédié non terminés.
- Pas de nouvelles cinématiques d'accueil, aperçus de circuits, départ ou victoire ; réduction des animations non globale et non disponible comme option native.
- Garage : réflexion réelle du véhicule au sol absente ; déverrouillage natif uniquement textuel ; présentation cinématique et ergonomie paysage Android à valider. L'inspection d'un véhicule possédé modifie déjà le véhicule de la prochaine course, comme l'ancien sélecteur. Les véhicules possédés restent sauvegardés ; la restauration systématique du véhicule sélectionné au redémarrage n'est pas ajoutée.
- Les 14 véhicules partagent des familles procédurales : cet enrichissement n'est pas présenté comme 14 modèles artistiques uniques finis au niveau d'un film d'animation.
- Validation navigateur/PWA, captures avant/après, APK et mesures sur appareils restent obligatoires.
- Raccordement des commits à la tête de PR nº 5 impossible sous la contrainte de branche de cette session.

**Décision : conserver la PR en brouillon et ne pas publier de V4 finale.**
