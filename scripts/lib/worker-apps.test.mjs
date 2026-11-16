import assert from "node:assert/strict";
import test from "node:test";

import { unstable_readConfig } from "wrangler";

import {
	assertWranglerWorkerIdentity,
	requireWorkerIdentity,
	workerProjectConfig,
	workerProjectIds,
} from "./worker-apps.mjs";

const expectedWorkers = {
	excalidraw: "sketchi-excalidraw",
	icons: "sketchi-icons",
	playground: "sketchi-studio",
	web: "sketchi-web",
};

test("Worker resolution requires an explicit project selection", () => {
	assert.throws(() => workerProjectConfig(), /Worker project selection is required/);
});

test("Worker projects have isolated build and generated config paths", () => {
	const projects = workerProjectIds.map((projectId) => workerProjectConfig(projectId));
	const uniqueFields = [
		"buildOutputPath",
		"generatedWranglerConfigPath",
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
			project.productionDomainWranglerConfigPath,
			`${project.buildOutputPath}/server/wrangler.domains.json`,
		);
	}
});

test("project IDs resolve independently to durable Worker identities", async () => {
	for (const [projectId, expectedWorkerName] of Object.entries(expectedWorkers)) {
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
	assert.notEqual(playground.projectId, playground.workerName);
});

test("identity validation fails closed on project, Worker, or Wrangler drift", () => {
	assert.throws(
		() => requireWorkerIdentity("playground", "sketchi-playground"),
		/Worker identity mismatch for project "playground"/,
	);
	assert.throws(
		() =>
			assertWranglerWorkerIdentity({ name: "sketchi-playground" }, "playground", "sketchi-studio"),
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
