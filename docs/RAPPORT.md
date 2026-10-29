# RivieraBoats : rapport de projet

**Module « Dév avec Docker » (M2)**

| | |
|---|---|
| Auteur | *à compléter* |
| Dépôt GitHub | https://github.com/polmzenou/riviera-boats |
| Images Docker | `ghcr.io/polmzenou/riviera-auth`, `riviera-boat`, `riviera-booking`, `riviera-frontend` |
| Démonstration | 30/10/2026 à 9 h |

---

## Introduction

RivieraBoats est une application web de location de bateaux sur la Côte d'Azur. Un visiteur peut créer un compte et se connecter. Une fois connecté, il consulte les bateaux disponibles dans six ports (Nice, Cannes, Antibes, Saint-Tropez, Monaco, Menton), réserve un bateau sur des dates précises, paie (paiement simulé) et retrouve ses réservations. Un administrateur peut en plus gérer les comptes clients et le catalogue de bateaux.

Le sujet demandait une application en micro-services entièrement conteneurisée, lancée avec docker-compose, et un pipeline CI/CD qui teste, construit et publie les images. Voici comment j'ai répondu à chaque exigence :

| Exigence du sujet | Ce que j'ai fait |
|---|---|
| 1 frontend et au moins 3 backends REST | Nginx + 3 services : auth-service, boat-service, booking-service |
| Au moins 2 langages | Node.js (auth, booking) et Python (boat) |
| Une base de données SQL | PostgreSQL 17 |
| Tout conteneurisé et lancé par docker-compose | 5 conteneurs décrits dans un seul `docker-compose.yml` |
| Créer un compte, se connecter, se déconnecter | auth-service |
| Comptes standard et administrateur | un rôle par utilisateur, un admin créé au démarrage |
| Pouvoir supprimer son compte | depuis la page « Mon compte » |
| Un admin peut supprimer un compte standard, pas un admin | contrôlé côté serveur (erreur 403 sinon) |
| Non connecté : accès à l'accueil et à la connexion seulement | Nginx redirige vers la page de connexion |
| Pipeline CI/CD | GitHub Actions : tests, build, publication sur GitHub Container Registry, scan de sécurité |

---

## 1. Architecture logicielle

### 1.1 Vue d'ensemble

```
                      navigateur
                          │  http://localhost:8080  (seul port ouvert)
                          ▼
        ┌─────────────── frontend (Nginx) ───────────────┐
        │  pages HTML/CSS/JS  +  redirige les /api/...   │
        └──────┬──────────────────┬──────────────────┬───┘
               │ /api/auth        │ /api/boats       │ /api/bookings
               ▼                  ▼                  ▼
         auth-service        boat-service      booking-service
          (Node.js)            (Python)           (Node.js)
               │                  │                  │
               └──────────────────┼──────────────────┘
                                  ▼
                            PostgreSQL 17
```

L'application tourne dans cinq conteneurs. J'ai découpé le back-end par domaine : chaque service ne s'occupe que d'une chose et ne touche qu'à ses propres données.

| Conteneur | Technologie | Rôle |
|---|---|---|
| **frontend** | Nginx | Sert les pages du site et transmet les appels `/api/...` au bon service. C'est le seul conteneur accessible depuis l'extérieur. |
| **auth-service** | Node.js 22 + Express | Comptes, connexion et déconnexion, rôles, administration des comptes |
| **boat-service** | Python 3.13 + FastAPI | Catalogue des bateaux et des ports, recherche avec filtres, ajout / modification / suppression par un admin |
| **booking-service** | Node.js 22 + Express | Réservations, vérification des disponibilités, paiement simulé, annulation |
| **db** | PostgreSQL 17 | Stocke les données des trois services |

Pour le catalogue, j'ai pris Python avec FastAPI parce que le framework valide automatiquement les données reçues et génère la documentation de l'API, ce qui va vite pour un CRUD. Pour les deux autres services, j'ai pris Node.js et Express, que je connais le mieux. Le site lui-même est en HTML, CSS et JavaScript sans framework : les pages sont simples et ça m'évitait une étape de build en plus.

### 1.2 Connexion et contrôle d'accès

Je voulais que la vérification « est-ce que l'utilisateur est connecté ? » soit faite à un seul endroit, et pas recodée dans chaque service. Ça fonctionne comme ceci :

1. À la connexion, auth-service vérifie le mot de passe (stocké haché avec bcrypt, jamais en clair) et crée une session en base. Le navigateur reçoit un cookie de session que le JavaScript de la page ne peut pas lire (option `HttpOnly`).
2. Ensuite, à chaque fois que le navigateur demande une page ou une API protégée, Nginx demande d'abord à auth-service si ce cookie correspond à une session valide. C'est le module `auth_request` de Nginx.
3. Si la session est valide, Nginx laisse passer la requête et ajoute l'identifiant et le rôle de l'utilisateur dans des en-têtes HTTP. Sinon, il redirige vers la page de connexion (pour une page) ou renvoie une erreur 401 (pour l'API). Un utilisateur qui n'est pas admin et qui ouvre la page d'administration tombe sur une page 403.

Du coup, boat-service et booking-service n'ont pas à gérer la connexion : ils lisent simplement qui est l'utilisateur dans les en-têtes envoyés par Nginx. C'est sûr parce que ces services ne sont pas joignables directement (voir 2.2) et que Nginx écrase ces en-têtes si un petit malin essaie de les envoyer lui-même depuis son navigateur.

J'ai choisi des sessions enregistrées en base plutôt qu'un JWT : quand quelqu'un se déconnecte ou supprime son compte, sa session disparaît immédiatement, alors qu'un JWT reste valide jusqu'à son expiration.

### 1.3 Communication entre les services

Les conteneurs s'appellent par leur nom sur le réseau Docker, par exemple `http://boat-service:8000`. Docker se charge de trouver la bonne adresse. Il y a deux échanges directs entre services :

- **booking → boat** : quand un client réserve, booking-service demande le bateau au catalogue pour vérifier qu'il existe et récupérer son prix. Le prix ne vient jamais du navigateur, sinon un client pourrait choisir lui-même ce qu'il paie.
- **auth → booking** : quand un compte est supprimé, auth-service demande à booking-service de supprimer les réservations de ce compte. Cette route est interne et protégée par un jeton secret partagé entre les deux services.

### 1.4 Base de données

J'utilise une seule instance PostgreSQL, mais chaque service a **son propre schéma** (`auth`, `boats`, `bookings`) et **son propre utilisateur SQL**, qui n'a accès qu'à son schéma. Par exemple, auth-service ne peut pas lire la table des bateaux. C'est un compromis : une base par service aurait été plus fidèle à l'esprit micro-services, mais trois conteneurs PostgreSQL pour un projet de cette taille, c'était lourd pour pas grand-chose.

Les tables et les données de démonstration (ports, bateaux, comptes de test) sont créées par un script exécuté automatiquement au premier démarrage du conteneur (`db/init/01-init.sh`).

Pour qu'un bateau ne soit jamais réservé deux fois sur les mêmes dates, il y a deux protections. booking-service vérifie qu'il n'y a pas de chevauchement avant d'enregistrer, et une contrainte dans PostgreSQL refuse de toute façon deux réservations qui se chevauchent, même si deux clients valident exactement en même temps.

### 1.5 Sécurité

Sans aller dans le détail, voici ce que j'ai mis en place :

- mots de passe hachés avec bcrypt ;
- même message d'erreur pour « email inconnu » et « mauvais mot de passe », pour ne pas révéler quels emails ont un compte ;
- limite de 10 tentatives de connexion par minute et par adresse IP (gérée par Nginx) ;
- en-têtes de sécurité HTTP, dont une Content Security Policy qui interdit tout script qui ne vient pas du site ;
- un client qui demande la réservation de quelqu'un d'autre reçoit « introuvable », comme si elle n'existait pas ;
- paiement simulé : seuls les 4 derniers chiffres de la carte sont conservés.

---

## 2. Dockerfiles et docker-compose

### 2.1 Les Dockerfiles

Chaque service (et le frontend) a son propre Dockerfile. Ils ont tous la même structure en trois étapes (*multi-stage build*) :

| Étape | Ce qu'elle fait |
|---|---|
| `deps` (`builder` en Python) | installe uniquement les dépendances de production |
| `test` | ajoute les dépendances de développement, puis lance le lint et les tests |
| `runtime` | l'image finale : dépendances de production + code, rien d'autre |

L'image finale ne contient donc ni les outils de test ni les dépendances de développement. Autre avantage : `docker build --target test` lance les tests dans Docker, exactement comme le fait la CI. Si ça passe sur mon poste, ça passe dans GitHub Actions.

Les choix que j'ai faits :

- **Images de base légères, versions fixées** : `node:22-alpine`, `python:3.13-slim`, `nginxinc/nginx-unprivileged:1.30-alpine` et `postgres:17-alpine`. Jamais `latest`, pour que le build donne le même résultat aujourd'hui et dans un mois. Les mises à jour sont proposées par Dependabot (voir 3.1).
- **Profiter du cache** : je copie d'abord `package.json` ou `requirements.txt` et j'installe les dépendances, et seulement après je copie le code. Quand je ne modifie que le code, Docker réutilise la couche des dépendances et le build prend quelques secondes au lieu d'une minute.
- **`.dockerignore`** dans chaque dossier, pour ne pas envoyer `node_modules`, `.git`, les rapports de couverture ou les secrets dans le contexte de build.
- **Pas de root** : aucun conteneur ne tourne en root. Pour Nginx, j'ai pris l'image `nginx-unprivileged`, prévue pour ça (elle écoute sur le port 8080 au lieu de 80).
- **HEALTHCHECK** : chaque image dit à Docker comment vérifier qu'elle fonctionne, en appelant la route `/health` du service. Les images n'ont pas `curl`, donc j'utilise ce qui est déjà présent : `fetch` en Node, `urllib` en Python, `wget` dans l'image Nginx.
- **Images de production allégées** : j'ai supprimé npm de l'image Node et pip de l'image Python, puisque rien ne s'installe une fois le conteneur lancé. En plus, ça a fait disparaître des failles de sécurité signalées par le scan (voir la rétrospective).
- Les Dockerfiles sont vérifiés par **hadolint**, un linter pour Dockerfile, à chaque passage dans la CI.

Taille des images finales :

| Image | Taille | Utilisateur |
|---|---|---|
| riviera-auth | 234 Mo | node (uid 1000) |
| riviera-boat | 218 Mo | app (uid 10001) |
| riviera-booking | 234 Mo | node (uid 1000) |
| riviera-frontend | 89 Mo | nginx (uid 101) |

### 2.2 Le docker-compose.yml

Un seul fichier décrit les 5 conteneurs. Les points importants :

- **Deux réseaux.** Le réseau `backend` est déclaré `internal` : les services et la base ne sont pas joignables depuis l'extérieur et n'ont pas accès à Internet. Seul Nginx est branché à la fois sur `frontend` et sur `backend`, et seul son port est publié. Depuis ma machine, `localhost:3000` ou `localhost:5432` ne répondent pas, et c'est voulu.
- **Ordre de démarrage.** J'utilise `depends_on` avec `condition: service_healthy` : la base démarre d'abord, puis auth-service et boat-service, puis booking-service, et enfin le frontend. Un service ne démarre que quand ceux dont il dépend sont vraiment prêts (healthcheck OK), et pas seulement lancés.
- **Secrets.** Les mots de passe (base de données, compte admin, jeton interne) sont des *secrets* Docker. Ils sont montés comme des fichiers dans `/run/secrets/` au lieu d'être passés en variables d'environnement, donc ils n'apparaissent pas dans un `docker inspect`. Les vrais fichiers ne sont pas dans Git : un script (`scripts/gen-secrets.sh`, ou `.ps1` sous Windows) les génère.
- **Volume.** Les données PostgreSQL sont dans un volume nommé (`db-data`). Elles survivent à un `docker compose down`, sauf avec l'option `-v`.
- **Limites de ressources.** Chaque conteneur a une limite de CPU et de mémoire, pour qu'un service qui s'emballe ne bloque pas toute la machine.
- **Durcissement.** Tous les conteneurs, base comprise, ont un système de fichiers en lecture seule, aucun privilège Linux (`cap_drop: ALL`) et redémarrent tout seuls en cas de plantage. Ces réglages sont écrits une seule fois dans un bloc `x-hardening` que tous les services réutilisent (ancre YAML), au lieu d'être copiés cinq fois.
- **`build` et `image` ensemble.** Chaque service a à la fois `build:` (pour construire l'image en local) et `image:` (pour récupérer l'image publiée par la CI). Le même fichier sert donc en développement comme en production.

### 2.3 Les environnements

Le sujet demandait de gérer plusieurs environnements. J'ai gardé un seul `docker-compose.yml` et créé un fichier de variables par environnement dans `env/` :

| | test | uat (recette) | prod |
|---|---|---|---|
| Images | construites en local | dernière version de `main` sur GHCR | version `v1.0.0` sur GHCR |
| Port | 8080 | 8081 | 80 |
| Niveau de logs | debug | info | warn |
| Comptes de démo | oui | oui | non |
| Ressources par service | 0,5 CPU / 256 Mo | 0,5 CPU / 256 Mo | 1 CPU / 512 Mo |

On choisit l'environnement au lancement :

```bash
docker compose --env-file env/test.env up -d --build      # test : build local
docker compose --env-file env/prod.env up -d --no-build   # prod : images publiées
```

Chaque environnement a son propre nom de projet (`riviera-test`, `riviera-uat`, `riviera-prod`), donc les trois peuvent tourner sur la même machine sans se mélanger : conteneurs, réseaux et volumes sont séparés.

---

## 3. Dépôt Git et pipelines CI/CD

### 3.1 Le dépôt Git

Tout le projet est dans **un seul dépôt** (monorepo) : les trois services, le frontend, le compose, les workflows et la documentation. Pour un projet de cette taille, c'est plus simple : un seul `git clone` pour tout récupérer, et une modification qui touche deux services tient dans un seul commit.

```
frontend/                  Nginx + pages du site
services/auth-service/     Node.js
services/boat-service/     Python
services/booking-service/  Node.js
db/init/                   script de création de la base
env/                       variables par environnement
secrets/                   exemples de secrets (les vrais sont ignorés par Git)
scripts/                   génération des secrets, test de bout en bout
.github/                   workflows GitHub Actions et Dependabot
docs/                      ce rapport et le déroulé de la démo
```

Quelques réglages utiles :

- le `.gitignore` exclut les secrets, `node_modules`, les environnements virtuels Python et les rapports de tests ;
- le `.gitattributes` force les fins de ligne Unix (LF). Je développe sous Windows, mais les conteneurs tournent sous Linux, et un script shell avec des fins de ligne Windows ne s'exécute pas ;
- l'historique suit les étapes du projet, avec un commit par partie (squelette, auth-service, boat-service, booking-service, frontend, docker-compose, CI/CD, documentation, PDF du rapport). Les messages sont en français et commencent par la partie concernée.

Comme je travaillais seul, j'ai commité directement sur `main`. J'ai aussi activé **Dependabot** : chaque semaine, il vérifie s'il existe des mises à jour pour les images de base, les paquets npm et pip et les actions GitHub, et ouvre une pull request le cas échéant. La CI tourne sur ces pull requests, donc je vois tout de suite si une mise à jour casse quelque chose.

### 3.2 Les pipelines

J'ai utilisé **GitHub Actions**. Chaque service a son propre workflow (`ci-auth`, `ci-boat`, `ci-booking`, `ci-frontend`), qui ne se déclenche que si le dossier de ce service a changé. Si je modifie boat-service, seul son pipeline tourne. Les quatre workflows appellent un **workflow réutilisable** commun, `_service.yml`, pour ne pas copier quatre fois les mêmes étapes.

Chaque pipeline enchaîne quatre jobs :

```
lint ──> test ──> build & push ──> scan
```

| Job | Ce qu'il fait |
|---|---|
| **lint** | vérifie la qualité du code (ESLint pour Node, ruff pour Python) et des Dockerfiles (hadolint) |
| **test** | lance les tests unitaires (Jest ou pytest) avec un minimum de 80 % de couverture |
| **build & push** | construit l'image Docker et la publie sur GitHub Container Registry (GHCR) |
| **scan** | analyse l'image publiée avec Trivy et les dépendances avec `npm audit` / `pip-audit` ; échoue s'il y a une faille grave qui a un correctif |

Si un job échoue, les suivants ne tournent pas : une image dont les tests échouent n'est jamais publiée.

Un cinquième workflow, **e2e**, démarre l'application complète avec docker compose sur la machine GitHub, puis lance le script `scripts/smoke-test.sh`. Ce script fait 36 vérifications sur l'application qui tourne vraiment : pages accessibles ou non selon qu'on est connecté, parcours complet de réservation et de paiement, droits admin, services internes injoignables de l'extérieur, etc.

Les images publiées reçoivent plusieurs tags :

| Quand | Tags |
|---|---|
| à chaque push | `sha-<commit>` (on sait exactement quel code est dans l'image) |
| push sur `main` | `latest` en plus |
| création du tag Git `v1.0.0` | `v1.0.0` en plus (version de production) |

Côté sécurité de la CI, je n'utilise pas de token personnel : la publication se fait avec le `GITHUB_TOKEN` fourni automatiquement par GitHub, et le droit d'écrire dans le registre n'est donné qu'au job de publication. Les actions externes sensibles (hadolint, Trivy) sont fixées sur un commit précis plutôt que sur un tag, qui pourrait être modifié.

### 3.3 Les tests

| Service | Outil | Nombre de tests | Couverture |
|---|---|---|---|
| auth-service | Jest + supertest | 40 | 98 % |
| booking-service | Jest + supertest | 49 | 98 % |
| boat-service | pytest | 34 | 96 % |
| application complète | `smoke-test.sh` | 36 vérifications | — |

Les tests unitaires n'ont pas besoin de base de données : chaque service reçoit son accès à la base en paramètre, et dans les tests je lui donne une fausse base en mémoire. Les tests sont donc rapides (quelques secondes) et donnent le même résultat partout.

### 3.4 Mise en place

1. J'ai créé le dépôt sur github.com et poussé le code étape par étape.
2. Au premier push des workflows, le lint, les tests et le test e2e sont passés au vert, mais la publication des images a été refusée (voir la rétrospective). Une fois le problème corrigé, j'ai relancé les jobs et tout est passé.
3. Les images sont publiques sur GHCR : n'importe qui peut faire un `docker pull ghcr.io/polmzenou/riviera-auth` sans se connecter.
4. La version présentée en démonstration correspond au tag `v1.0.0`, qui reconstruit et publie les quatre images d'un coup.

---

## 4. Gestion de projet

### 4.1 Contexte

J'ai réalisé le projet seul, avec une contrainte de temps forte : la démonstration a lieu le 30/10 à 9 h et le rendu le soir même. Il fallait donc un périmètre réaliste et avancer par étapes qui fonctionnent chacune de leur côté, pour avoir toujours quelque chose de présentable.

### 4.2 Découpage des tâches

J'ai découpé le travail en neuf étapes. Chacune correspond à un commit dans le dépôt :

| # | Étape | Contenu | Considérée finie quand… |
|---|---|---|---|
| 1 | Squelette | arborescence, script de la base, secrets, environnements | la base démarre avec ses schémas et ses données |
| 2 | auth-service | comptes, sessions, rôles, admin | tests verts et image construite |
| 3 | boat-service | catalogue, filtres, gestion par l'admin | tests verts et image construite |
| 4 | booking-service | réservations, paiement, annulation | tests verts et image construite |
| 5 | Frontend | pages du site, configuration Nginx | parcours complet faisable dans le navigateur |
| 6 | docker-compose | réseaux, secrets, healthchecks, limites, test de bout en bout | les 5 conteneurs sont `healthy` et le test passe |
| 7 | CI/CD | workflows GitHub Actions, publication sur GHCR | tous les workflows au vert |
| 8 | Documentation | README, rapport, déroulé de la démo | relu |
| 9 | Rapport PDF | export du rapport | — |

### 4.3 Organisation

- **L'API d'abord.** Avant d'écrire du code, j'ai listé toutes les routes de l'API : URL, méthode, codes de retour et format des erreurs (`{"error": "..."}` partout, y compris côté Python). J'ai pu écrire le frontend sans attendre que tout le back soit fini, et les trois services répondent de la même façon.
- **Un service à la fois.** Je ne passais au suivant qu'une fois les tests du précédent au vert et son image Docker construite. Je n'avais jamais trois services à moitié finis en même temps.
- **D'abord l'obligatoire.** J'ai commencé par tout ce que le sujet demande (comptes, rôles, compose, CI), et seulement ensuite les « bonus » : paiement simulé, scan de sécurité, trois environnements, durcissement des conteneurs. Comme ça, même en cas de retard, l'essentiel était là.
- **Tester en continu.** J'ai écrit le test de bout en bout dès que l'application démarrait en entier, puis je l'ai relancé après chaque modification. Ça m'a évité de découvrir des régressions la veille de la démo.
- **Suivi simple.** Une checklist par étape, que je cochais au fur et à mesure. Pour un projet seul et court, un vrai outil de gestion (Jira, Trello) aurait pris plus de temps qu'il n'en aurait fait gagner.
- **Outils.** VS Code, Docker Desktop sous Windows, Git Bash pour les scripts shell, GitHub pour le dépôt, la CI et le registre d'images.

### 4.4 Répartition du temps (approximative)

| Partie | Part du temps |
|---|---|
| Les trois services back-end et leurs tests | 35 % |
| Frontend et configuration Nginx | 15 % |
| Dockerfiles, docker-compose, durcissement | 20 % |
| CI/CD | 15 % |
| Documentation et préparation de la démo | 15 % |

La partie Docker a pris plus de temps que prévu, surtout le durcissement : chaque réglage (lecture seule, pas de root, pas de privilèges) cassait quelque chose qu'il fallait comprendre avant de corriger.

---

## 5. Rétrospective

### 5.1 Difficultés rencontrées et solutions

**Le dossier parent était déjà un dépôt Git.** Mon dossier utilisateur Windows était lui-même un dépôt Git, ce qui fait que `git status` dans mon projet me listait tous mes fichiers personnels. J'ai fait un `git init` dédié dans le dossier du projet pour qu'il ait son propre dépôt.

**Le push vers GitHub refusé.** J'avais d'abord créé un premier dépôt `riviera` pour faire des essais, puis le dépôt définitif `riviera-boats`. Mon `origin` pointait encore vers l'ancien, qui avait un autre historique, et Git refusait le push (`rejected… fetch first`). J'ai failli faire un `push --force`, ce qui aurait écrasé l'ancien dépôt pour rien. En fait, il suffisait de corriger l'adresse avec `git remote set-url origin …`.

**La publication des images refusée par GHCR.** Au premier passage de la CI, le lint et les tests étaient verts, mais le push des images échouait avec `permission_denied: write_package`. Les packages `riviera-*` existaient déjà : ils avaient été créés par mes essais sur l'ancien dépôt, et un package GHCR est rattaché au dépôt qui l'a créé. Le nouveau dépôt n'avait donc pas le droit d'y écrire. J'ai supprimé les anciens packages dans les paramètres GitHub et relancé les jobs, qui les ont recréés rattachés au bon dépôt. Les pull requests ouvertes par Dependabot juste après le premier push échouaient pour la même raison, ce qui m'a d'abord fait croire que mes mises à jour étaient cassées.

**Windows contre Linux.** Mon script de test lancé dans la CI ne s'exécutait pas : Windows ne gère pas le droit d'exécution des fichiers, donc Git l'avait enregistré comme un simple fichier texte. Je l'ai corrigé avec `git add --chmod=+x`. Les fins de ligne posaient aussi problème (un script avec des fins de ligne Windows plante sous Linux), d'où le `.gitattributes` qui force le format Unix.

**PostgreSQL refusait de démarrer une fois durci.** Avec le système de fichiers en lecture seule et sans privilèges, le script de démarrage de l'image officielle plantait, parce qu'il a besoin d'être root pour changer les droits de certains dossiers. J'ai lancé le conteneur directement avec l'utilisateur `postgres` et ajouté des dossiers temporaires en mémoire (`tmpfs`) là où Postgres a besoin d'écrire.

**Les services démarraient avant la base.** Au tout premier lancement, les services essayaient de se connecter pendant que la base créait encore ses tables, et plantaient. Le `depends_on` simple ne suffisait pas, puisqu'il attend seulement que le conteneur soit lancé, pas qu'il soit prêt. J'ai ajouté un healthcheck sur la base et `condition: service_healthy`. Même là, le healthcheck répondait « OK » trop tôt, pendant l'initialisation. Il a fallu le faire passer par le réseau (TCP) pour qu'il attende la vraie fin du démarrage.

**Le scan de sécurité tout rouge.** La première fois que j'ai lancé Trivy, il a trouvé des dizaines de failles graves. Pour le frontend, la version 1.29 de Nginx n'était plus maintenue : je suis passé à la 1.30. Pour les images Node et Python, les failles venaient en fait de npm et de pip eux-mêmes, qui ne servent à rien une fois l'application lancée. Je les ai supprimés de l'image finale. Résultat : zéro faille grave corrigeable, et des images plus légères.

**Des dates décalées d'un jour.** Certaines réservations s'affichaient avec un jour d'écart. Le pilote PostgreSQL de Node convertit les dates en objets `Date` avec le fuseau horaire local, et minuit à Paris, c'est encore la veille en UTC. J'ai gardé les dates sous forme de texte (`AAAA-MM-JJ`) de bout en bout.

**La politique de sécurité bloquait mes scripts.** Après avoir activé la Content Security Policy, plus aucun bouton ne marchait : j'avais encore des petits bouts de JavaScript directement dans le HTML (`onclick=…`), que la CSP bloque. J'ai tout déplacé dans des fichiers `.js` et ajouté une vérification au build du frontend pour que ça ne revienne pas.

**Un test qui ne pouvait jamais échouer.** Cette vérification passait toujours, même quand j'ajoutais exprès du JavaScript dans une page. La commande `grep` de l'image Alpine ne connaît pas toutes les options de la version classique : elle sortait en erreur, et mon test prenait l'erreur pour un succès. Depuis, quand j'écris un test, je vérifie aussi qu'il échoue bien quand il doit échouer.

### 5.2 Ce qui a bien marché

- Le découpage en étapes : à chaque instant, j'avais une version qui fonctionnait.
- Les tests dans le Dockerfile (étape `test`) : la CI et mon poste lancent exactement les mêmes vérifications, donc pas de surprise du type « ça marche chez moi ».
- Le bloc `x-hardening` du compose : les réglages de sécurité sont écrits une seule fois et appliqués partout.
- Le test de bout en bout, qui m'a fait gagner beaucoup de temps : en une commande, je savais si j'avais cassé quelque chose.

### 5.3 Si c'était à refaire

- **Mettre la CI en place dès le premier service**, et pas à la fin. J'aurais découvert le problème des packages GHCR bien plus tôt, au calme.
- **Créer le dépôt GitHub définitif dès le départ**, avec le bon nom, au lieu de faire des essais dans un autre dépôt.
- **Travailler avec des branches et des pull requests**, même seul. La CI validerait chaque changement avant qu'il arrive sur `main`, et l'historique serait plus lisible.
- **Faire des commits plus petits et plus fréquents**, plutôt qu'un gros commit par partie.
- **Utiliser un outil de migration de base** (Flyway, Alembic…) au lieu d'un script exécuté une seule fois au premier démarrage. Aujourd'hui, pour modifier une table, il faut supprimer le volume et repartir de zéro.
- **Ajouter le HTTPS**, avec un reverse-proxy comme Traefik et des certificats Let's Encrypt. La configuration de production est déjà prête pour (cookies `Secure`).
- **Prévoir plus de temps pour le durcissement Docker**, que j'avais sous-estimé.

### 5.4 Bilan

Ce projet m'a surtout appris tout ce qu'il y a autour du code : faire tourner plusieurs services ensemble, les isoler, gérer les secrets proprement et automatiser les tests et la publication. Je connaissais déjà Docker pour lancer un conteneur ou écrire un Dockerfile simple. Je ne connaissais pas encore les builds multi-étapes, les healthchecks, les réseaux internes ou les secrets Docker, et c'est ce que je réutiliserai en priorité. Côté CI/CD, j'ai compris l'intérêt d'avoir un pipeline qui bloque la publication d'une image dès qu'un test ou un scan échoue : ça oblige à corriger tout de suite au lieu d'accumuler les problèmes.

---

## Annexe : commandes utiles

```bash
./scripts/gen-secrets.sh                                    # générer les secrets locaux
docker compose --env-file env/test.env up -d --build --wait # construire et lancer
docker compose --env-file env/test.env ps                   # état des conteneurs
docker compose --env-file env/test.env logs -f booking-service
./scripts/smoke-test.sh                                     # test de bout en bout
docker build --target test services/boat-service            # lint + tests dans Docker
docker compose --env-file env/test.env down -v              # tout arrêter et vider la base

git tag v1.0.0 && git push origin v1.0.0                    # publier la version 1.0.0
```

Les comptes de démonstration et les cartes de test sont listés dans le `README.md`.
