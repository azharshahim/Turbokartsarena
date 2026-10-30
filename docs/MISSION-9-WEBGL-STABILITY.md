# Mission nº9 — perte réelle du contexte WebGL sur Samsung

## Point de départ et niveau de certitude

Base : `main`, fusion de la PR nº6, **0fd8e39**. Branche dédiée :
`arena/b458d021-turbokartsarena`. Aucun développement V4.1, changement de physique,
d'économie ou de sauvegarde, aucun retrait de décor/effet V4.

Données **réelles transmises par le propriétaire** : perte après environ 101 s,
phase `contexte WebGL : course`, `ready: true`, viewport **798×339**, DPR
**2,8125**, visibilité `visible`, Chrome **156** / Android **10; K**. Garage et
circuit se chargent. Cela confirme une perte pendant la course et **non** un
échec de démarrage. Cela ne donne ni modèle/GPU, ni mémoire disponible, ni cause
du reset du pilote.

**La cause précise de la perte spontanée sur ce Samsung reste non démontrée.**
La pression mémoire et les réallocations sont des pistes étayées par les défauts
ci-dessous, pas une preuve qu'elles ont provoqué le reset à 101 s. Un reset de
pilote, la pression des autres processus ou un problème thermique restent
possibles. Aucune perte spontanée n'a été reproduite avec le GPU logiciel.

## Audit ciblé et corrections confirmées

| Zone | Constat vérifiable | Correction |
|---|---|---|
| Post-traitement | `EffectComposer.dispose()` r166 ne détruit **pas** ses passes ; 11 cibles de bloom et leurs matériaux restaient enregistrés jusqu'à destruction du contexte. | Disposer explicitement chaque passe et le matériau high-pass oublié par `UnrealBloomPass.dispose()` r166 ; fermeture idempotente. |
| Bloom | 11 cibles plein écran avaient un buffer de profondeur inutilisé. Le composer les dimensionnait en pixels physiques puis l'application les redimensionnait à nouveau en pixels CSS à chaque adaptation. | Supprimer uniquement la profondeur inutile, dimensionner une seule fois et conserver le budget CSS existant à DPR > 1. Sous DPR 1, suivre la réduction réelle de résolution. Aucun retrait du bloom. |
| PMREM / reflets PBR | Générateur et cible temporaire conservés pendant toute la course ; disposer seulement `env.texture` ne libère pas le framebuffer de sa cible propriétaire. | Disposer immédiatement le générateur temporaire ; conserver et disposer le **render target** d'environnement complet. |
| Ombres | Cible de profondeur de la lumière non libérée explicitement. | `sun.shadow.dispose()` lors de la fermeture/perte. Ombres conservées. |
| Textures | Textures de surfaces, lignes, damier, turbo et bannière non toutes libérées par leurs propriétaires ; 6 restaient après correction des seules cibles. | Libération explicite des enregistrements GPU. Le cache de pixels CPU réutilisables reste disponible. |
| Géométrie instanciée | Disposer la géométrie seule ne libère pas `instanceMatrix`/`instanceColor` dans Three r166 ; le décor du garage pouvait changer sans `InstancedMesh.dispose()`. | Disposer les instances dans chaque propriétaire de décor, notamment lors du changement de fond du garage. |
| Projectiles | Au redémarrage, `resetCombat()` retirait les meshes sans libérer géométrie/matériau : 4 buffers restaient pour le projectile de test. | Disposer ces ressources avant de vider la liste. Créations au tir et destructions en fin de vie restent bornées ; aucune refonte du combat. |
| Restauration | Après un véritable événement `webglcontextrestored`, l'environnement PMREM généré uniquement sur GPU n'était plus chargé, malgré les triangles à nouveau rendus. | Détacher les anciennes cibles pendant la perte ; après l'événement réel, régénérer PMREM, chaîne de post-traitement et cibles nécessaires. Les textures CPU et géométries sont réuploadées par Three. |

Les buffers de particules/pluie et les instances de trafic sont mis à jour en
place. Pas de création systématique de géométrie, texture ou contexte par frame
identifiée. Des géométries déjà construites sont chargées progressivement sur le
GPU lorsqu'elles deviennent visibles ; les projectiles créent des ressources
ponctuelles, maintenant libérées aussi au redémarrage.

### Contextes garage / course

`stopGarage()` arrête la boucle, retire les observateurs, dispose le showroom et
force la perte de son contexte web **avant** de créer la course. Le retour menu
fait l'inverse. Mesures : **un seul contexte non perdu à chaque échantillon**, y
compris trois cycles course → garage → course. Un canvas encore présent dans le
DOM n'est pas nécessairement un contexte actif.

Les mesures forcent la qualité haute. En mode auto, le code crée aussi un contexte
**temporaire** pour identifier le GPU, puis appelle explicitement `loseContext()`.
Les échantillons ne constituent pas une preuve d'absence de tout chevauchement
instantané. Aucun cumul permanent garage + course n'a été trouvé.

## Mesures avant / après

Même viewport et DPR que le Samsung, qualité haute, **Chromium 131 / SwiftShader**,
UA Android fourni émulé et commandes tactiles. Ce n'est ni Chrome 156 réel ni le
GPU Samsung. La baseline est un contrôle court de **20 s**, pas une campagne de
180 s ayant reproduit le problème du téléphone.

| Mesure | Avant | Après |
|---|---:|---:|
| Contexte de rendu non perdu, échantillons | 1 | 1 |
| Renderbuffers actifs en course | 14 | **3** |
| Framebuffers actifs en course | 16 | **15** |
| Stockage textures + renderbuffers estimé, première vue au ratio 1,8 | ~56,07 MiB | **~53,62 MiB** |
| Nouvelles textures par adaptation, DPR interne > 1 | 13 | **2** |
| Nouveaux renderbuffers par adaptation | 13 | **2** |
| Textures Three restantes avant `renderer.dispose()`, 3 fermetures | 18 / 19 / 19 | **0 / 0 / 0** |
| Géométries Three restantes, mêmes fermetures | 0 / 0 / 0 | **0 / 0 / 0** |
| Buffers/FBO/renderbuffers applicatifs restants, après | — | **0 / 0 / 0**, chacun des 3 cycles |
| Buffers conservés du projectile retiré au restart | 4 | **0** |
| Environnement PBR chargé après restauration réelle | non | **oui, contenu HDR relu** |

Les compteurs viennent des appels WebGL create/delete et de `renderer.info`.
**L'estimation n'est pas la VRAM physique** : elle exclut buffers de sommets,
programmes, swapchain, surcoûts du pilote et certaines allocations de mipmaps.
Elle ne donne pas le pic transitoire du pilote. Les 4 textures de repli internes
à Three ne sont pas comptées dans les textures applicatives de `renderer.info` ;
les programmes en cache sont relâchés par `renderer.dispose()`, le contexte web
est ensuite détruit. Les compteurs du premier instrument après perte ne
réinitialisaient pas leur époque : ils ne sont pas utilisés pour la comparaison
post-restauration. La sonde finale corrige cela.

À résolution interne inférieure à 1, les 11 cibles de bloom doivent naturellement
changer aussi : le chiffre **2 textures** concerne le contrôle à DPR > 1, pas
toutes les adaptations. La politique de qualité et les seuils d'adaptation du
jeu ne sont pas changés arbitrairement à partir du seul nom « Samsung ».

Données synthétiques réellement mesurées : [`diagnostics/mission9-gpu.json`](diagnostics/mission9-gpu.json).
Rapports bruts et captures : artefact CI `gpu-stability-diagnostics`,
`.preview/gpu-stability/` en local. Sonde instrumentée **uniquement dans les tests**,
sans télémétrie applicative. Les diagnostics locaux du jeu ajoutent GPU exposé,
mémoire déclarée par le navigateur, dimensions et compteurs de ressources à la
perte, pour mieux qualifier un éventuel nouvel incident sur le téléphone.

## Résultats des tests ciblés

- **PASS** — `npm run test:browser:gpu` : 180 secondes **murales** de rendu avec
  échantillons toutes les ~15 s, aucune perte spontanée, un contexte actif et
  35 textures Three stables. SwiftShader est lent : seulement ~17,7 secondes de
  simulation pendant cette partie ; ce n'est pas un résultat de FPS mobile.
- **PASS** — parcours supplémentaire de **180 secondes simulées**, pas de 50 ms,
  avec 18 rendus de contrôle et IA. Temps de course final ~197,9 s. Textures à 35,
  buffers atteignant un plateau après apparition des géométries ; variation finale
  d'un projectile correctement libéré. Ce parcours accéléré n'est pas un rendu
  continu à cadence de téléphone.
- **PASS** — quatre adaptations internes, baisse/remontée, sans resize CSS ;
  cibles bornées, pas d'accumulation de textures.
- **PASS** — vrai `WEBGL_lose_context` puis `restoreContext()`, **attente de
  `webglcontextrestored`** et `isContextLost() === false`. Course figée, reprise
  refusée tant que perdu, pause maintenue après restauration, reprise utilisateur
  et horloge qui avance. Données `localStorage` identiques avant/après.
- **PASS** — lecture flottante du nouvel environnement : **139 776 pixels non
  noirs, zéro pixel RGB non fini, erreur GL 0**. Capture de course après reprise
  réellement rendue, examinée visuellement.
- **PASS** — 3 fermetures/cycles de course, libération des ressources inspectée
  **avant** destruction du renderer/contexte, donc non masquée par `loseContext()`.
- **PASS** — `test:browser:narrowing` : 15 cas, rétrécissements, HDR fini, résolution
  stable/baisse/remontée et avertissements normaux ; correctif PR nº6 conservé.
- **PASS** — `test:browser:android` : démarrage, garage, tactile, resize, pertes/
  restaurations réelles forcées, erreurs WebGL/shader/module injectées explicites.
- **PASS** — typecheck natif + preview, build web et suite V4 (12 circuits,
  14 véhicules, géométrie, multi-surfaces, cadeaux). Pas de nouvelle campagne PWA
  complète locale : son protocole n'est pas modifié. Le bundle et son hash sont
  régénérés normalement.

Les tests de restauration sont **déclenchés artificiellement**, mais l'événement
et la reconstruction WebGL sont réels ; aucun `dispatchEvent` ne simule une
restauration réussie. Si le navigateur ne restaure pas, le jeu reste arrêté et
le message d'erreur reste affiché. Si la reconstruction échoue, un message
explicite la signale au lieu de promettre une reprise réussie.

## Livraison et vérification téléphone

Nouvelle PR dédiée, aucun merge, déploiement Pages ni publication APK. Pas de
compilation APK manuelle : une seule synchronisation finale déclenche les contrôles
habituels de la PR, dont la compilation native et le nouveau test GPU. Le statut
Actions courant doit être lu sur le SHA final, sans le confondre avec la PR nº6.

Avant autorisation de publication : tester la version de PR sur le Samsung,
qualité Auto puis Haute, garage → course, au moins **5–10 minutes**, retour au
menu puis nouvelle course. Ne pas effacer achats/sauvegardes. Si la perte revient,
transmettre tous les détails locaux enrichis, modèle du téléphone, réglage de
qualité et circuit. Aucun appareil Samsung physique, test thermique, mesure de
VRAM réelle ou exécution Android native n'était disponible ici : **la stabilité
définitive sur ce téléphone n'est pas certifiée**.
