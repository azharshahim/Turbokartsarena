# Installer Turbo Karts Arena sur Android

La PWA est destinée à être servie en **HTTPS**, à la racine d'un site ou dans un
sous-dossier comme `/Turbokartsarena/` sur GitHub Pages. Elle ne s'installe pas en
ouvrant directement un fichier HTML ou une adresse HTTP distante.

## Vérification sur téléphone (avant fusion)

1. Faire héberger **la branche de cette PR**, après accord du propriétaire, sur une
   URL HTTPS de test. Cette PR ne déclenche aucun déploiement PWA et ne publie pas
   de nouvelle version. Le site actuellement en ligne peut encore contenir `main`.
2. Ouvrir cette URL dans Chrome Android, en navigation normale, avec Internet.
3. Dans le menu ⋮, choisir **Installer l'application** (selon la version de Chrome :
   **Ajouter à l'écran d'accueil**, puis **Installer**). Vérifier nom et icône.
4. Lancer depuis l'icône Android : vérifier l'ouverture sans barre d'adresse et
   l'affichage paysage. En portrait, le jeu demande de tourner le téléphone.
5. Lancer chacun des trois circuits ; tester direction + dérapage et direction +
   frein avec deux doigts. Relâcher un doigt doit laisser l'autre commande active.
6. Tester pause/reprise, redémarrage, retour au menu et passage dans une autre
   application. La perte de focus doit mettre la course en pause.
7. Une fois le premier chargement terminé, fermer la PWA et ses onglets Chrome,
   activer le mode avion, puis relancer depuis l'icône : le menu et les courses
   doivent fonctionner. Un premier accès sans connexion ne peut pas installer le jeu.
8. Contrôler les FPS, la chauffe, les dimensions des commandes, le gyroscope et
   la stabilité sur l'appareil réel. Ces aspects ne sont pas certifiés par Chromium
   exécuté dans le cloud. La compatibilité iOS et son installation restent à tester.

Les caches peuvent être évincés par Android/Chrome en cas de manque d'espace ou
après effacement des données du site. Recharger en ligne rétablit le mode hors connexion.

## Construction et fichiers à héberger

```sh
npm ci
npm run preview:build
```

Pour GitHub Pages depuis la racine du dépôt : `index.html`, `manifest.webmanifest`,
`service-worker.js`, `icon.svg` et les deux fichiers `icons/icon-192.png` et
`icons/icon-512.png` doivent rester dans la même arborescence. `index.html` est
compilé depuis `preview/index.html` ; modifier ce dernier, puis reconstruire.

Le dossier généré `dist/` est également autonome et contient son propre `index.html`
et ses fichiers PWA. `dist/turbo-karts-arena.html` reste jouable comme fichier HTML
hors ligne, mais l'installation PWA exige un serveur. `preview/dist/` est une troisième
variante avec bundle JavaScript externe également mis en cache.

Le serveur de test prend en charge les types MIME des fichiers PWA :

```sh
npm run preview:serve
```

Le service worker précache le jeu et ses icônes. Une navigation privilégie le réseau
et utilise le HTML précaché en cas de panne ; les ressources inconnues ne reçoivent
jamais de HTML à la place d'un script ou d'une image. Le cache est limité aux fichiers
connus et isolé par URL de scope. Sa version dépend du contenu compilé, du manifeste,
des icônes et du worker. Une mise à jour attend la fermeture des anciennes fenêtres
pour éviter d'interrompre une course, puis supprime uniquement ses propres anciens
caches. Fermer tous les onglets et la PWA, puis rouvrir en ligne pour obtenir une mise
à jour. Les caches d'autres applications sont conservés.

## Tests automatisés

```sh
npm test
npm run typecheck
npm run preview:build
npx playwright install --with-deps chromium
npm run test:browser
npm run test:pwa
CI=1 EXPO_NO_TELEMETRY=1 npx expo export --platform android --output-dir .preview/android-export
```

`test:pwa` utilise un serveur HTTP éphémère avec le préfixe `/Turbokartsarena/`,
un profil Chromium normal pour les diagnostics d'installation, puis teste le
redémarrage hors connexion, une course sans réseau, les dimensions PNG, les scopes,
la mise à jour du worker et la conservation des caches tiers. Il vérifie aussi
les deux distributions générées hors ligne. Aucun site n'est publié par ce test.

Sur Codex Cloud, le Chromium système interdit `file://`. Avec le serveur local
lancé, utiliser les options supportées suivantes pour la régression du jeu :

```sh
BROWSER_TEST_URL=http://127.0.0.1:5173/index.html \
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:browser
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:pwa
```

Les icônes PNG sont générées depuis le SVG existant, sans nouvel artwork :
`npm run icons:build` (même variable Chromium facultative). Elles sont versionnées ;
leur régénération n'est pas requise pour compiler.
