#!/usr/bin/env bash
# Build the standalone bundle and assemble the release folder.
#   DIST_DIR=/some/folder/outside/onedrive deploy/build-dist.sh
set -euo pipefail
cd "$(dirname "$0")/.."
export NEXT_DIST_DIR=.next-dist NEXT_TELEMETRY_DISABLED=1
npx next build
DIST="${DIST_DIR:-dist}"
rm -rf "$DIST" && mkdir -p "$DIST"
# Keep the build folder name (.next-dist): the standalone server.js refers to it by name.
cp -R .next-dist/standalone/. "$DIST/"
mkdir -p "$DIST/.next-dist" && cp -R .next-dist/static "$DIST/.next-dist/static"
mkdir -p "$DIST/public" && cp -R public/. "$DIST/public/" 2>/dev/null || true
# Local data (.env, index cache, metadata) must never ship in the bundle.
rm -rf "$DIST/.env" "$DIST/.env.local" "$DIST/.data" "$DIST/keys" "$DIST/runs"
du -sh "$DIST" | awk '{print "dist size:", $1}'
