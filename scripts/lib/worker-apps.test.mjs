import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

import { unstable_readConfig } from "wrangler";

import { workerAppConfig, workerAppIds } from "./worker-apps.mjs";

const repoRoot = new URL("../../", import.meta.url);

const expectedWorkers = {
  excalidraw: "sketchi-excalidraw",
  "eval-harness": "sketchi-playground",
  icons: "sketchi-icons",
  studio: "sketchi-studio",
  web: "sketchi-web",
};

test("Worker app resolution requires an explicit project selection", () => {
  assert.throws(
    () => workerAppConfig(),
    /Worker app\/project selection is required/,
  );
});

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

  const evalHarness = workerAppConfig("eval-harness");
  assert.equal(evalHarness.nxProjectId, "eval-harness");
  assert.equal(evalHarness.workerName, "sketchi-playground");
  assert.notEqual(evalHarness.nxProjectId, evalHarness.workerName);
});

test("the workspace has no active Nx app named playground", () => {
  const appProjectIds = readdirSync(new URL("../../apps/", import.meta.url), {
    withFileTypes: true,
  })
    .filter((entry) => entry.isDirectory())
    .map((entry) =>
      JSON.parse(
        readFileSync(
          new URL(`../../apps/${entry.name}/project.json`, import.meta.url),
          "utf8",
        ),
      ),
    )
    .map((project) => project.name);

  assert.ok(appProjectIds.includes("eval-harness"));
  assert.equal(appProjectIds.includes("playground"), false);
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
