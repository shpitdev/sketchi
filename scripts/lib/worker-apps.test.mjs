import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

import { unstable_readConfig } from "wrangler";

import {
  assertWranglerWorkerIdentity,
  requireWorkerIdentity,
  workerProjectConfig,
  workerProjectIds,
} from "./worker-apps.mjs";

const repoRoot = new URL("../../", import.meta.url);

const expectedWorkers = {
  excalidraw: "sketchi-excalidraw",
  "eval-harness": "sketchi-playground",
  icons: "sketchi-icons",
  playground: "sketchi-studio",
  web: "sketchi-web",
};

const tanstackFullPathSnapshot = [
  "/",
  "/api/chat",
  "/api/studio/diagrams/$diagramId",
  "/api/studio/projects",
  "/api/studio/projects/$projectId",
  "/api/studio/projects/from-artifact",
  "/api/v1/artifacts/$artifactId",
  "/api/v1/artifacts/$artifactId/patch",
  "/api/v1/flowcharts/build",
  "/api/v1/generate",
  "/api/v1/mindmaps/build",
  "/artifacts/$artifactId",
  "/artifacts/$artifactId/edit",
  "/codemode-export-harness",
  "/diagrams/$diagramId",
  "/diagrams/$diagramId/edit",
  "/examples/$exampleId",
  "/mcp",
  "/projects",
  "/projects/$projectId",
];

test("Worker resolution requires an explicit project selection", () => {
  assert.throws(
    () => workerProjectConfig(),
    /Worker project selection is required/,
  );
});

test("deployed project IDs are the exact approved set", () => {
  assert.deepEqual(
    [...workerProjectIds].sort(),
    Object.keys(expectedWorkers).sort(),
  );
});

test("Worker projects have isolated build and generated config paths", () => {
  const projects = workerProjectIds.map((projectId) =>
    workerProjectConfig(projectId),
  );
  const uniqueFields = [
    "buildOutputPath",
    "generatedWranglerConfigPath",
    "previewWranglerConfigPath",
    "productionDomainWranglerConfigPath",
    "projectRoot",
  ];

  for (const field of uniqueFields) {
    assert.equal(
      new Set(projects.map((project) => project[field])).size,
      projects.length,
      `${field} must be unique per Worker project`,
    );
  }

  for (const project of projects) {
    assert.equal(
      project.generatedWranglerConfigPath,
      `${project.buildOutputPath}/server/wrangler.json`,
    );
    assert.equal(
      project.previewWranglerConfigPath,
      `${project.buildOutputPath}/server/wrangler.preview.json`,
    );
    assert.equal(
      project.productionDomainWranglerConfigPath,
      `${project.buildOutputPath}/server/wrangler.domains.json`,
    );
  }
});

test("project IDs resolve independently to durable Worker identities", async () => {
  for (const [projectId, expectedWorkerName] of Object.entries(
    expectedWorkers,
  )) {
    const project = workerProjectConfig(projectId);
    const wranglerConfig = await unstable_readConfig({
      config: project.wranglerInputConfigPath,
    });

    assert.equal(project.projectId, projectId);
    assert.equal(project.workerName, expectedWorkerName);
    assert.equal(wranglerConfig.name, expectedWorkerName);
  }

  const playground = workerProjectConfig("playground");
  assert.equal(playground.projectId, "playground");
  assert.equal(playground.workerName, "sketchi-studio");
  assert.equal(playground.previewWorkerPrefix, "sketchi-studio-pr");
  assert.notEqual(playground.projectId, playground.workerName);
});

test("final eval and public Playground projects retain their durable Workers", () => {
  assert.deepEqual(
    {
      previewWorkerPrefix:
        workerProjectConfig("eval-harness").previewWorkerPrefix,
      workerName: workerProjectConfig("eval-harness").workerName,
    },
    {
      previewWorkerPrefix: "sketchi-playground-pr",
      workerName: "sketchi-playground",
    },
  );
  assert.deepEqual(
    {
      previewWorkerPrefix:
        workerProjectConfig("playground").previewWorkerPrefix,
      workerName: workerProjectConfig("playground").workerName,
    },
    {
      previewWorkerPrefix: "sketchi-studio-pr",
      workerName: "sketchi-studio",
    },
  );
});

test("identity validation fails closed on project, Worker, or Wrangler drift", () => {
  assert.throws(
    () => requireWorkerIdentity("playground", "sketchi-playground"),
    /Worker identity mismatch for project "playground"/,
  );
  assert.throws(
    () =>
      assertWranglerWorkerIdentity(
        { name: "sketchi-playground" },
        "playground",
        "sketchi-studio",
      ),
    /Wrangler name mismatch for project "playground"/,
  );
  assert.throws(
    () =>
      assertWranglerWorkerIdentity(
        { name: "sketchi-studio", topLevelName: "sketchi-playground" },
        "playground",
        "sketchi-studio",
      ),
    /Wrangler topLevelName mismatch for project "playground"/,
  );
});

test("the public host is playground while Studio persistence remains separate", () => {
  assert.equal(existsSync(new URL("apps/studio", repoRoot)), false);

  const project = JSON.parse(
    readFileSync(new URL("apps/playground/project.json", repoRoot), "utf8"),
  );
  const packageManifest = JSON.parse(
    readFileSync(new URL("apps/playground/package.json", repoRoot), "utf8"),
  );

  assert.equal(project.name, "playground");
  assert.equal(packageManifest.name, "@sketchi/playground");
  assert.equal(
    existsSync(new URL("packages/studio/projects/project.json", repoRoot)),
    true,
  );
});

test("Nx build outputs and deploy targets use project-scoped Worker paths", () => {
  for (const projectId of workerProjectIds) {
    const workerProject = workerProjectConfig(projectId);
    const project = JSON.parse(
      readFileSync(
        new URL(`${workerProject.projectRoot}/project.json`, repoRoot),
        "utf8",
      ),
    );

    assert.equal(project.name, workerProject.projectId);
    assert.deepEqual(project.targets.build.outputs, [
      `{workspaceRoot}/${workerProject.buildOutputPath}`,
      "{projectRoot}/.wrangler/deploy/config.json",
    ]);
    assert.equal(
      project.targets.deploy.options.command,
      `wrangler deploy --config ${workerProject.generatedWranglerConfigPath}`,
    );
  }
});

test("the generated TanStack full-path set equals the pre-rename snapshot", () => {
  const routeTree = readFileSync(
    new URL("apps/playground/src/routeTree.gen.ts", repoRoot),
    "utf8",
  );
  const fullPaths = [
    ...new Set(
      [...routeTree.matchAll(/fullPath:\s*"([^"]+)"/g)].map(
        ([, fullPath]) => fullPath,
      ),
    ),
  ].sort();

  assert.deepEqual(fullPaths, tanstackFullPathSnapshot);
});
