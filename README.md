# RivieraBoats ⚓

Location de bateaux sur la Côte d'Azur (Nice, Cannes, Antibes, Saint-Tropez, Monaco, Menton).
Projet du module **« Dév avec Docker »** : une application web en micro-services, entièrement conteneurisée, avec un pipeline CI/CD qui teste, construit et publie les images sur GitHub Container Registry.

![ci-auth](https://github.com/polmzenou/riviera-boats/actions/workflows/ci-auth.yml/badge.svg)
![ci-boat](https://github.com/polmzenou/riviera-boats/actions/workflows/ci-boat.yml/badge.svg)
![ci-booking](https://github.com/polmzenou/riviera-boats/actions/workflows/ci-booking.yml/badge.svg)
![ci-frontend](https://github.com/polmzenou/riviera-boats/actions/workflows/ci-frontend.yml/badge.svg)
![e2e](https://github.com/polmzenou/riviera-boats/actions/workflows/ci-e2e.yml/badge.svg)

## Architecture

```
navigateur ──:8080──> frontend  (Nginx non-root : site statique + reverse-proxy + auth_request)
                         │        réseau "backend" (internal: true, aucun port publié)
         ┌───────────────┼──────────────────┬───────────────────┐
   auth-service     boat-service       booking-service     PostgreSQL 17
   Node 22/Express  Python 3.13/FastAPI Node 22/Express    1 schéma + 1 rôle SQL
   comptes,         catalogue des       réservations,      par service
   sessions, rôles  bateaux et ports    paiement simulé
```

| Conteneur | Image | Rôle |
|---|---|---|
| `frontend` | `nginxinc/nginx-unprivileged:1.30-alpine` | Pages HTML/CSS/JS, proxy `/api/*`, contrôle d'accès `auth_request`. **Seul port publié.** |
| `auth-service` | `node:22-alpine` | Inscription, connexion, sessions en base (cookie `HttpOnly`), rôles, administration des comptes |
| `boat-service` | `python:3.13-slim` | Catalogue (filtres port/type/capacité/prix), CRUD réservé aux admins |
| `booking-service` | `node:22-alpine` | Réservations (anti-chevauchement), paiement simulé, annulation |
| `db` | `postgres:17-alpine` | Une base, un schéma et un utilisateur SQL par service |

Appels entre services : `booking → boat` (prix et existence du bateau), `auth → booking` (purge des réservations d'un compte supprimé).

## Démarrage rapide

Prérequis : Docker Desktop (ou Docker Engine + Compose v2).

```bash
# 1. Générer les secrets locaux (gitignorés) à partir de secrets/*.example
./scripts/gen-secrets.sh            # Linux / macOS / Git Bash
.\scripts\gen-secrets.ps1           # Windows PowerShell

# 2. Construire et lancer les 5 conteneurs
docker compose --env-file env/test.env up -d --build --wait

# 3. Ouvrir http://localhost:8080
```

Pour repartir d'une base vierge : `docker compose --env-file env/test.env down -v`.

### Comptes de démo (environnement `test` et `uat`)

| Rôle | Email | Mot de passe |
|---|---|---|
| Admin | `admin@rivieraboats.fr` | contenu de `secrets/admin_password.txt` (`Admin!Riviera2026` par défaut) |
| Admin | `capitaine@rivieraboats.fr` | `Demo1234!` |
| Client | `marie.dupont@example.com` | `Demo1234!` |
| Client | `luc.martin@example.com` | `Demo1234!` |

Paiement simulé : carte acceptée `4242 4242 4242 4242`, carte refusée `4000 0000 0000 0002` (expiration future, CVC quelconque).

## Environnements

Un seul `docker-compose.yml`, un fichier de variables par environnement :

| | `env/test.env` | `env/uat.env` | `env/prod.env` |
|---|---|---|---|
| Images | construites localement (`local`) | GHCR `latest` (main) | GHCR `v1.0.0` (tag) |
| Port | 8080 | 8081 | 80 |
| Logs | debug | info | warn |
| Cookies `Secure` | non | non | oui |
| Comptes de démo | oui | oui | non |
| Ressources | 0,5 CPU / 256 Mo par service | idem | 1 CPU / 512 Mo |

```bash
docker compose --env-file env/uat.env pull && docker compose --env-file env/uat.env up -d --no-build
```

Chaque environnement a son propre nom de projet (`riviera-test`, `riviera-uat`, `riviera-prod`) : conteneurs, réseaux et volumes sont séparés.

## Tests

```bash
# Tests unitaires (base de données remplacée par une doublure en mémoire)
cd services/auth-service    && npm ci && npm test      # Jest + supertest (40 tests)
cd services/booking-service && npm ci && npm test      # Jest + supertest (49 tests)
cd services/boat-service    && pip install -r requirements-dev.txt && pytest   # 34 tests

# Les mêmes tests, dans Docker (stage "test" de chaque Dockerfile)
docker build --target test services/auth-service

# Test de bout en bout sur la stack démarrée (36 vérifications)
./scripts/smoke-test.sh
```

## CI/CD

Un workflow par service (`ci-auth`, `ci-boat`, `ci-booking`, `ci-frontend`), déclenché uniquement quand le dossier du service change, plus un tag `v*` qui reconstruit tout. Tous délèguent au workflow réutilisable [`_service.yml`](.github/workflows/_service.yml) :

```
lint (ESLint/ruff + hadolint) ──> test (Jest/pytest + couverture) ──> build-push (GHCR) ──> scan (Trivy + npm audit/pip-audit)
```

Tags publiés : `sha-<commit>` à chaque push, `latest` sur `main`, `v1.0.0` sur un tag git.
Le workflow [`ci-e2e.yml`](.github/workflows/ci-e2e.yml) démarre la stack complète et rejoue `smoke-test.sh`.

## Structure

```
frontend/                 Dockerfile, nginx/ (conf + snippets), public/ (HTML, CSS, JS)
services/auth-service/    Node : src/, tests/, Dockerfile
services/boat-service/    Python : app/, tests/, Dockerfile
services/booking-service/ Node : src/, tests/, Dockerfile
db/init/01-init.sh        schémas, rôles SQL, droits, données de démo
env/                      variables par environnement
secrets/                  *.example (les vrais fichiers sont gitignorés)
scripts/                  génération des secrets, test de fumée
docs/RAPPORT.md           rapport du projet
```

## Crédits

Les photos de bateaux (`frontend/public/img/boats/`) proviennent de Wikimedia Commons, sous licences CC BY et CC BY-SA ; auteurs et liens dans [CREDITS.txt](frontend/public/img/boats/CREDITS.txt). Polices sous SIL OFL 1.1 ([OFL.txt](frontend/public/fonts/OFL.txt)).
