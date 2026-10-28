# syntax=docker/dockerfile:1.7
# Stages : builder (venv prod), test (ruff + pytest), runtime (image finale)

FROM python:3.13-slim AS base
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1
WORKDIR /app

FROM base AS builder
# venv sans pip : les paquets sont installés avec le pip de l'image de base
RUN python -m venv --without-pip /opt/venv
ENV PATH=/opt/venv/bin:$PATH
COPY requirements.txt .
RUN /usr/local/bin/python -m pip --python /opt/venv/bin/python install --no-cache-dir -r requirements.txt

FROM builder AS test
COPY requirements-dev.txt .
RUN /usr/local/bin/python -m pip --python /opt/venv/bin/python install --no-cache-dir -r requirements-dev.txt
COPY . .
RUN ruff check . && ruff format --check . && pytest

FROM base AS runtime

LABEL org.opencontainers.image.title="riviera-boat" \
      org.opencontainers.image.description="RivieraBoats - catalogue des bateaux et des ports (FastAPI)" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.source="https://github.com/owner/riviera-boats"

RUN groupadd --system --gid 10001 app \
 && useradd --system --uid 10001 --gid app --no-create-home --shell /usr/sbin/nologin app \
 && python -m pip uninstall --yes --no-cache-dir pip

COPY --from=builder /opt/venv /opt/venv
ENV PATH=/opt/venv/bin:$PATH \
    PORT=8000
COPY app ./app

USER 10001
EXPOSE 8000

HEALTHCHECK --interval=10s --timeout=3s --start-period=15s --retries=5 \
  CMD ["python", "-c", "import os,urllib.request; urllib.request.urlopen('http://127.0.0.1:%s/health' % os.environ.get('PORT','8000'), timeout=2)"]

CMD ["python", "-m", "app"]
