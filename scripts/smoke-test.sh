#!/usr/bin/env bash
# usage : ./scripts/smoke-test.sh [url]   (ENV_FILE=env/uat.env pour un autre env)
set -u
cd "$(dirname "$0")/.." || exit 1

BASE="${1:-http://localhost:8080}"
ENV_FILE="${ENV_FILE:-env/test.env}"
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@rivieraboats.fr}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-$(tr -d '\r\n' < secrets/admin_password.txt)}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
PASS=0
FAIL=0

check() { # description attendu obtenu
  if [ "$2" = "$3" ]; then
    PASS=$((PASS + 1)); printf '  \033[32mOK\033[0m %s\n' "$1"
  else
    FAIL=$((FAIL + 1)); printf '  \033[31mKO\033[0m %s (attendu %s, obtenu %s)\n' "$1" "$2" "$3"
  fi
}
# affiche le code HTTP, le corps va dans $TMP/body
http() { curl -s -o "$TMP/body" -w '%{http_code}' "$@"; }
post() { local url="$1"; shift; http -H 'Content-Type: application/json' "$@" "$BASE$url"; }
first_id() { grep -o '"id":[0-9]*' "$TMP/body" | head -1 | cut -d: -f2; }

echo "1. Visiteur anonyme"
check "accueil public" 200 "$(http "$BASE/")"
check "page de login publique" 200 "$(http "$BASE/login.html")"
check "boats.html -> redirection login" 302 "$(http "$BASE/boats.html")"
check "admin.html -> redirection login" 302 "$(http "$BASE/admin.html")"
check "API catalogue refusée (401)" 401 "$(http "$BASE/api/boats")"
check "API réservations refusée (401)" 401 "$(http "$BASE/api/bookings")"
check "route /internal non exposée" 404 "$(http "$BASE/internal/verify")"

echo "2. Isolation réseau : seuls Nginx et son port $BASE sont joignables"
for port in 3000 3001 8000 5432; do
  if curl -s -m 2 -o /dev/null "http://localhost:$port"; then r=ouvert; else r=fermé; fi
  check "port $port fermé depuis l'hôte" fermé "$r"
done

echo "3. Parcours client"
U="$TMP/user"
EMAIL="smoke.$(date +%s)@example.com"
check "inscription" 201 "$(post /api/auth/register -c "$U" -d "{\"email\":\"$EMAIL\",\"password\":\"Secret123!\",\"fullName\":\"Client Smoke\"}")"
USER_ID="$(first_id)"
check "cookie de session HttpOnly" 1 "$(grep -c '#HttpOnly_' "$U")"
check "boats.html accessible connecté" 200 "$(http -b "$U" "$BASE/boats.html")"
check "admin.html interdit à un client (403)" 403 "$(http -b "$U" "$BASE/admin.html")"
check "catalogue filtré (boat-service Python)" 200 "$(http -b "$U" "$BASE/api/boats?type=yacht")"
check "en-têtes X-User-* forgés ignorés" 403 "$(post /api/boats -b "$U" -H 'X-User-Role: admin' -H 'X-User-Id: 1' \
  -d '{"name":"Pirate","type":"yacht","portId":1,"capacity":2,"lengthM":5,"pricePerDay":1}')"

OFFSET=$((20 + RANDOM % 300))
START="$(date -d "+$OFFSET days" +%F)"
END="$(date -d "+$((OFFSET + 1)) days" +%F)"
BOOKING="{\"boatId\":1,\"startDate\":\"$START\",\"endDate\":\"$END\"}"
check "réservation (booking Node -> boat Python)" 201 "$(post /api/bookings -b "$U" -d "$BOOKING")"
BOOKING_ID="$(first_id)"
check "chevauchement de dates refusé (409)" 409 "$(post /api/bookings -b "$U" -d "$BOOKING")"
CARD='"holder":"Client Smoke","expiry":"12/30","cvc":"123"'
check "carte de test refusée (402)" 402 "$(post "/api/bookings/$BOOKING_ID/pay" -b "$U" -d "{\"cardNumber\":\"4000000000000002\",$CARD}")"
check "paiement accepté" 200 "$(post "/api/bookings/$BOOKING_ID/pay" -b "$U" -d "{\"cardNumber\":\"4242424242424242\",$CARD}")"
check "statut payé" 1 "$(grep -c '"status":"paid"' "$TMP/body")"

echo "4. Administration"
A="$TMP/admin"
check "connexion admin" 200 "$(post /api/auth/login -c "$A" -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}")"
ADMIN_ID="$(first_id)"
check "admin.html accessible à l'admin" 200 "$(http -b "$A" "$BASE/admin.html")"
check "liste des comptes" 200 "$(http -b "$A" "$BASE/api/auth/users")"
check "suppression d'un compte admin refusée (403)" 403 "$(http -b "$A" -X DELETE "$BASE/api/auth/users/$ADMIN_ID")"
check "suppression du compte client" 204 "$(http -b "$A" -X DELETE "$BASE/api/auth/users/$USER_ID")"
check "session du compte supprimé invalidée" 302 "$(http -b "$U" "$BASE/boats.html")"
http -b "$A" "$BASE/api/bookings?scope=all" > /dev/null
check "réservations du compte purgées (auth -> booking)" 0 "$(grep -c "\"id\":$BOOKING_ID," "$TMP/body")"

echo "5. Suppression de son propre compte"
S="$TMP/self"
check "inscription" 201 "$(post /api/auth/register -c "$S" -d "{\"email\":\"self.$EMAIL\",\"password\":\"Secret123!\",\"fullName\":\"Compte Jetable\"}")"
check "DELETE /api/auth/me" 204 "$(http -b "$S" -X DELETE "$BASE/api/auth/me")"
check "plus de session ensuite" 401 "$(http -b "$S" "$BASE/api/auth/me")"

echo "6. Déconnexion"
check "logout admin" 204 "$(http -b "$A" -X POST "$BASE/api/auth/logout")"
check "admin.html de nouveau fermé" 302 "$(http -b "$A" "$BASE/admin.html")"

echo "7. Cloisonnement SQL : un service ne lit pas le schéma d'un autre"
denied="$(docker compose --env-file "$ENV_FILE" exec -T db psql -U auth_svc -d riviera -tAc 'SELECT count(*) FROM boats.boats' 2>&1)"
check "auth_svc -> boats.boats refusé" 1 "$(echo "$denied" | grep -c 'permission denied')"
own="$(docker compose --env-file "$ENV_FILE" exec -T db psql -U boat_svc -d riviera -tAc 'SELECT count(*) > 0 FROM boats.boats' 2>&1)"
check "boat_svc -> boats.boats autorisé" t "$(echo "$own" | tr -d '[:space:]')"

echo
echo "Résultat : $PASS OK, $FAIL KO"
[ "$FAIL" -eq 0 ]
