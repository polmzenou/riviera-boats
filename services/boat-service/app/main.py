import logging
import os
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.config import Settings
from app.deps import Repo
from app.repository import BoatRepository, PostgresBoatRepository
from app.routes import router

_level = os.environ.get("LOG_LEVEL", "info").upper()
logging.basicConfig(
    level="WARNING" if _level == "WARN" else _level,
    format="%(asctime)s %(levelname)s boat-service %(message)s",
)
logger = logging.getLogger("boat-service")


def create_app(repository: BoatRepository | None = None) -> FastAPI:
    # repository fourni par les tests, sinon pool postgres au démarrage
    @asynccontextmanager
    async def lifespan(app: FastAPI):
        if app.state.repo is not None:
            yield
            return
        settings = Settings.from_env()
        pool = ConnectionPool(
            settings.conninfo(), min_size=1, max_size=5, open=False, kwargs={"row_factory": dict_row}
        )
        pool.open(wait=True, timeout=30)
        app.state.repo = PostgresBoatRepository(pool)
        logger.info("boat-service démarré (env=%s)", settings.app_env)
        try:
            yield
        finally:
            pool.close()

    app = FastAPI(title="RivieraBoats - boat-service", version="1.0.0", lifespan=lifespan)
    app.state.repo = repository

    @app.middleware("http")
    async def log_requests(request: Request, call_next):
        start = time.perf_counter()
        response = await call_next(request)
        logger.info(
            "request method=%s path=%s status=%s ms=%d requestId=%s",
            request.method,
            request.url.path,
            response.status_code,
            (time.perf_counter() - start) * 1000,
            request.headers.get("x-request-id"),
        )
        return response

    # même format d'erreur que les services node
    @app.exception_handler(StarletteHTTPException)
    async def http_error(_request: Request, exc: StarletteHTTPException):
        return JSONResponse({"error": exc.detail}, status_code=exc.status_code)

    @app.exception_handler(RequestValidationError)
    async def validation_error(_request: Request, exc: RequestValidationError):
        details = [
            {"field": ".".join(str(p) for p in err["loc"][1:]), "message": err["msg"]} for err in exc.errors()
        ]
        return JSONResponse({"error": "Données invalides", "details": details}, status_code=422)

    @app.get("/health", include_in_schema=False)
    def health(repo: Repo):
        try:
            repo.ping()
        except Exception:
            logger.warning("healthcheck : base indisponible")
            return JSONResponse({"status": "db-unavailable"}, status_code=503)
        return {"status": "ok"}

    app.include_router(router)
    return app


app = create_app()
