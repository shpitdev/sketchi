#!/usr/bin/env bash
set -euo pipefail

rm -rf dist
mkdir -p dist

bun build ./src/index.ts \
  --outdir dist \
  --target bun \
  --external "@opencode-ai/*" \
  --external "playwright"

cat > dist/index.d.ts <<'EOF'
import type { Plugin } from '@opencode-ai/plugin';

declare const plugin: Plugin;
export default plugin;
EOF

