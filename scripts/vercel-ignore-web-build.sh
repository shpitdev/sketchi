#!/usr/bin/env bash
set -euo pipefail

BEFORE_SHA="${VERCEL_GIT_PREVIOUS_SHA:-}"
AFTER_SHA="${VERCEL_GIT_COMMIT_SHA:-}"
export BEFORE_SHA AFTER_SHA

if [ -z "${BEFORE_SHA}" ] || [ -z "${AFTER_SHA}" ]; then
  echo "Missing Vercel commit SHAs; continue with build."
  exit 1
fi

if ! CHANGED_FILES="$(git diff --name-only "${BEFORE_SHA}..${AFTER_SHA}")"; then
  echo "Unable to diff ${BEFORE_SHA}..${AFTER_SHA}; continue with build."
  exit 1
fi

if [ -z "${CHANGED_FILES}" ]; then
  echo "No changed files detected; skip build."
  exit 0
fi

is_version_only_package_json_change() {
  node <<'NODE'
const { execFileSync } = require("node:child_process");

const beforeSha = process.env.BEFORE_SHA;
const afterSha = process.env.AFTER_SHA;

function readPackageJson(sha) {
  return JSON.parse(execFileSync("git", ["show", `${sha}:package.json`], {
    encoding: "utf8",
  }));
}

function withoutVersion(packageJson) {
  const copy = { ...packageJson };
  delete copy.version;
  return copy;
}

try {
  const beforePackageJson = readPackageJson(beforeSha);
  const afterPackageJson = readPackageJson(afterSha);

  if (beforePackageJson.version === afterPackageJson.version) {
    process.exit(1);
  }

  const beforeWithoutVersion = withoutVersion(beforePackageJson);
  const afterWithoutVersion = withoutVersion(afterPackageJson);

  process.exit(
    JSON.stringify(beforeWithoutVersion) === JSON.stringify(afterWithoutVersion)
      ? 0
      : 1
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
NODE
}

ONLY_NON_WEB_CHANGES="true"
while IFS= read -r file; do
  [ -z "${file}" ] && continue
  case "${file}" in
    package.json)
      if is_version_only_package_json_change; then
        true
      else
        ONLY_NON_WEB_CHANGES="false"
        break
      fi
      ;;
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
  echo "Only non-web paths changed; skip web build."
  exit 0
fi

echo "Web/runtime paths changed; continue with build."
exit 1
