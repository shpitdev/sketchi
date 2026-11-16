import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";

import {
	productionDomainWranglerConfig,
	productionProjectConfig,
	selectProductionProjects,
} from "./production.mjs";
import { workerProjectIds } from "../worker-apps.mjs";

const yaml = createRequire(import.meta.resolve("nx/package.json"))("@zkochan/js-yaml");
const workflow = yaml.load(
	readFileSync(
		new URL("../../../.github/workflows/app-production-deploy.yml", import.meta.url),
		"utf8",
	),
);

test("production project selection is explicit and closed", () => {
	assert.throws(() => productionProjectConfig(), /Production project selection is required/);
	assert.throws(() => productionProjectConfig("studio"), /Unknown production project "studio"/);
});

test("productionDomainWranglerConfig adds only approved manual domains", () => {
	const domainConfig = productionDomainWranglerConfig(
		{
			name: "sketchi-icons",
			route: "icons.sketchi.app/*",
			routes: ["icons.sketchi.app/*"],
			domains: [{ pattern: "icons.sketchi.app" }],
			custom_domain: true,
			vars: {
				SKETCHI_APP_SURFACE: "icons",
			},
			r2_buckets: [
				{
					binding: "SKETCHI_ARTIFACTS",
					bucket_name: "sketchi-studio-codemode-artifacts-production",
					preview_bucket_name: "sketchi-studio-codemode-artifacts-preview",
				},
			],
		},
		{ projectId: "icons", workerName: "sketchi-icons" },
	);

	assert.equal(domainConfig.name, "sketchi-icons");
	assert.equal(domainConfig.topLevelName, "sketchi-icons");
	assert.equal(domainConfig.workers_dev, true);
	assert.deepEqual(domainConfig.routes, [
		{
			pattern: "icons.sketchi.app",
			custom_domain: true,
		},
	]);
	assert.equal(domainConfig.route, undefined);
	assert.equal(domainConfig.domains, undefined);
	assert.equal(domainConfig.custom_domain, undefined);
	assert.deepEqual(domainConfig.vars, {
		SKETCHI_APP_SURFACE: "icons",
	});
	assert.deepEqual(domainConfig.r2_buckets, [
		{
			binding: "SKETCHI_ARTIFACTS",
			bucket_name: "sketchi-studio-codemode-artifacts-production",
			preview_bucket_name: "sketchi-studio-codemode-artifacts-preview",
		},
	]);
});

test("playground domain attach preserves Studio runtime identity and contracts", () => {
	const domainConfig = productionDomainWranglerConfig(
		{
			name: "sketchi-studio",
			routes: ["playground.sketchi.app/*"],
			vars: {
				SKETCHI_APP_SURFACE: "studio",
			},
		},
		{ projectId: "playground", workerName: "sketchi-studio" },
	);

	assert.equal(domainConfig.name, "sketchi-studio");
	assert.deepEqual(domainConfig.routes, [
		{
			pattern: "playground.sketchi.app",
			custom_domain: true,
		},
	]);
	assert.deepEqual(domainConfig.vars, {
		SKETCHI_APP_SURFACE: "studio",
	});
});

test("domain attach fails closed on project or source Worker mismatch", () => {
	assert.throws(
		() =>
			productionDomainWranglerConfig(
				{ name: "sketchi-studio" },
				{ projectId: "playground", workerName: "sketchi-playground" },
			),
		/Worker identity mismatch for project "playground"/,
	);
	assert.throws(
		() =>
			productionDomainWranglerConfig(
				{ name: "sketchi-playground" },
				{ projectId: "playground", workerName: "sketchi-studio" },
			),
		/Wrangler name mismatch for project "playground"/,
	);
});

test("internal projects emit no public routes", () => {
	const domainConfig = productionDomainWranglerConfig(
		{
			name: "sketchi-excalidraw",
			routes: ["excalidraw.sketchi.app/*"],
			vars: {
				SKETCHI_APP_SURFACE: "excalidraw",
			},
		},
		{ projectId: "excalidraw", workerName: "sketchi-excalidraw" },
	);

	assert.equal(domainConfig.name, "sketchi-excalidraw");
	assert.deepEqual(domainConfig.routes, []);
	assert.deepEqual(domainConfig.vars, {
		SKETCHI_APP_SURFACE: "excalidraw",
	});
});

test("selectProductionProjects selects affected Workers, all projects, or one named project", () => {
	assert.deepEqual(
		selectProductionProjects({
			selection: "affected",
			affected: ["diagrams", "playground", "excalidraw", "sketchi-cli"],
		}),
		["excalidraw", "playground"],
	);
	assert.deepEqual(selectProductionProjects({ selection: "affected", affected: [] }), []);
	assert.deepEqual(selectProductionProjects({ selection: "all" }), workerProjectIds);
	assert.deepEqual(selectProductionProjects({ selection: "web" }), ["web"]);
	assert.throws(() => selectProductionProjects({ selection: "studio" }), /Unknown Worker project/);
});

test("production deploys only by manual dispatch", () => {
	assert.deepEqual(Object.keys(workflow.on), ["workflow_dispatch"]);
});
