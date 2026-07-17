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
  productionAppConfig,
  productionDomainWranglerConfig,
} from "./lib/production-deploy.mjs";

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

export function prepareProductionDomainDeploy(args = process.argv.slice(2)) {
  const app = productionAppConfig(readFlag(args, "--app"));
  const sourceConfigPath = readFlag(
    args,
    "--config",
    app.generatedWranglerConfigPath,
  );
  const domainConfigPath = readFlag(
    args,
    "--out",
    app.productionDomainWranglerConfigPath,
  );
  const sourceConfig = JSON.parse(readFileSync(sourceConfigPath, "utf8"));
  const domainConfig = productionDomainWranglerConfig(sourceConfig, app.appId);

  mkdirSync(path.dirname(domainConfigPath), { recursive: true });
  writeFileSync(domainConfigPath, `${JSON.stringify(domainConfig, null, 2)}\n`);

  writeOutputs({
    app: app.appId,
    domain_config_path: domainConfigPath,
    domain_patterns: app.domainPatterns.join(","),
    nx_project_id: app.nxProjectId,
    source_config_path: sourceConfigPath,
    worker_name: app.workerName,
  });
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  prepareProductionDomainDeploy();
}
