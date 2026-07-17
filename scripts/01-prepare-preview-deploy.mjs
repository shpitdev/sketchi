#!/usr/bin/env node
import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  previewAppConfig,
  previewWorkerName,
  previewWranglerConfig,
} from "./lib/preview-deploy.mjs";

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

function writeOutputs(outputs) {
  const text = Object.entries(outputs)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  process.stdout.write(`${text}\n`);

  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `${text}\n`);
  }
}

export function preparePreviewDeploy(args = process.argv.slice(2)) {
  const prNumber =
    readFlag(args, "--pr-number", process.env.PR_NUMBER) ??
    process.env.GITHUB_REF_NAME?.match(/^(\d+)\/merge$/)?.[1];
  const app = previewAppConfig(
    readFlag(args, "--app", process.env.PREVIEW_APP),
  );
  const sourceConfigPath = readFlag(
    args,
    "--config",
    app.generatedWranglerConfigPath,
  );
  const previewConfigPath = readFlag(
    args,
    "--out",
    app.previewWranglerConfigPath,
  );
  const workerName = previewWorkerName({
    app: app.appId,
    prNumber,
    workerPrefix: readFlag(
      args,
      "--worker-prefix",
      process.env.CF_PREVIEW_WORKER_PREFIX,
    ),
  });
  const sourceConfig = JSON.parse(readFileSync(sourceConfigPath, "utf8"));
  const previewConfig = previewWranglerConfig(sourceConfig, workerName, {
    app: app.appId,
    prNumber,
    workersDevSubdomain: readFlag(
      args,
      "--workers-dev-subdomain",
      process.env.CF_PREVIEW_WORKERS_SUBDOMAIN,
    ),
  });

  mkdirSync(path.dirname(previewConfigPath), { recursive: true });
  writeFileSync(
    previewConfigPath,
    `${JSON.stringify(previewConfig, null, 2)}\n`,
  );

  writeOutputs({
    app: app.appId,
    nx_project_id: app.nxProjectId,
    preview_config_path: previewConfigPath,
    source_config_path: sourceConfigPath,
    worker_name: workerName,
  });
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  preparePreviewDeploy();
}
