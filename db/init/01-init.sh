#!/bin/sh
# Exécuté par l'image postgres au premier démarrage uniquement (volume vide).
# Un schéma et un rôle par service, chaque rôle n'a que du DML sur son schéma.
set -eu

read_secret() {
  tr -d '\r\n' < "$1"
}

AUTH_PW="$(read_secret "$AUTH_DB_PASSWORD_FILE")"
BOAT_PW="$(read_secret "$BOAT_DB_PASSWORD_FILE")"
BOOKING_PW="$(read_secret "$BOOKING_DB_PASSWORD_FILE")"

psql -v ON_ERROR_STOP=1 \
     --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
     -v auth_pw="$AUTH_PW" -v boat_pw="$BOAT_PW" -v booking_pw="$BOOKING_PW" \
     -v db_name="$POSTGRES_DB" <<'EOSQL'

REVOKE ALL ON DATABASE :"db_name" FROM PUBLIC;
REVOKE ALL ON SCHEMA public FROM PUBLIC;

-- pour la contrainte EXCLUDE (= sur un entier + && sur un daterange)
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE ROLE auth_svc    LOGIN PASSWORD :'auth_pw';
CREATE ROLE boat_svc    LOGIN PASSWORD :'boat_pw';
CREATE ROLE booking_svc LOGIN PASSWORD :'booking_pw';

GRANT CONNECT ON DATABASE :"db_name" TO auth_svc, boat_svc, booking_svc;

-- auth
CREATE SCHEMA auth;

CREATE TABLE auth.users (
    id            INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    email         TEXT        NOT NULL UNIQUE,
    password_hash TEXT        NOT NULL,
    full_name     TEXT        NOT NULL,
    role          TEXT        NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- token_hash = sha256 du jeton envoyé dans le cookie
CREATE TABLE auth.sessions (
    token_hash TEXT        PRIMARY KEY,
    user_id    INTEGER     NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX sessions_user_idx ON auth.sessions(user_id);

-- boats
CREATE SCHEMA boats;

CREATE TABLE boats.ports (
    id   INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    city TEXT NOT NULL
);

CREATE TABLE boats.boats (
    id               INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name             TEXT          NOT NULL,
    type             TEXT          NOT NULL CHECK (type IN ('voilier', 'catamaran', 'yacht', 'semi-rigide', 'moteur')),
    port_id          INTEGER       NOT NULL REFERENCES boats.ports(id),
    capacity         INTEGER       NOT NULL CHECK (capacity BETWEEN 1 AND 50),
    length_m         NUMERIC(4,1)  NOT NULL CHECK (length_m > 0),
    price_per_day    NUMERIC(10,2) NOT NULL CHECK (price_per_day > 0),
    license_required BOOLEAN       NOT NULL DEFAULT true,
    description      TEXT          NOT NULL DEFAULT '',
    created_at       TIMESTAMPTZ   NOT NULL DEFAULT now()
);
CREATE INDEX boats_port_idx ON boats.boats(port_id);

-- bookings (user_id et boat_id viennent des autres services, pas de FK)
CREATE SCHEMA bookings;

CREATE TABLE bookings.bookings (
    id          INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id     INTEGER       NOT NULL,
    boat_id     INTEGER       NOT NULL,
    boat_name   TEXT          NOT NULL,
    port_name   TEXT          NOT NULL,
    start_date  DATE          NOT NULL,
    end_date    DATE          NOT NULL,
    total_price NUMERIC(10,2) NOT NULL,
    status      TEXT          NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'cancelled')),
    payment_ref TEXT,
    card_last4  TEXT,
    created_at  TIMESTAMPTZ   NOT NULL DEFAULT now(),
    paid_at     TIMESTAMPTZ,
    CHECK (end_date >= start_date),
    -- pas deux réservations actives qui se chevauchent sur le même bateau
    CONSTRAINT bookings_no_overlap EXCLUDE USING gist (
        boat_id WITH =,
        daterange(start_date, end_date, '[]') WITH &&
    ) WHERE (status <> 'cancelled')
);
CREATE INDEX bookings_user_idx ON bookings.bookings(user_id);

-- droits
GRANT USAGE ON SCHEMA auth TO auth_svc;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA auth TO auth_svc;

GRANT USAGE ON SCHEMA boats TO boat_svc;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA boats TO boat_svc;

GRANT USAGE ON SCHEMA bookings TO booking_svc;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA bookings TO booking_svc;

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA auth     TO auth_svc;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA boats    TO boat_svc;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA bookings TO booking_svc;

ALTER ROLE auth_svc    SET search_path = auth;
ALTER ROLE boat_svc    SET search_path = boats;
ALTER ROLE booking_svc SET search_path = bookings;

-- données de démo
INSERT INTO boats.ports (name, city) VALUES
    ('Port Lympia',          'Nice'),
    ('Vieux-Port de Cannes', 'Cannes'),
    ('Port Vauban',          'Antibes'),
    ('Port de Saint-Tropez', 'Saint-Tropez'),
    ('Port Hercule',         'Monaco'),
    ('Port de Menton-Garavan', 'Menton');

INSERT INTO boats.boats (name, type, port_id, capacity, length_m, price_per_day, license_required, description)
SELECT b.name, b.type, p.id, b.capacity, b.length_m, b.price_per_day, b.license_required, b.description
FROM (VALUES
    ('Lou Pescadou',  'voilier',     'Port Lympia',            6,  9.5,  220.00, true,  'Voilier familial idéal pour longer la Baie des Anges jusqu''à Villefranche.'),
    ('Baie des Anges','semi-rigide', 'Port Lympia',            8,  7.2,  290.00, true,  'Semi-rigide rapide pour rejoindre le Cap Ferrat et ses criques.'),
    ('Croisette',     'yacht',       'Vieux-Port de Cannes',  10, 18.0, 1450.00, true,  'Yacht avec skipper pour une journée aux îles de Lérins.'),
    ('Sainte-Marguerite','catamaran','Vieux-Port de Cannes',  12, 12.4,  680.00, true,  'Catamaran spacieux, parfait pour un mouillage à l''île Sainte-Marguerite.'),
    ('Cap d''Antibes','moteur',      'Port Vauban',            7,  8.1,  340.00, true,  'Bateau à moteur avec bain de soleil pour faire le tour du Cap.'),
    ('Juan-les-Pins', 'semi-rigide', 'Port Vauban',            5,  5.9,  150.00, false, 'Petit semi-rigide sans permis (6 CV), idéal pour débuter.'),
    ('Pampelonne',    'catamaran',   'Port de Saint-Tropez',  10, 13.2,  890.00, true,  'Catamaran pour une journée à la plage de Pampelonne.'),
    ('Bailli de Suffren','voilier',  'Port de Saint-Tropez',   8, 12.0,  410.00, true,  'Voilier classique en bois, élégance tropézienne garantie.'),
    ('Rocher',        'yacht',       'Port Hercule',          12, 24.5, 3200.00, true,  'Yacht de prestige avec équipage, au pied du Rocher.'),
    ('Larvotto',      'moteur',      'Port Hercule',           6,  9.0,  520.00, true,  'Day-boat pour longer la côte jusqu''à Èze et Cap-d''Ail.'),
    ('Garavan',       'semi-rigide', 'Port de Menton-Garavan', 6,  6.5,  180.00, false, 'Semi-rigide sans permis pour explorer la frontière italienne.')
) AS b(name, type, port_name, capacity, length_m, price_per_day, license_required, description)
JOIN boats.ports p ON p.name = b.port_name;

EOSQL

echo "init riviera : ok"
