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
  previewProjectConfig,
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
  const project = previewProjectConfig(readFlag(args, "--project"));
  const sourceConfigPath = readFlag(
    args,
    "--config",
    project.generatedWranglerConfigPath,
  );
  const previewConfigPath = readFlag(
    args,
    "--out",
    project.previewWranglerConfigPath,
  );
  const previewName = previewWorkerName({
    projectId: project.projectId,
    prNumber,
    workerName: project.workerName,
  });
  const sourceConfig = JSON.parse(readFileSync(sourceConfigPath, "utf8"));
  const previewConfig = previewWranglerConfig(sourceConfig, {
    projectId: project.projectId,
    prNumber,
    workerName: project.workerName,
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
    preview_config_path: previewConfigPath,
    preview_worker_name: previewName,
    project_id: project.projectId,
    source_config_path: sourceConfigPath,
    worker_name: project.workerName,
  });
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  preparePreviewDeploy();
}
