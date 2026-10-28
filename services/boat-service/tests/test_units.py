from decimal import Decimal

import pytest

from app.config import Settings, read_secret
from app.repository import PostgresBoatRepository

ROW = {
    "id": 1,
    "name": "Lou",
    "type": "voilier",
    "capacity": 6,
    "length_m": Decimal("9.5"),
    "price_per_day": Decimal("220.00"),
    "license_required": True,
    "description": "",
    "port_id": 1,
    "port_name": "Port Lympia",
    "port_city": "Nice",
}


def test_read_secret_from_file(tmp_path, monkeypatch):
    secret = tmp_path / "pw.txt"
    secret.write_text("s3cr3t\r\n", encoding="utf-8")
    monkeypatch.setenv("DB_PASSWORD_FILE", str(secret))
    assert read_secret("DB_PASSWORD") == "s3cr3t"


def test_read_secret_fallbacks(monkeypatch):
    monkeypatch.delenv("X_FILE", raising=False)
    monkeypatch.setenv("X", "direct")
    assert read_secret("X") == "direct"
    monkeypatch.delenv("X")
    assert read_secret("X", "defaut") == "defaut"
    with pytest.raises(RuntimeError, match="X_FILE"):
        read_secret("X")


def test_settings_conninfo(monkeypatch):
    monkeypatch.delenv("DB_PASSWORD_FILE", raising=False)
    monkeypatch.setenv("DB_PASSWORD", "p a'ss")
    conninfo = Settings.from_env().conninfo()
    assert "user=boat_svc" in conninfo
    assert "host=db" in conninfo
    assert "p a\\'ss" in conninfo  # valeur correctement échappée


class FakeCursor:
    def __init__(self, rows, rowcount=1):
        self.rows, self.rowcount = rows, rowcount

    def fetchall(self):
        return self.rows

    def fetchone(self):
        return self.rows[0] if self.rows else None


class FakeConnection:
    def __init__(self, rows):
        self.rows, self.calls = rows, []

    def execute(self, sql, params=None):
        self.calls.append((sql, params))
        return FakeCursor(self.rows, rowcount=len(self.rows))

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


class FakePool:
    def __init__(self, rows):
        self.conn = FakeConnection(rows)

    def connection(self):
        return self.conn


def test_repository_maps_rows_and_uses_parameters():
    pool = FakePool([ROW])
    repo = PostgresBoatRepository(pool)
    repo.ping()
    boats = repo.list_boats(port_id=1, boat_type=None, min_capacity=None, max_price=300)
    assert boats[0]["price_per_day"] == 220.0
    assert boats[0]["port"] == {"id": 1, "name": "Port Lympia", "city": "Nice"}
    assert repo.get_boat(1)["length_m"] == 9.5
    assert repo.port_exists(1) is True
    assert repo.list_ports() == [ROW]
    assert repo.create_boat({"name": "X"})["id"] == 1
    assert repo.update_boat(1, {"name": "X"})["id"] == 1
    assert repo.delete_boat(1) is True
    for sql, params in pool.conn.calls[1:]:
        assert "boats." in sql
        if "%" in sql:
            assert params is not None


def test_repository_not_found():
    repo = PostgresBoatRepository(FakePool([]))
    assert repo.get_boat(9) is None
    assert repo.update_boat(9, {}) is None
    assert repo.delete_boat(9) is False
    assert repo.port_exists(9) is False
