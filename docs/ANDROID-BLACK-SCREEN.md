# Correctif Chrome Android — démarrage / contexte WebGL

Base examinée : `252a4a9cc728782c9ed0d2f311d7d4e9ed4d5c5f`. Pas de développement V4.1, modification de physique, suppression d'effet ou changement de sauvegarde.

## Résultats établis, pas une reproduction sur Samsung

Sur Chromium 131 / SwiftShader, écran tactile émulé 360×780, DPR 3 :

- La V4 crée au démarrage un renderbuffer **RGBA16F 512² / MSAA 4** via les valeurs par défaut de `Reflector`. La V3 n'avait pas ce miroir. `postfx.ts` évitait déjà explicitement le MSAA HalfFloat en raison de pilotes mobiles donnant du noir. C'est un défaut de compatibilité identifié ; le pilote exact du téléphone n'a pas été interrogé.
- Le showroom appelle `renderer.setSize` à chaque frame ; Three.js r166 réécrit alors `canvas.width/height` même à dimensions identiques. La sonde mesure **28 écritures en 500 ms** sans resize. Ces réallocations de drawing buffer sont inutiles et accentuent la pression GPU pendant les changements de taille.
- Si la création WebGL est refusée (injection reproductible), le code publié lève `Error creating WebGL context.` dans `renderMenu()` : le bootstrap ne termine pas, le loader sombre reste visible et aucun message d'erreur n'est affiché. Voir `diagnostics/android-startup-baseline.json`.
- Les hôtes web n'avaient pas de gestion applicative de perte/restauration du contexte. Three.js gérait ses ressources internes, mais pas la pause de simulation ni un message utilisateur.
- Le resize de course acceptait zéro/NaN et ne réappliquait pas le budget pixel après agrandissement. Le showroom acceptait un aspect zéro en cas de taille masquée.

**Le noir exact du Samsung n'est pas reproduit sur appareil.** Les refus WebGL/shader et les pertes de contexte sont injectés ; les tailles, gestes tactiles et limitations CPU sont émulés. Aucun plafond de mémoire GPU réelle n'est simulé. Le cache n'est pas retenu comme cause : les régressions démarrent dans des contextes neufs avec service workers bloqués.

## Correctifs

- Miroir conservé, même géométrie / résolution 512² ; render target **RGBA8, samples 0** au lieu de HalfFloat multisamplé. Aucun retrait du miroir, des paysages, particules ou matériaux.
- Redimensionnement du showroom uniquement si les dimensions entières changent ; conservation du dernier buffer pour dimensions nulles/non finies ou contexte perdu.
- Resize/orientation/visualViewport regroupés dans une frame ; dimensions de course validées, budget pixel conservé à l'agrandissement et durant la résolution adaptative.
- Perte de contexte réelle : arrêt des boucles, commandes relâchées, course figée et message lisible. Restauration via Three.js puis reprise du showroom ; la course reste en pause jusqu'à action du joueur. La reprise est refusée tant que le contexte est perdu. Les événements de destruction volontaire sont désinscrits avant disposal.
- Diagnostic local chargé **avant** le module du jeu, embarqué aussi dans le fichier autonome. Erreurs JS, shaders, téléchargement du module et démarrage inachevé affichent une explication, une action de rechargement et des détails à transmettre au lieu d'un écran noir permanent.
- Historique limité à 16 étapes, viewport, DPR, capacités WebGL et erreur. Aucun envoi de télémétrie, aucune modification de stockage et aucune boucle automatique de rechargement.
- Nouveau hash de service worker généré normalement par le build ; aucune purge aveugle du cache ni modification du protocole PWA.

## Validation ciblée

`npm run test:browser:android` (Chromium installé) :

1. Démarrage à froid tactile, portrait, DPR 3, CPU ralenti ×4 ; menu et collections 12 circuits / 14 véhicules / 12 pilotes.
2. Aucun MSAA RGBA16F dans le miroir ; aucune réécriture du buffer au repos.
3. Portrait/paysage, taille réduite, canvas masqué temporairement à zéro, garage dédié.
4. Véritable extension `WEBGL_lose_context` dans le garage : message puis restauration.
5. Course, directions tactiles, zéro/NaN ignorés, budget pixel après grand resize.
6. Perte de contexte de course : temps figé, restauration, maintien de pause puis reprise utilisateur et triangles à nouveau rendus.
7. Refus WebGL, shader invalide et téléchargement du module bloqué : message, détails et bouton Réessayer.
8. Aucun échec de requête ni exception JavaScript dans le parcours normal.

Typecheck, build web, régression navigateur existante (pause / tactile / visibilité) et PWA (installation, lancement froid hors ligne, course hors ligne et mise à jour) exécutés avec succès localement. Le moteur et l'économie ne sont pas changés ; pas de nouvelle campagne moteur complète locale.

Le workflow **Android APK** exécute cette régression supplémentaire une fois pour la PR et conserve les captures/rapport dans l'artefact `android-webgl-diagnostics`. Il continue à vérifier TypeScript, les suites existantes et la compilation native ; aucun dispatch APK supplémentaire nécessaire.

Exemple d'environnement local alternatif (binaire Chromium et bibliothèques hors dépôt) :

```sh
LD_LIBRARY_PATH=/tmp/al2023/lib \
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/tmp/chromium \
npm run test:browser:android
```

## Vérification à faire sur le Samsung avant autorisation de publication

Sur la version de test de la PR (pas le site public inchangé), ouvrir Chrome normal puis privé, pivoter portrait/paysage, changer la taille d'affichage, ouvrir le garage et lancer une course. Si un panneau d'erreur apparaît, ouvrir **Détails techniques à transmettre** et envoyer le texte ou une capture avec le modèle de téléphone et la version de Chrome. Ne pas effacer les achats pour ce diagnostic.

Sans ce test, ne pas affirmer que le défaut spécifique du Samsung est définitivement résolu. Aucun appareil Android natif ou émulateur n'est disponible ici ; le typecheck / build CI ne remplace pas sa validation à l'exécution. Aucune fusion et aucune publication autorisées par cette mission.
