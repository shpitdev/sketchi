#!/usr/bin/env node
import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { previewAppConfig, previewWorkerName } from "./lib/preview-deploy.mjs";

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
  const app = previewAppConfig(
    readFlag(args, "--app", process.env.PREVIEW_APP),
  );
  const workerName =
    readFlag(args, "--worker-name", undefined) ??
    previewWorkerName({
      app: app.appId,
      prNumber: readFlag(args, "--pr-number", process.env.PR_NUMBER),
      workerPrefix: readFlag(
        args,
        "--worker-prefix",
        process.env.CF_PREVIEW_WORKER_PREFIX,
      ),
    });

  if (dryRun) {
    writeOutputs({
      deleted: "false",
      missing: "false",
      worker_name: workerName,
    });
    return;
  }

  const accountId = requiredEnv("CLOUDFLARE_ACCOUNT_ID");
  const apiToken = requiredEnv("CLOUDFLARE_API_TOKEN");
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${encodeURIComponent(workerName)}`,
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
      worker_name: workerName,
    });
    return;
  }

  const body = await response.json().catch(() => null);
  if (!response.ok || body?.success !== true) {
    throw new Error(
      `Cloudflare preview cleanup failed with HTTP ${response.status}: ${JSON.stringify(body)}`,
    );
  }

  writeOutputs({ deleted: "true", missing: "false", worker_name: workerName });
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  deletePreviewWorker().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
