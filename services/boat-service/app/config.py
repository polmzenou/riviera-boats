import os
from dataclasses import dataclass
from pathlib import Path

from psycopg.conninfo import make_conninfo


def read_secret(name: str, default: str | None = None) -> str:
    # NOM_FILE (secret docker dans /run/secrets) prioritaire sur NOM
    file = os.environ.get(f"{name}_FILE")
    if file:
        return Path(file).read_text(encoding="utf-8").strip()
    value = os.environ.get(name, default)
    if value is None:
        raise RuntimeError(f"Configuration manquante : {name} ou {name}_FILE")
    return value


@dataclass(frozen=True)
class Settings:
    app_env: str
    db_host: str
    db_port: int
    db_name: str
    db_user: str
    db_password: str

    @classmethod
    def from_env(cls) -> "Settings":
        return cls(
            app_env=os.environ.get("APP_ENV", "dev"),
            db_host=os.environ.get("DB_HOST", "db"),
            db_port=int(os.environ.get("DB_PORT", "5432")),
            db_name=os.environ.get("DB_NAME", "riviera"),
            db_user=os.environ.get("DB_USER", "boat_svc"),
            db_password=read_secret("DB_PASSWORD"),
        )

    def conninfo(self) -> str:
        return make_conninfo(
            host=self.db_host,
            port=self.db_port,
            dbname=self.db_name,
            user=self.db_user,
            password=self.db_password,
            application_name="boat-service",
        )
