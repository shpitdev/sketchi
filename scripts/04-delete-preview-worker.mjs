#!/usr/bin/env node
import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import {
  previewProjectConfig,
  previewWorkerName,
} from "./lib/deploy/preview.mjs";

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

function requiredEnv(name) {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`${name} is required.`);
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

export async function deletePreviewWorker(args = process.argv.slice(2)) {
  const dryRun = args.includes("--dry-run");
  const project = previewProjectConfig(readFlag(args, "--project"));
  const previewName = previewWorkerName({
    projectId: project.projectId,
    prNumber: readFlag(args, "--pr-number", process.env.PR_NUMBER),
    workerName: project.workerName,
  });

  if (dryRun) {
    writeOutputs({
      deleted: "false",
      missing: "false",
      preview_worker_name: previewName,
      project_id: project.projectId,
      worker_name: project.workerName,
    });
    return;
  }

  const accountId = requiredEnv("CLOUDFLARE_ACCOUNT_ID");
  const apiToken = requiredEnv("CLOUDFLARE_API_TOKEN");
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${encodeURIComponent(previewName)}`,
    {
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
      },
      method: "DELETE",
    },
  );

  if (response.status === 404) {
    writeOutputs({
      deleted: "false",
      missing: "true",
      preview_worker_name: previewName,
      project_id: project.projectId,
      worker_name: project.workerName,
    });
    return;
  }

  const body = await response.json().catch(() => null);
  if (!response.ok || body?.success !== true) {
    throw new Error(
      `Cloudflare preview cleanup failed with HTTP ${response.status}: ${JSON.stringify(body)}`,
    );
  }

  writeOutputs({
    deleted: "true",
    missing: "false",
    preview_worker_name: previewName,
    project_id: project.projectId,
    worker_name: project.workerName,
  });
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  deletePreviewWorker().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
