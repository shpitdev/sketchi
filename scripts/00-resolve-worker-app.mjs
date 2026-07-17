#!/usr/bin/env node
import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { workerAppConfig } from "./lib/worker-apps.mjs";

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

export function resolveWorkerApp(args = process.argv.slice(2)) {
  const app = workerAppConfig(readFlag(args, "--app", process.env.WORKER_APP));

  writeOutputs({
    app: app.appId,
    build_output_path: app.buildOutputPath,
    nx_project_id: app.nxProjectId,
    worker_config_path: app.generatedWranglerConfigPath,
    worker_name: app.workerName,
  });
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  resolveWorkerApp();
}
