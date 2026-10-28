import pytest

from tests.conftest import ADMIN, USER

NEW_BOAT = {
    "name": "Esterel",
    "type": "catamaran",
    "portId": 1,
    "capacity": 8,
    "lengthM": 11.5,
    "pricePerDay": 600,
    "licenseRequired": True,
    "description": "Catamaran de croisière",
}


def test_health_ok(client):
    assert client.get("/health").json() == {"status": "ok"}


def test_health_db_down(client, repo):
    repo.healthy = False
    assert client.get("/health").status_code == 503


def test_list_all_boats_in_camel_case(client):
    res = client.get("/api/boats")
    assert res.status_code == 200
    boats = res.json()
    assert len(boats) == 3
    assert boats[0]["pricePerDay"] == 220.0
    assert boats[0]["port"] == {"id": 1, "name": "Port Lympia", "city": "Nice"}
    assert "price_per_day" not in boats[0]


@pytest.mark.parametrize(
    ("query", "expected_ids"),
    [
        ("port=2", {2, 3}),
        ("type=yacht", {2}),
        ("type=semi-rigide", {3}),
        ("minCapacity=6", {1, 2}),
        ("maxPrice=300", {1, 3}),
        ("port=2&maxPrice=200", {3}),
    ],
)
def test_filters(client, query, expected_ids):
    res = client.get(f"/api/boats?{query}")
    assert res.status_code == 200
    assert {b["id"] for b in res.json()} == expected_ids


@pytest.mark.parametrize("query", ["type=sous-marin", "port=0", "minCapacity=abc", "maxPrice=-5"])
def test_invalid_filters_return_422_with_uniform_error(client, query):
    res = client.get(f"/api/boats?{query}")
    assert res.status_code == 422
    assert res.json()["error"] == "Données invalides"


def test_get_boat(client):
    res = client.get("/api/boats/2")
    assert res.status_code == 200
    assert res.json()["name"] == "Croisette"


def test_get_unknown_boat(client):
    res = client.get("/api/boats/999")
    assert res.status_code == 404
    assert res.json() == {"error": "Bateau introuvable"}


def test_ports_and_types(client):
    assert [p["city"] for p in client.get("/api/boats/ports").json()] == ["Nice", "Cannes"]
    types = client.get("/api/boats/types").json()
    assert {"value": "semi-rigide", "label": "Semi-rigide"} in types
    assert len(types) == 5


def test_unknown_route(client):
    assert client.get("/nope").json() == {"error": "Not Found"}


def test_create_boat_as_admin(client, repo):
    res = client.post("/api/boats", json=NEW_BOAT, headers=ADMIN)
    assert res.status_code == 201
    body = res.json()
    assert body["id"] == 4
    assert body["port"]["city"] == "Nice"
    assert repo.boats[4]["price_per_day"] == 600


@pytest.mark.parametrize("headers", [USER, {}, {"X-User-Role": "Admin"}])
def test_create_boat_forbidden_without_admin_role(client, headers):
    res = client.post("/api/boats", json=NEW_BOAT, headers=headers)
    assert res.status_code == 403
    assert res.json() == {"error": "Réservé aux administrateurs"}


@pytest.mark.parametrize(
    "override",
    [{"name": "X"}, {"type": "pédalo"}, {"capacity": 0}, {"pricePerDay": 0}, {"portId": -1}],
)
def test_create_boat_validation(client, override):
    res = client.post("/api/boats", json=NEW_BOAT | override, headers=ADMIN)
    assert res.status_code == 422
    assert res.json()["details"]


def test_create_boat_unknown_port(client):
    res = client.post("/api/boats", json=NEW_BOAT | {"portId": 42}, headers=ADMIN)
    assert res.status_code == 422
    assert res.json() == {"error": "Port inconnu"}


def test_update_boat(client):
    res = client.put("/api/boats/1", json=NEW_BOAT | {"pricePerDay": 250}, headers=ADMIN)
    assert res.status_code == 200
    assert res.json()["pricePerDay"] == 250
    assert client.put("/api/boats/999", json=NEW_BOAT, headers=ADMIN).status_code == 404
    assert client.put("/api/boats/1", json=NEW_BOAT | {"portId": 42}, headers=ADMIN).status_code == 422
    assert client.put("/api/boats/1", json=NEW_BOAT, headers=USER).status_code == 403


def test_delete_boat(client, repo):
    assert client.delete("/api/boats/3", headers=USER).status_code == 403
    assert client.delete("/api/boats/3", headers=ADMIN).status_code == 204
    assert 3 not in repo.boats
    assert client.delete("/api/boats/3", headers=ADMIN).status_code == 404
