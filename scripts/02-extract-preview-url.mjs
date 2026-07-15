#!/usr/bin/env node
import { appendFileSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { extractPreviewUrl } from "./lib/preview-deploy.mjs";

function readFlag(args, name, fallback) {
  const index = args.indexOf(name);

  if (index === -1) {
    return fallback;
  }

  const value = args[index + 1];
  if (!value) {
    throw new Error(`Missing value for ${name}.`);
  }

  return value;
}

function writeOutput(key, value) {
  const text = `${key}=${value}`;

  process.stdout.write(`${text}\n`);

  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `${text}\n`);
  }
}

export function extractPreviewUrlCommand(args = process.argv.slice(2)) {
  const logPath = args.find((arg) => !arg.startsWith("--"));
  if (!logPath) {
    throw new Error(
      "Usage: scripts/02-extract-preview-url.mjs <wrangler-log-path> [--worker-name <name>]",
    );
  }

  const workerName = readFlag(args, "--worker-name", "");
  const previewUrl = extractPreviewUrl(
    readFileSync(logPath, "utf8"),
    workerName,
  );

  if (!previewUrl) {
    throw new Error(`Failed to parse preview URL from ${logPath}.`);
  }

  writeOutput("preview_url", previewUrl);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  extractPreviewUrlCommand();
}
