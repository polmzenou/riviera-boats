# syntax=docker/dockerfile:1.7
# Stages : base (nginx + site), test (nginx -t + pas de JS/CSS inline), runtime

FROM nginxinc/nginx-unprivileged:1.31-alpine AS base
# curl n'est pas utilisé (healthcheck avec le wget de busybox)
USER 0
RUN apk del --no-cache curl \
 && apk upgrade --no-cache
USER 101

COPY nginx/conf.d/default.conf /etc/nginx/conf.d/default.conf
COPY nginx/snippets/ /etc/nginx/snippets/
COPY public/ /usr/share/nginx/html/

FROM base AS test
# nginx -t passe sans les backends grâce au "resolve" des upstreams.
# grep : 0 = trouvé, 1 = rien, 2 = erreur -> seul 1 est un succès
WORKDIR /usr/share/nginx/html
RUN nginx -t \
 && { grep -nE '<script>|<script [^>]*>[^<]+</script>| style=| on[a-z]+=' ./*.html errors/*.html; test $? -eq 1; }

FROM base AS runtime

LABEL org.opencontainers.image.title="riviera-frontend" \
      org.opencontainers.image.description="RivieraBoats - interface web et reverse-proxy Nginx" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.source="https://github.com/polmzenou/riviera-boats"

USER 101
EXPOSE 8080

HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
  CMD ["wget", "-q", "--spider", "http://127.0.0.1:8080/healthz"]
