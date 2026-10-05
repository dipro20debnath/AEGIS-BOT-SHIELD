# AEGIS BOT SHIELD: one Dockerfile, one target per service (see docker-compose.yml).
#
#   docker build --target api-python -t aegis/api-python .
#   docker build --target api-node   -t aegis/api-node .
#   docker build --target ml         -t aegis/ml .
#   docker build --target dashboard  -t aegis/dashboard .
#
# Behind a TLS-intercepting proxy (corporate networks), pass its CA as a build
# secret; it is used for npm/pip downloads only and never stored in an image:
#   docker build --secret id=extra_ca,src=/path/to/proxy-ca.pem ...

# ---------------------------------------------------------------------------
# JavaScript build: core, js-sdk (dist/aegis.min.js), server-node, dashboard
# ---------------------------------------------------------------------------
FROM node:22-alpine AS js-build
WORKDIR /app
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY packages/js-sdk/package.json packages/js-sdk/
COPY packages/server-node/package.json packages/server-node/
COPY packages/dashboard/package.json packages/dashboard/
COPY packages/edge-cloudflare/package.json packages/edge-cloudflare/
RUN --mount=type=secret,id=extra_ca,required=false \
    if [ -f /run/secrets/extra_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/extra_ca; fi; \
    npm ci --no-audit --no-fund
COPY tsconfig.json ./
COPY contracts contracts
COPY packages/core packages/core
COPY packages/js-sdk packages/js-sdk
COPY packages/server-node packages/server-node
COPY packages/dashboard packages/dashboard
COPY docs/thesis/results docs/thesis/results
RUN npm run build && npm prune --omit=dev --no-audit --no-fund

# ---------------------------------------------------------------------------
# api-node: Express server (examples/express-integration) + status API
# ---------------------------------------------------------------------------
FROM node:22-alpine AS api-node
WORKDIR /app
ENV NODE_ENV=production PORT=3000
COPY --from=js-build /app/package.json ./
COPY --from=js-build /app/node_modules node_modules
COPY --from=js-build /app/packages/core/package.json packages/core/
COPY --from=js-build /app/packages/core/dist packages/core/dist
COPY --from=js-build /app/packages/server-node/package.json packages/server-node/
COPY --from=js-build /app/packages/server-node/dist packages/server-node/dist
COPY --from=js-build /app/packages/js-sdk/dist packages/js-sdk/dist
COPY examples/express-integration examples/express-integration
COPY examples/html-basic examples/html-basic
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --retries=5 CMD wget -qO- http://127.0.0.1:3000/aegis/health || exit 1
CMD ["node", "examples/express-integration/server.js"]

# ---------------------------------------------------------------------------
# dashboard: static Vite build behind nginx (unprivileged, port 8080), /aegis proxied to api-node
# ---------------------------------------------------------------------------
FROM nginxinc/nginx-unprivileged:1.29-alpine AS dashboard
COPY docker/dashboard.nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=js-build /app/packages/dashboard/dist /usr/share/nginx/html
EXPOSE 8080

# ---------------------------------------------------------------------------
# Python base: ml-engine + aegis_shield
# ---------------------------------------------------------------------------
FROM python:3.12-slim AS python-base
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1
WORKDIR /app
COPY packages/ml-engine packages/ml-engine
COPY packages/server-python packages/server-python
RUN --mount=type=secret,id=extra_ca,required=false \
    if [ -f /run/secrets/extra_ca ]; then export PIP_CERT=/run/secrets/extra_ca; fi; \
    pip install "./packages/ml-engine[server]" "./packages/server-python[redis,metrics]" \
 && useradd --create-home --uid 10001 aegis
# Synthetic-data model (pipeline demo only; retrain on real data for real use)
COPY e2e/train_model.py /app/train_model.py
RUN mkdir -p /app/models && python /app/train_model.py /app/models/bot_classifier.pkl

# ---------------------------------------------------------------------------
# ml: HTTP inference service (POST /predict), used by api-node
# ---------------------------------------------------------------------------
FROM python-base AS ml
ENV MODEL_PATH=/app/models/bot_classifier.pkl
USER aegis
EXPOSE 8001
HEALTHCHECK --interval=15s --timeout=3s --retries=5 CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8001/health')"
CMD ["uvicorn", "aegis_ml.server:app", "--host", "0.0.0.0", "--port", "8001"]

# ---------------------------------------------------------------------------
# api-python: reference FastAPI server with the model in-process
# ---------------------------------------------------------------------------
FROM python-base AS api-python
ENV AEGIS_ML_MODEL_PATH=/app/models/bot_classifier.pkl
COPY --from=js-build /app/packages/js-sdk/dist packages/js-sdk/dist
COPY examples/fastapi-integration examples/fastapi-integration
USER aegis
EXPOSE 8000
HEALTHCHECK --interval=15s --timeout=3s --retries=5 CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health')"
CMD ["uvicorn", "main:app", "--app-dir", "examples/fastapi-integration", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers"]

# ---------------------------------------------------------------------------
# study: data-collection study site (study/, Phase G), AEGIS in monitor mode.
# Serve it behind HTTPS (deploy/study/: Caddy). Data lives in the /data volume.
# ---------------------------------------------------------------------------
FROM python-base AS study
ENV STUDY_DB=/data/study.db STUDY_SECURE_COOKIES=true AEGIS_ML_MODEL_PATH=/app/models/bot_classifier.pkl \
    AEGIS_SITE_KEY=aegis-study
COPY --from=js-build /app/packages/js-sdk/dist packages/js-sdk/dist
COPY contracts contracts
COPY docs/thesis/irb/consent_en.md docs/thesis/irb/consent_bn.md docs/thesis/irb/
COPY study study
RUN --mount=type=secret,id=extra_ca,required=false \
    if [ -f /run/secrets/extra_ca ]; then export PIP_CERT=/run/secrets/extra_ca; fi; \
    pip install "jinja2>=3.1" "python-multipart>=0.0.9" \
 && mkdir -p /data && chown aegis:aegis /data
# Run from the source tree: the app finds the SDK, contracts and consent texts relative to it
WORKDIR /app/study
USER aegis
VOLUME /data
EXPOSE 8000
HEALTHCHECK --interval=15s --timeout=3s --retries=5 CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health')"
# One worker: the shop keeps carts in memory and SQLite wants a single writer
CMD ["uvicorn", "aegis_study.app:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips", "*"]
