# L'instant critique

Application web d'apprentissage : quelques minutes par jour pour retenir les classiques du dossier **« 30 classiques pour penser le monde »** (*Le Magazine littéraire*, n° 581-582, juillet-août 2017, coord. Pierre Assouline et Alexis Brocas) et s'en servir pour penser le présent.

- **Deux mises en page** : sur téléphone, une colonne, barre d'onglets en bas et boutons de réponse sous le pouce ; sur ordinateur, tableau de bord en deux colonnes, fiche avec couverture fixe à gauche, raccourcis clavier en séance.
- **Installable sur l'écran d'accueil** avec le logo (manifeste + service worker), utilisable hors connexion. Android/Chrome/Edge : bouton « Installer » dans l'application ou menu du navigateur ; iPhone : Safari › Partager › « Sur l'écran d'accueil ».
- **Défi éclair** : 8 manches pour retrouver le livre derrière une idée ou une citation (sans effet sur les révisions).
- **Pensée pour qui n'a lu ni les livres ni les articles** : chaque livre est d'abord présenté en trois écrans (le livre en bref, ce qu'en retient le dossier, un exemple) ; les livres s'ouvrent du plus accessible au plus exigeant ; chaque livre a trois paliers (découvrir → comprendre → approfondir), le palier suivant ne s'ouvrant qu'après réussite du précédent ; « coup de pouce » sur les questions ; 48 mots difficiles expliqués d'un toucher (`src/data/glossaire.json`).
- **Séance du jour** (10-20 min) : révisions dues d'abord, puis nouveautés dans un ordre pédagogique, fiche « En un regard » avant chaque nouvelle œuvre.
- **5 formats** : flashcard, QCM de distinction, relier œuvre ↔ idée, question d'actualité (avec limites du rapprochement), restitution libre auto-évaluée.
- **4 compétences suivies séparément** : connaître l'œuvre, comprendre ses idées, penser le présent, comparer.
- **Répétition espacée** documentée dans `src/js/srs.js` (variante de SM-2 ; oublis → retour à 10 min ; « acquise » = 3 réussites consécutives et intervalle ≥ 21 j ; plafond 120 j).
- **Bibliothèque** avec recherche (auteur, titre, notion, thème), **mode réflexion** (12 rapprochements argumentés + carnet personnel), **progression** (découvertes, acquises, à consolider, régularité, évolution, prévision).
- Sauvegarde locale (localStorage, schéma versionné et migrations), **export / import** JSON, signalement d'erreurs (local + ticket GitHub prérempli), thème clair/sombre, responsive.
- Aucun compte, aucun serveur, aucune clé d'API. Pas de synchronisation entre appareils : utilisez l'export/import.

## Contenu

| Fichier | Rôle |
|---|---|
| `src/data/oeuvres.json` | 11 articles, 20 fiches d'œuvres, introduction, œuvres annoncées, légende des sources |
| `src/data/glossaire.json` | 48 termes expliqués simplement |
| `src/data/cartes.json` | 146 cartes, dont 40 de découverte ; (compétence, format, source paginée, nature : dossier / synthèse / prolongement) |
| `src/data/liens.json` | rapprochements (lien établi par le dossier ou proposé par l'application) et questions ouvertes |

Le rapport de vérification documentaire est dans [`VERIFICATION.md`](VERIFICATION.md).

Les couvertures sont dans `assets/couvertures/`, les icônes dans `assets/icons/`.

Le PDF du magazine **n'est pas** inclus (droits d'auteur). Dans *Réglages*, chacun peut associer son propre exemplaire : il est stocké localement (IndexedDB) et chaque fiche ouvre alors la bonne page.

## Lancer en local

```bash
npm start            # serveur statique sans dépendance → http://localhost:8080
npm test             # tests unitaires (algorithme, séances, sauvegarde, intégrité des données)
npm run test:e2e     # parcours complet dans Chromium (Playwright requis), captures dans test-results/
```

Node 18+ suffit ; aucune installation de paquet n'est nécessaire pour `start` et `test`.
Ouvrir `index.html` directement depuis le disque ne fonctionne pas (le navigateur bloque le chargement des JSON) : passez par `npm start` ou tout serveur statique (`python3 -m http.server`).

## Publier sur GitHub Pages

Le site est entièrement statique et utilise un routage par ancre (`#/…`), compatible avec n'importe quel sous-chemin.

1. Fusionner le code sur la branche `main`.
2. Dans le dépôt GitHub : **Settings → Pages → Build and deployment → Source : GitHub Actions**.
3. Le workflow `.github/workflows/pages.yml` lance les tests puis publie le site à chaque push sur `main` (ou manuellement via *Actions → Publier sur GitHub Pages → Run workflow*).
4. L'adresse publique apparaît dans l'onglet Actions, de la forme `https://<compte>.github.io/<dépôt>/`.

Alternative sans Actions : *Source : Deploy from a branch*, branche `main`, dossier `/ (root)` (le fichier `.nojekyll` est fourni).

## Faire évoluer le contenu

Ajouter ou corriger une carte = modifier `src/data/cartes.json` puis lancer `npm test` (le test d'intégrité vérifie œuvres référencées, pages, QCM à 4 choix uniques, limites pour les questions d'actualité…). Les états de révision sont indexés par identifiant de carte : conserver l'`id` d'une carte corrigée garde la progression ; en changer la réinitialise pour cette carte.
