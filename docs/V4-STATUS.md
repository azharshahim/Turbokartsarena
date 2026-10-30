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

## Continuation — avancement réel et captures

- `abba138` : ajout d'une couche de paysages temps réel (eau à déplacement de sommets, dunes, massifs enneigés, cascades, feuillages au vent, oiseaux instanciés, météo, fumée volcanique et circulation décorative). Géométries statiques regroupées par matériau ; quantités selon la qualité. Cela reste un rendu procédural stylisé, **pas une validation du niveau cinématographique haut de gamme demandé**.
- Portions multi-surfaces sur dix thèmes ; Tokyo/Néon restent en asphalte. Matériau du ruban et coefficients physiques utilisent les mêmes intervalles et le point de contact réel. UV neige/volcan du sol séparés des UV de la route pour conserver les traces.
- Projections de sable, terre, neige et gravier avec pooling, couleur/taille/gravité spécifiques ; correction du masque rouge des sprites afin de supprimer les carrés visibles à l'inspection.
- Symboles géométriques des six cadeaux, animation d'élévation/rotation/expansion et éclats à la collecte. Collision, bonus et réapparition à 20 secondes inchangés. Aucun nouveau son cadeau livré.
- Caméra de présentation au compte à rebours et orbite de célébration à l'arrivée ; décor du circuit dans le showroom d'accueil. Miroir planaire réel dans le garage, résolution limitée à 512². Option de réduction des animations web/native : orbites, vent, météo, FOV, secousses et effets de vitesse neutralisés. Animations essentielles de conduite conservées.
- Campagne locale : typecheck, moteur (45), V2 (199), V3, V4, navigateur, navigateur V2 et PWA verts. PWA : installation, lancement froid hors connexion, course hors connexion et mises à jour du service worker vérifiés. Après les corrections visuelles, typecheck/V4 et captures réexécutés de manière ciblée ; les règles moteur/économie n'ont pas été modifiées par ces corrections.
- Chromium 131 fonctionne localement avec le binaire et les bibliothèques de `@sparticuz/chromium@131.0.1`, installés **hors dépôt** depuis npm. Commandes navigateur : `LD_LIBRARY_PATH=/tmp/al2023/lib PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/tmp/chromium npm run test:browser` (mêmes variables pour V2/PWA/captures). Ni cette dépendance ni ses bibliothèques ne sont intégrées au jeu.
- **Preuves réelles conservées dans `docs/v4-captures/index.html`** : les huit comparaisons demandées, plus Tokyo et les îles volcaniques. V3 publiée `4c8fcb5` / chantier V4, sans retouche. Manifest avec source, cadrage et empreintes des fichiers. Inspection visuelle réalisée sur les scènes garage, tropicale, neige, désert et volcanique ; elle a motivé les corrections des sprites et UV. Ces captures ne valident ni Android ni un objectif artistique de film d'animation.
- APK local impossible : Java/SDK Android absents. Unique tentative de dispatch Actions sur la branche de session : **403 Resource not accessible by integration**. Il faut l'autorisation **Actions: write** pour déclencher ce workflow ; aucune nouvelle tentative, aucun APK de ce commit, aucun FPS appareil inventé.
- Blocage de réunion inchangé : la session autorise uniquement les pushes sur `arena/263c429d-turbokartsarena`, pas sur la branche tête de PR nº 5. Cette dernière n'a été ni modifiée ni remplacée ; aucune nouvelle PR créée. La branche de session a été synchronisée en fast-forward avec son propre historique distant `d4adae7` avant les ajouts, sans réécriture.

**Reste obligatoire :** raccordement à la PR nº 5, build APK, validation du miroir et de l'ergonomie paysage sur Android, essais de performances et de conduite sur appareil. La finition artistique des paysages reste plus simple que la cible premium ; les cascades et certains détails demandent une revue en mouvement, les aperçus d'accueil restent un diorama et non une séquence de course complète. Son des cadeaux non livré. Ne pas fusionner, sortir du brouillon ou publier comme V4 terminée dans cet état. Le rapport Mission 4 antérieur décrit l'état historique avant cette continuation.
