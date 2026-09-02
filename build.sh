#!/usr/bin/env sh
set -eu

REGISTRY="${REGISTRY:-registry.kieffer.me}"
REPO="$REGISTRY/silly-golf"
TAG="${TAG:-latest}"
PUSH=0

for arg in "$@"; do
  case "$arg" in
    --push) PUSH=1 ;;
    *) echo "unknown arg: $arg" >&2; exit 1 ;;
  esac
done

echo ">> building $REPO:$TAG"
docker build -t "$REPO:$TAG" .

echo ">> image ready: $REPO:$TAG"

if [ "$PUSH" -eq 1 ]; then
  echo ">> pushing $REPO:$TAG"
  docker push "$REPO:$TAG"
fi

echo ">> run: docker run --rm -p 3000:3000 $REPO:$TAG"
echo ">>      http://localhost:3000"
