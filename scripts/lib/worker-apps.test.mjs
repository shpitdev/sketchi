import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { unstable_readConfig } from "wrangler";

import { workerAppConfig, workerAppIds } from "./worker-apps.mjs";

const repoRoot = new URL("../../", import.meta.url);

const expectedWorkers = {
  excalidraw: "sketchi-excalidraw",
  icons: "sketchi-icons",
  playground: "sketchi-playground",
  studio: "sketchi-studio",
  web: "sketchi-web",
};

test("Worker apps have isolated build and generated config paths", () => {
  const apps = workerAppIds.map((appId) => workerAppConfig(appId));
  const uniqueFields = [
    "buildOutputPath",
    "generatedWranglerConfigPath",
    "previewWranglerConfigPath",
    "productionDomainWranglerConfigPath",
    "projectRoot",
  ];

  for (const field of uniqueFields) {
    assert.equal(
      new Set(apps.map((app) => app[field])).size,
      apps.length,
      `${field} must be unique per Worker app`,
    );
  }

  for (const app of apps) {
    assert.equal(
      app.generatedWranglerConfigPath,
      `${app.buildOutputPath}/server/wrangler.json`,
    );
    assert.equal(
      app.previewWranglerConfigPath,
      `${app.buildOutputPath}/server/wrangler.preview.json`,
    );
    assert.equal(
      app.productionDomainWranglerConfigPath,
      `${app.buildOutputPath}/server/wrangler.domains.json`,
    );
  }
});

test("Nx project IDs resolve independently to durable Worker identities", async () => {
  for (const [appId, expectedWorkerName] of Object.entries(expectedWorkers)) {
    const app = workerAppConfig(appId);
    const wranglerConfig = await unstable_readConfig({
      config: app.wranglerInputConfigPath,
    });

    assert.equal(app.nxProjectId, appId);
    assert.equal(app.workerName, expectedWorkerName);
    assert.equal(wranglerConfig.name, expectedWorkerName);
  }
});

test("Nx build outputs and deploy targets use the app-scoped Worker paths", () => {
  for (const appId of workerAppIds) {
    const app = workerAppConfig(appId);
    const project = JSON.parse(
      readFileSync(
        new URL(`${app.projectRoot}/project.json`, repoRoot),
        "utf8",
      ),
    );

    assert.equal(project.name, app.nxProjectId);
    assert.deepEqual(project.targets.build.outputs, [
      `{workspaceRoot}/${app.buildOutputPath}`,
      "{projectRoot}/.wrangler/deploy/config.json",
    ]);
    assert.equal(
      project.targets.deploy.options.command,
      `wrangler deploy --config ${app.generatedWranglerConfigPath}`,
    );
  }
});
