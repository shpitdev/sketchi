#!/usr/bin/env bash
set -euo pipefail

BEFORE_SHA="${VERCEL_GIT_PREVIOUS_SHA:-}"
AFTER_SHA="${VERCEL_GIT_COMMIT_SHA:-}"

if [ -z "${BEFORE_SHA}" ] || [ -z "${AFTER_SHA}" ]; then
  echo "Missing Vercel commit SHAs; continue with build."
  exit 1
fi

CHANGED_FILES="$(git diff --name-only "${BEFORE_SHA}..${AFTER_SHA}" || true)"
if [ -z "${CHANGED_FILES}" ]; then
  echo "No changed files detected; skip build."
  exit 0
fi

ONLY_NON_WEB_CHANGES="true"
while IFS= read -r file; do
  [ -z "${file}" ] && continue
  case "${file}" in
    README.md|AGENTS.md|bun.lock) ;;
    docs/*|.codex/*) ;;
    packages/opencode-excalidraw/*) ;;
    .github/workflows/opencode-excalidraw-*) ;;
    *)
      ONLY_NON_WEB_CHANGES="false"
      break
      ;;
  esac
done <<< "${CHANGED_FILES}"

if [ "${ONLY_NON_WEB_CHANGES}" = "true" ]; then
  echo "Only OpenCode plugin/non-web paths changed; skip web build."
  exit 0
fi

echo "Web/runtime paths changed; continue with build."
exit 1
