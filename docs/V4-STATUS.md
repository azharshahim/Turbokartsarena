# V4 — état du chantier (non finalisé)

Base : `4c8fcb57bfc1d1bf5ed3eda5963107a018767831`, commit de main publié avant ce chantier. Moteur Three.js partagé Expo/Web, modèles et textures procéduraux existants, showroom et économie V3 conservés. Les réglages de qualité, LOD, instancing et pooling existaient déjà ; aucune mesure sur appareil physique n'a été réalisée.

## Changements intégrés

- Une surface principale par circuit : asphalte (Côte Solaire, Néon Nuit, Tokyo, Méditerranée, Océan), gravier (Canyon, Autoroute des Alpes), sable (Sahara), terre (Forêt Tropicale, Montagne Tropicale), neige (Alpes Extrêmes), roche volcanique (Îles Volcaniques). Textures procédurales avec reliefs et traces ; coefficients d'accélération et d'adhérence utilisés par le moteur existant, avec adaptation moto.
- Cadeaux plus grands, rubans croisés, halo et couleur par catégorie, toujours animés et avec règles de collision/réapparition inchangées.
- Showroom existant : rotation complète, glisser sur le canevas web, zoom à la molette. Libération des ressources des cadeaux, boucliers et projectiles.
- Tests ciblés des terrains, textures et cadeaux. Les jeux de tests V3 et V4 sont ajoutés à la CI APK.
- Aucune ressource externe ajoutée ; les textures et géométries ajoutées sont procédurales originales.

## Conditions de livraison non satisfaites

Ce travail est un **premier incrément**, pas une V4 complète : pas de portions multi-surfaces, projections spécifiques ou calibration sur téléphone ; pas de refonte des 14 véhicules ; pas de page garage dédiée, zoom tactile, séparation boutique/possessions ou animation d'achat ; pas de nouvelle refonte des paysages, cinématiques, interface ou option de réduction d'animations. Les cadeaux ne disposent pas encore de nouvelle explosion ni de symboles identifiant les catégories. Aucune capture comparative ni validation visuelle navigateur ou Android n'a été obtenue dans cet environnement. Les coefficients nécessitent des essais de conduite humains.

Tests disponibles : `npm test`, `npm run test:v2`, `npm run test:v3`, `npm run test:v4`, `npm run typecheck`. La suite navigateur et le test PWA nécessitent Chromium/Playwright. Aucun FPS Samsung mesuré. Ne pas fusionner ni publier avant de satisfaire les conditions demandées et de vérifier les tests navigateur/PWA, GitHub Actions et APK.

## Mission 4 — incrément suivant, toujours non finalisé

Voir [V4-MISSION-4.md](V4-MISSION-4.md) pour le rapport détaillé, les tests et les blocages. Ajouts de géométrie sur les 14 véhicules, garage dédié web et natif avec trois sections et sept améliorations, rotation/pincement et procédure CI de captures comparatives réelles. La liste des conditions ci-dessus décrit l'état du premier incrément ; le rapport Mission 4 précise les changements et ce qui reste effectivement manquant.

Les nouveaux changements sont poussés sur `arena/263c429d-turbokartsarena`, branche imposée à cette session, et non sur la tête de PR nº 5. Déclenchement Actions refusé HTTP 403. Aucune preuve visuelle ni APK du nouveau code. Aucune fusion ou nouvelle publication.
