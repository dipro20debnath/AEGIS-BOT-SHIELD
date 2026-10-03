#!/bin/sh
# Build the images, load them into a kind cluster, install the chart and run its smoke test.
#   sh deploy/kind-test.sh            (cluster "aegis", created if missing)
# Needs docker, kind, kubectl and helm on PATH. Behind a TLS-intercepting proxy,
# set EXTRA_CA=/path/to/ca.pem for the image builds.
set -eu
CLUSTER=${CLUSTER:-aegis}
TAG=${TAG:-1.0.0}
cd "$(dirname "$0")/.."

SECRET_ARG=""
if [ -n "${EXTRA_CA:-}" ]; then SECRET_ARG="--secret id=extra_ca,src=$EXTRA_CA"; fi
for target in api-python api-node ml dashboard; do
  # shellcheck disable=SC2086
  docker build $SECRET_ARG --target "$target" -t "aegis/$target:$TAG" .
done

kind get clusters | grep -qx "$CLUSTER" || kind create cluster --name "$CLUSTER" --wait 120s
docker pull -q redis:7-alpine >/dev/null
for image in api-python api-node ml dashboard; do kind load docker-image --name "$CLUSTER" "aegis/$image:$TAG"; done
kind load docker-image --name "$CLUSTER" redis:7-alpine

helm upgrade --install aegis deploy/helm/aegis --wait --timeout 10m \
  --set image.tag="$TAG" --set image.pullPolicy=Never \
  --set secret.secretKey="$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
kubectl get pods -l app.kubernetes.io/instance=aegis
helm test aegis --logs
