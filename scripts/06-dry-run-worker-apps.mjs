import { existsSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { workerProjectConfig, workerProjectIds } from "./lib/worker-apps.mjs";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const wranglerBin = fileURLToPath(
  new URL("../node_modules/.bin/wrangler", import.meta.url),
);

for (const projectId of workerProjectIds) {
  const project = workerProjectConfig(projectId);
  const configPath = fileURLToPath(
    new URL(`../${project.generatedWranglerConfigPath}`, import.meta.url),
  );
  const outputPath = fileURLToPath(
    new URL(`../.memory/wrangler-dry-runs/${projectId}/`, import.meta.url),
  );

  if (!existsSync(configPath)) {
    throw new Error(
      `Missing generated Wrangler config for ${projectId}: ${project.generatedWranglerConfigPath}. Run the app builds first.`,
    );
  }

  mkdirSync(outputPath, { recursive: true });
  console.log(
    `Dry-running ${project.projectId} -> ${project.workerName} with ${project.generatedWranglerConfigPath}`,
  );

  const result = spawnSync(
    wranglerBin,
    [
      "deploy",
      "--dry-run",
      "--config",
      project.generatedWranglerConfigPath,
      "--outdir",
      outputPath,
    ],
    { cwd: repoRoot, stdio: "inherit" },
  );

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      `Wrangler dry-run failed for ${projectId} with status ${String(result.status)}${result.signal ? ` (${result.signal})` : ""}.`,
    );
  }
}
