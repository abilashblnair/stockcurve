#!/usr/bin/env bash
# Build locally, upload, and (re)start Stockcurve next to Pewcake.
#   deploy/push.sh ubuntu@SERVER_IP path/to/ssh-key
# Set DIST_DIR outside OneDrive (the sync client locks files in dist/).
set -euo pipefail
TARGET="${1:?usage: deploy/push.sh user@host ssh-key}"
KEY="${2:?ssh key path}"
cd "$(dirname "$0")/.."
DIST="${DIST_DIR:-dist}"
SSHOPTS=(-i "$KEY" -o StrictHostKeyChecking=accept-new)

DIST_DIR="$DIST" deploy/build-dist.sh

echo ">> uploading"
tar czf - -C "$DIST" . | ssh "${SSHOPTS[@]}" "$TARGET" 'rm -rf ~/stockcurve/dist-new && mkdir -p ~/stockcurve/dist-new && tar xzf - -C ~/stockcurve/dist-new'
tar czf - -C deploy docker-compose.yml env.production.example | ssh "${SSHOPTS[@]}" "$TARGET" 'mkdir -p ~/stockcurve && tar xzf - -C ~/stockcurve'

echo ">> switching over"
ssh "${SSHOPTS[@]}" "$TARGET" bash -s <<'REMOTE'
set -e
cd ~/stockcurve
if [ ! -f .env.production ]; then
  # Reuse Pewcake's RPC key without printing it.
  grep -v '^SOLANA_RPC=' env.production.example > .env.production
  grep '^SOLANA_RPC=' ~/pewcake/.env.production >> .env.production
fi
rm -rf dist-old
[ -d dist ] && mv dist dist-old
mv dist-new dist
docker compose up -d --force-recreate
for i in $(seq 1 30); do
  sleep 2
  if docker compose exec -T stockcurve wget -qO- http://127.0.0.1:3000/api/health >/dev/null 2>&1; then
    echo ">> stockcurve healthy"
    rm -rf dist-old
    docker compose ps
    exit 0
  fi
done
echo ">> not healthy in 60s; previous build kept in dist-old"
echo ">> roll back: cd ~/stockcurve && rm -rf dist && mv dist-old dist && docker compose up -d --force-recreate"
docker compose logs --tail 40 stockcurve
exit 1
REMOTE
