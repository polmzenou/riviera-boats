#!/bin/sh
# Crée secrets/*.txt à partir des .example (aléatoire, sauf le mot de passe admin).
# Ne touche pas aux fichiers existants.
set -eu
cd "$(dirname "$0")/../secrets"

for example in *.txt.example; do
  target="${example%.example}"
  if [ -f "$target" ]; then
    echo "existe déjà : $target"
    continue
  fi
  case "$target" in
    admin_password.txt) cp "$example" "$target" ;;
    *) openssl rand -hex 24 > "$target" ;;
  esac
  # lisible par les utilisateurs non-root des conteneurs
  chmod 644 "$target"
  echo "créé : $target"
done
