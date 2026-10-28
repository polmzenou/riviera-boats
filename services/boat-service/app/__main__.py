import os

import uvicorn


def main() -> None:
    log_level = os.environ.get("LOG_LEVEL", "info").lower()
    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",  # noqa: S104
        port=int(os.environ.get("PORT", "8000")),
        log_level="warning" if log_level == "warn" else log_level,
        access_log=False,  # log fait par le middleware
        proxy_headers=True,
        forwarded_allow_ips="*",
    )


if __name__ == "__main__":
    main()
