#!/usr/bin/env bash
set -euo pipefail

if [ -z "${WORKOS_CLIENT_ID:-}" ]; then
  echo "WORKOS_CLIENT_ID must be set before Convex deploy."
  exit 1
fi

if [ -z "${WORKOS_API_KEY:-}" ]; then
  echo "WORKOS_API_KEY must be set before Convex deploy."
  exit 1
fi

bun scripts/configure-workos-jwt-template.mjs
