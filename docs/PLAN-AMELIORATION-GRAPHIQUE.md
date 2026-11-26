# Plan d'amélioration graphique — Turbo Karts Arena

## Objectif et limites

Rendre les karts, les pilotes et les circuits plus lisibles et plus beaux sur téléphone, sans promettre un rendu de type GTA 6. Le jeu utilise aujourd'hui Three.js, des véhicules construits en géométrie procédurale et des niveaux de qualité adaptés au matériel. Un rendu photoréaliste comparable à une grosse production demanderait notamment des modèles, textures, animations, éclairages et un budget de production très différents ; il risquerait aussi de dépasser les capacités de nombreux téléphones.

## Étape déjà réalisée : cadrage

La caméra est rapprochée modérément en course et pendant les séquences de départ et d'arrivée. Les karts et pilotes paraissent plus grands sans changer leur taille dans le monde, leur physique ou leurs collisions. Le recul augmente toujours avec la vitesse pour conserver de la visibilité ; le champ de vision et le réglage de mouvements réduits sont conservés. Les autres karts paraîtront plus grands surtout lorsqu'ils sont proches de la caméra : les adversaires lointains ne sont pas agrandis artificiellement.

## Propositions à valider avant réalisation

1. **Lisibilité et direction artistique** : tester sur plusieurs téléphones et circuits, évaluer le cadrage en virage, en pente et sous turbo. Vérifier que le kart ne cache pas les obstacles ni les commandes. Ajuster le cadrage si nécessaire avant toute autre modification.
2. **Karts et personnages** : améliorer progressivement les silhouettes, casques, roues et matériaux, en commençant par un véhicule pilote. Conserver un style arcade cohérent ; comparer avant/après et éviter d'ajouter des détails invisibles sur petit écran.
3. **Éclairage et décors** : améliorer les contrastes, couleurs et matériaux de piste, puis ajouter des détails ciblés sur un circuit pilote. Conserver les niveaux de qualité existants et limiter ombres, transparences et effets coûteux sur les appareils modestes.
4. **Validation et déploiement progressif** : comparer captures et performances sur Android réel, avec et sans effets, en course prolongée. Surveiller fluidité, chauffe, mémoire, autonomie, lisibilité et régressions WebGL. Étendre aux autres circuits seulement après validation.

## Critères d'acceptation proposés

- Pilote et kart clairement identifiables en paysage sans masquer les virages, obstacles ou boutons.
- Pas de modification involontaire de la physique, des collisions ou des sauvegardes.
- Pas de baisse de fluidité perceptible sur les téléphones de référence ; mesurer FPS, temps de frame et mémoire avant/après plutôt que promettre un chiffre sans appareil de référence.
- Tester départ, course, dérapage, turbo, arrivée, mouvements réduits, plusieurs véhicules, circuits et tailles d'écran, puis faire valider le ressenti par les joueurs.

Les étapes graphiques 2 et 3 sont des recommandations, pas des améliorations déjà livrées. Aucun test sur téléphone physique n'a été réalisé dans cet environnement.
