#!/usr/bin/env bash
# Playwright 1.58.x has an ESM preflight mechanism that conflicts with bun's
# TypeScript module loading in packages with "type": "module". This patch skips
# the preflight when running under bun (which handles TS natively).
set -e

TRANSFORM="node_modules/playwright/lib/transform/transform.js"

if ! grep -q 'process.versions.bun' "$TRANSFORM" 2>/dev/null; then
  sed -i '' \
    's/await eval(`import(${JSON.stringify(fileName + ".esm.preflight")})`).finally(nextTask);/if (!process.versions.bun) { await eval(`import(${JSON.stringify(fileName + ".esm.preflight")})`).finally(nextTask); }/' \
    "$TRANSFORM"
  echo "Applied bun-compat patch to $TRANSFORM"
else
  echo "bun-compat patch already applied to $TRANSFORM"
fi
