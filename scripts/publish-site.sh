#!/bin/sh
# Publish the public site (privacy policy, support page) to VibeMyCode/transello-site (GitHub Pages, public).
# The source repo is private; only built static pages go public. Uses the VibeMyCode gh account token.
set -eu
cd "$(dirname "$0")/.."
node scripts/site.mjs
TMP=$(mktemp -d)
cp -R site-dist/. "$TMP/"
touch "$TMP/.nojekyll"
cd "$TMP"
git init -q -b main
git -c user.name="VibeMyCode Bot" -c user.email="bot@vibemycode.dev" add -A
git -c user.name="VibeMyCode Bot" -c user.email="bot@vibemycode.dev" commit -q -m "Publish site from transello@$(git -C "$OLDPWD" rev-parse --short HEAD 2>/dev/null || echo local)"
TOKEN=$(gh auth token -u VibeMyCode)
git push -q -f "https://x-access-token:${TOKEN}@github.com/VibeMyCode/transello-site.git" main
rm -rf "$TMP"
echo "published → https://vibemycode.github.io/transello-site/"
