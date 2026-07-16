#!/usr/bin/env bash
#
# One-shot Vercel bring-up. Reads secrets from ../.env and:
#   1. commits + pushes the repo (via GITHUB_TOKEN, no creds saved to config)
#   2. links this directory to a Vercel project + connects the Git repo
#   3. pushes Strava + CRON secrets into the project's env store
#   4. deploys to production
#   5. attaches doucett.net and prints the DNS records to paste
#
# Idempotent-ish: safe to re-run. Requires: git, node, vercel CLI.
# Blob store creation is a 3-click dashboard step (see NOTE at the end) —
# the site and map degrade gracefully until it exists.
#
# Usage:  bash scripts/bootstrap-vercel.sh

set -euo pipefail
cd "$(dirname "$0")/.."

if [[ ! -f .env ]]; then echo "No .env found. Copy .env.example -> .env and fill it in."; exit 1; fi
set -a; source .env; set +a

req() { if [[ -z "${!1:-}" ]]; then echo "Missing $1 in .env"; exit 1; fi; }
req GITHUB_TOKEN
req VERCEL_TOKEN

VT=(--token "$VERCEL_TOKEN")
REPO="github.com/Adoucett/homepage.git"

echo "==> 1/5  Commit + push"
git add -A
git commit -m "Relaunch on Vercel + auto-updating Strava map art" || echo "  (nothing to commit)"
git push "https://x-access-token:${GITHUB_TOKEN}@${REPO}" HEAD:main

echo "==> 2/5  Link Vercel project + connect Git"
vercel link --yes --project doucett-homepage "${VT[@]}"
vercel git connect --yes "${VT[@]}" || echo "  (git already connected or skipped)"

echo "==> 3/5  Push environment variables (production)"
put_env() {
  local name="$1" val="$2"
  [[ -z "$val" ]] && { echo "  skip $name (empty)"; return; }
  vercel env rm "$name" production --yes "${VT[@]}" >/dev/null 2>&1 || true
  printf '%s' "$val" | vercel env add "$name" production "${VT[@]}" >/dev/null
  echo "  set $name"
}
CRON_SECRET="${CRON_SECRET:-$(node -e 'console.log(require("crypto").randomBytes(24).toString("hex"))')}"
put_env STRAVA_CLIENT_ID "${STRAVA_CLIENT_ID:-}"
put_env STRAVA_CLIENT_SECRET "${STRAVA_CLIENT_SECRET:-}"
put_env STRAVA_REFRESH_TOKEN "${STRAVA_REFRESH_TOKEN:-}"
put_env CRON_SECRET "$CRON_SECRET"

echo "==> 4/5  Deploy to production"
vercel deploy --prod --yes "${VT[@]}"

echo "==> 5/5  Attach domain + DNS records"
vercel domains add doucett.net doucett-homepage "${VT[@]}" || echo "  (domain may already be attached)"
echo
echo "Point these records at Vercel in your registrar's DNS panel:"
echo "  A     @      76.76.21.21"
echo "  CNAME www    cname.vercel-dns.com"
echo
echo "NOTE: create the Blob store once (enables the live Strava delta):"
echo "  Vercel dashboard > Storage > Create > Blob > connect to 'doucett-homepage'."
echo "  That auto-adds BLOB_READ_WRITE_TOKEN. Then redeploy or wait for the nightly cron."
echo
echo "Done."
