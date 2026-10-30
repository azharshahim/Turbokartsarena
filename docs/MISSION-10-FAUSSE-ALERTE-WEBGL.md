# Mission nº10 — fausse alerte WebGL sur l'écran VICTOIRE

Base : `main` (fusion de la PR nº7, **06527a5**). Branche dédiée :
`arena/f692444b-turbokartsarena`. Aucun développement V4.1.

## Hypothèse confirmée

`PhysicsEngine.dispose()` (`src/render/world.ts`) termine par
`renderer.forceContextLoss()`. Dans le navigateur, cette extension
(`WEBGL_lose_context`) émet un événement `webglcontextlost` **asynchrone**.

Dans `preview/main.ts`, `observeRenderer()` attache sur le canvas de la course un
gestionnaire `webglcontextlost` qui appelle `renderFailure()`. Il doit être
détaché via `releaseRaceContext()` **avant** `engine.dispose()`. C'était le cas
dans `startEngine()`, `quitToMenu()` et `startRace()`, mais **pas** dans
`showResults()` : l'écran de résultats détruisait le moteur avec l'observateur
encore actif. L'événement arrivait un instant plus tard, avec `engine === null`,
et déclenchait une alerte « contexte WebGL : course » sur un écran qui n'a plus
besoin du GPU. Les Turbo Coins et la sauvegarde étaient déjà écrits à ce moment.

## Reproduction

`npm run test:mission10` (`tools/tests-mission10.ts`) :

1. file d'événements asynchrone identique au navigateur — ordre fautif → alerte,
   ordre corrigé → silence, perte réelle du pilote → alerte conservée ;
2. vérification statique de `preview/main.ts` : chaque `engine.dispose()` /
   `showroom.dispose()` est précédé, dans la même fonction, du détachement de son
   observateur. **Échoue avant la correction** (`showResults`), passe après.

Chromium ne peut pas être téléchargé dans l'environnement de travail ; le
scénario navigateur (`npm run test:browser:gpu`) reste à rejouer localement.

## Correction (minimale)

`showResults()` appelle `releaseRaceContext()` juste avant `engine.dispose()`.
Rien d'autre ne change :

- `dispose()` libère toujours toutes les ressources GPU puis force la perte du
  contexte (mission 9 inchangée) ;
- les pertes réelles pendant la course et dans le garage restent observées et
  signalées ; le drapeau `disposed` du gestionnaire ignore uniquement les pertes
  postérieures au détachement ;
- transitions garage → course → résultats → garage : ordre
  « détacher, puis détruire » désormais uniforme sur les cinq sites ;
- `awardRace()` et `persistGarage()` s'exécutent avant la destruction, comme
  auparavant.

## Vérifications

- `npm run test:mission10` : OK (5 destructions ordonnées).
- `npm run typecheck` : OK.
- `npm test` : 45 tests OK.
- `npm run preview:build` : `index.html`, `dist/` et version du service worker
  régénérés.
