import copy

import pytest
from fastapi.testclient import TestClient

from app.main import create_app

PORTS = [
    {"id": 1, "name": "Port Lympia", "city": "Nice"},
    {"id": 2, "name": "Vieux-Port de Cannes", "city": "Cannes"},
]

BOATS = [
    {
        "id": 1,
        "name": "Lou Pescadou",
        "type": "voilier",
        "port_id": 1,
        "capacity": 6,
        "length_m": 9.5,
        "price_per_day": 220.0,
        "license_required": True,
        "description": "Voilier familial",
    },
    {
        "id": 2,
        "name": "Croisette",
        "type": "yacht",
        "port_id": 2,
        "capacity": 10,
        "length_m": 18.0,
        "price_per_day": 1450.0,
        "license_required": True,
        "description": "Yacht avec skipper",
    },
    {
        "id": 3,
        "name": "Juan",
        "type": "semi-rigide",
        "port_id": 2,
        "capacity": 5,
        "length_m": 5.9,
        "price_per_day": 150.0,
        "license_required": False,
        "description": "Sans permis",
    },
]


class FakeBoatRepository:
    def __init__(self):
        self.ports = copy.deepcopy(PORTS)
        self.boats = {b["id"]: copy.deepcopy(b) for b in BOATS}
        self.healthy = True
        self._next_id = 4

    def _out(self, b):
        port = next(p for p in self.ports if p["id"] == b["port_id"])
        return {k: v for k, v in b.items() if k != "port_id"} | {"port": port}

    def ping(self):
        if not self.healthy:
            raise RuntimeError("db down")

    def list_ports(self):
        return self.ports

    def list_boats(self, *, port_id, boat_type, min_capacity, max_price):
        result = self.boats.values()
        if port_id is not None:
            result = [b for b in result if b["port_id"] == port_id]
        if boat_type is not None:
            result = [b for b in result if b["type"] == boat_type]
        if min_capacity is not None:
            result = [b for b in result if b["capacity"] >= min_capacity]
        if max_price is not None:
            result = [b for b in result if b["price_per_day"] <= max_price]
        return [self._out(b) for b in result]

    def get_boat(self, boat_id):
        b = self.boats.get(boat_id)
        return self._out(b) if b else None

    def port_exists(self, port_id):
        return any(p["id"] == port_id for p in self.ports)

    def create_boat(self, data):
        boat = {"id": self._next_id, **data}
        self.boats[boat["id"]] = boat
        self._next_id += 1
        return self._out(boat)

    def update_boat(self, boat_id, data):
        if boat_id not in self.boats:
            return None
        self.boats[boat_id] = {"id": boat_id, **data}
        return self._out(self.boats[boat_id])

    def delete_boat(self, boat_id):
        return self.boats.pop(boat_id, None) is not None


@pytest.fixture
def repo():
    return FakeBoatRepository()


@pytest.fixture
def client(repo):
    with TestClient(create_app(repository=repo)) as c:
        yield c


# en-têtes posés par nginx
ADMIN = {"X-User-Id": "1", "X-User-Role": "admin"}
USER = {"X-User-Id": "2", "X-User-Role": "user"}
