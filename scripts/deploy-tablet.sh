#!/usr/bin/env bash
#
# One-shot dev deploy to the tablet:
#   1. push your current commit to the `dev` branch  → fires the Dev release Action
#   2. wait for that Action to publish the build      → polls the public release
#   3. tell the gateway to install it                 → POST install/url
#
#   TABLET=192.168.3.95:8080 npm run deploy:tablet
#
# Notes:
# - It deploys your current HEAD *commit* — commit your change first (uncommitted
#   work isn't built by CI). A warning is printed if the tree is dirty.
# - The wait polls the public GitHub release for the short SHA the workflow
#   stamps into its notes, so no token is needed. Needs outbound internet from
#   THIS machine to api.github.com, and from the tablet to github.com.
# - NO_PUSH=1 skips the push+wait and only triggers the gateway (use after a
#   manual workflow_dispatch).
#
# Env:
#   TABLET       gateway host:port (required)     e.g. 192.168.3.95:8080
#   REPO         owner/repo (default rotium/OverDose)
#   DEV_BRANCH   branch to push (default dev)
#   TIMEOUT      seconds to wait for the build (default 360)
set -euo pipefail

GATEWAY="${TABLET:?set TABLET=<gateway-ip:port>, e.g. TABLET=192.168.3.95:8080}"
REPO="${REPO:-rotium/OverDose}"
DEV_BRANCH="${DEV_BRANCH:-dev}"
TIMEOUT="${TIMEOUT:-360}"
ASSET_URL="https://github.com/$REPO/releases/download/dev-build/overdose-dev.zip"

if [ "${NO_PUSH:-}" != "1" ]; then
  SHA="$(git rev-parse --short=7 HEAD)"
  if [ -n "$(git status --porcelain)" ]; then
    echo "⚠  Working tree has uncommitted changes — CI builds the committed HEAD ($SHA), so those won't be included." >&2
  fi

  echo "→ Pushing $SHA to '$DEV_BRANCH' (fires the Dev release Action)…"
  git push --force-with-lease origin "HEAD:$DEV_BRANCH"

  echo "→ Waiting for the dev build of $SHA to publish (up to ${TIMEOUT}s)…"
  deadline=$(( $(date +%s) + TIMEOUT ))
  ready=""
  while [ "$(date +%s)" -lt "$deadline" ]; do
    body="$(curl -fsS "https://api.github.com/repos/$REPO/releases/tags/dev-build" 2>/dev/null \
      | python3 -c 'import sys,json; print(json.load(sys.stdin).get("body",""))' 2>/dev/null || true)"
    case "$body" in
      *"$SHA"*) ready=1; break ;;
    esac
    sleep 10
  done
  if [ -z "$ready" ]; then
    echo "✗ Timed out waiting for the dev build of $SHA. Check the Actions tab; the build may still be running or have failed." >&2
    exit 1
  fi
  echo "  build $SHA is published."
fi

echo "→ Asking gateway $GATEWAY to install the dev build…"
RESP="$(mktemp)"
trap 'rm -f "$RESP"' EXIT
CODE="$(curl -sS -o "$RESP" -w '%{http_code}' \
  -X POST "http://$GATEWAY/api/v1/webui/skins/install/url" \
  -H 'Content-Type: application/json' \
  -d "{\"url\":\"$ASSET_URL\"}" || echo 000)"

if [ "$CODE" = "200" ] || [ "$CODE" = "201" ]; then
  echo "✓ Done — reload the skin on the tablet to see the new build."
else
  echo "✗ Gateway returned HTTP $CODE:" >&2
  cat "$RESP" >&2 2>/dev/null || true
  echo >&2
  echo "Check the tablet has outbound internet to GitHub and the asset exists at:" >&2
  echo "  $ASSET_URL" >&2
  exit 1
fi
