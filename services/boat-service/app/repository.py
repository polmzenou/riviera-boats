from typing import Any, Protocol

from psycopg_pool import ConnectionPool


class BoatRepository(Protocol):
    def ping(self) -> None: ...
    def list_ports(self) -> list[dict[str, Any]]: ...
    def list_boats(
        self, *, port_id: int | None, boat_type: str | None, min_capacity: int | None, max_price: float | None
    ) -> list[dict[str, Any]]: ...
    def get_boat(self, boat_id: int) -> dict[str, Any] | None: ...
    def port_exists(self, port_id: int) -> bool: ...
    def create_boat(self, data: dict[str, Any]) -> dict[str, Any]: ...
    def update_boat(self, boat_id: int, data: dict[str, Any]) -> dict[str, Any] | None: ...
    def delete_boat(self, boat_id: int) -> bool: ...


_SELECT = """
    SELECT b.id, b.name, b.type, b.capacity, b.length_m, b.price_per_day,
           b.license_required, b.description,
           p.id AS port_id, p.name AS port_name, p.city AS port_city
    FROM boats.boats b
    JOIN boats.ports p ON p.id = b.port_id
"""

# un filtre à NULL est ignoré
_LIST = (
    _SELECT
    + """
    WHERE (%(port_id)s::int IS NULL OR b.port_id = %(port_id)s)
      AND (%(boat_type)s::text IS NULL OR b.type = %(boat_type)s)
      AND (%(min_capacity)s::int IS NULL OR b.capacity >= %(min_capacity)s)
      AND (%(max_price)s::numeric IS NULL OR b.price_per_day <= %(max_price)s)
    ORDER BY p.city, b.price_per_day
"""
)

_COLUMNS = "name, type, port_id, capacity, length_m, price_per_day, license_required, description"
_VALUES = (
    "%(name)s, %(type)s, %(port_id)s, %(capacity)s, %(length_m)s, %(price_per_day)s, "
    "%(license_required)s, %(description)s"
)


def _to_boat(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row["id"],
        "name": row["name"],
        "type": row["type"],
        "capacity": row["capacity"],
        "length_m": float(row["length_m"]),  # Decimal -> float
        "price_per_day": float(row["price_per_day"]),
        "license_required": row["license_required"],
        "description": row["description"],
        "port": {"id": row["port_id"], "name": row["port_name"], "city": row["port_city"]},
    }


class PostgresBoatRepository:
    def __init__(self, pool: ConnectionPool):
        self._pool = pool

    def ping(self) -> None:
        with self._pool.connection() as conn:
            conn.execute("SELECT 1")

    def list_ports(self) -> list[dict[str, Any]]:
        with self._pool.connection() as conn:
            return conn.execute("SELECT id, name, city FROM boats.ports ORDER BY city").fetchall()

    def list_boats(self, *, port_id, boat_type, min_capacity, max_price) -> list[dict[str, Any]]:
        params = {
            "port_id": port_id,
            "boat_type": boat_type,
            "min_capacity": min_capacity,
            "max_price": max_price,
        }
        with self._pool.connection() as conn:
            return [_to_boat(r) for r in conn.execute(_LIST, params).fetchall()]

    def get_boat(self, boat_id: int) -> dict[str, Any] | None:
        with self._pool.connection() as conn:
            row = conn.execute(_SELECT + " WHERE b.id = %s", (boat_id,)).fetchone()
        return _to_boat(row) if row else None

    def port_exists(self, port_id: int) -> bool:
        with self._pool.connection() as conn:
            return conn.execute("SELECT 1 FROM boats.ports WHERE id = %s", (port_id,)).fetchone() is not None

    def create_boat(self, data: dict[str, Any]) -> dict[str, Any]:
        with self._pool.connection() as conn:
            row = conn.execute(
                f"INSERT INTO boats.boats ({_COLUMNS}) VALUES ({_VALUES}) RETURNING id",  # noqa: S608
                data,
            ).fetchone()
        return self.get_boat(row["id"])

    def update_boat(self, boat_id: int, data: dict[str, Any]) -> dict[str, Any] | None:
        with self._pool.connection() as conn:
            row = conn.execute(
                f"UPDATE boats.boats SET ({_COLUMNS}) = ROW({_VALUES}) WHERE id = %(id)s RETURNING id",  # noqa: S608
                {**data, "id": boat_id},
            ).fetchone()
        return self.get_boat(boat_id) if row else None

    def delete_boat(self, boat_id: int) -> bool:
        with self._pool.connection() as conn:
            return conn.execute("DELETE FROM boats.boats WHERE id = %s", (boat_id,)).rowcount > 0
