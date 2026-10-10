import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";

import { unstable_readConfig } from "wrangler";

import { workerProjectConfig } from "../worker-apps.mjs";

const require = createRequire(import.meta.resolve("nx/package.json"));
const yaml = require("@zkochan/js-yaml");
const preview = yaml.load(
	readFileSync(new URL("../../../.github/workflows/app-preview.yml", import.meta.url), "utf8"),
).jobs["deploy-preview"];
const production = yaml.load(
	readFileSync(
		new URL("../../../.github/workflows/app-production-deploy.yml", import.meta.url),
		"utf8",
	),
).jobs.deploy;

// Evaluate the workflow's small expression subset with concrete matrix/PR inputs.
function concurrency(job, project, prNumber = 42) {
	const matrix = { project };
	const needs = { "resolve-preview-pr": { outputs: { pr_number: prNumber } } };
	const format = (template, ...values) =>
		template.replace(/\{(\d+)\}/g, (_, index) => values[Number(index)]);
	return Object.fromEntries(
		Object.entries(job.concurrency).map(([key, value]) => [
			key,
			typeof value === "string"
				? value.replace(/\$\{\{\s*([\s\S]*?)\s*\}\}/g, (_, expression) =>
						// oxlint-disable-next-line typescript/no-implied-eval -- evaluates workflow expressions the way GitHub Actions would
						new Function(
							"matrix",
							"needs",
							"format",
							`return (${expression.replaceAll("needs.resolve-preview-pr", 'needs["resolve-preview-pr"]')});`,
						)(matrix, needs, format),
					)
				: value,
		]),
	);
}

test("all Pipeline-bound preview and production uploads share a non-cancelling queue", async () => {
	const groups = [];
	for (const job of [preview, production]) {
		for (const project of job.strategy.matrix.project) {
			const config = await unstable_readConfig({
				config: workerProjectConfig(project).wranglerInputConfigPath,
			});
			if (!config.pipelines?.length) continue;
			for (const prNumber of [42, 43, 44]) {
				const policy = concurrency(job, project, prNumber);
				groups.push(policy.group);
				assert.equal(
					String(policy["cancel-in-progress"]),
					"false",
					"Pipeline uploads must not cancel active uploads",
				);
				assert.equal(policy.queue, "max", "pending uploads must queue, not replace one another");
			}
		}
	}
	assert.ok(groups.length >= 6, "must cover both workflows and multiple PRs");
	assert.equal(new Set(groups).size, 1, "production and every PR must contend for the same lock");
});

test("non-Pipeline apps retain independent preview and production concurrency", () => {
	for (const project of ["web", "icons", "excalidraw", "eval-harness"]) {
		const first = concurrency(preview, project, 42);
		const next = concurrency(preview, project, 43);
		const prod = concurrency(production, project);
		assert.equal(first.group, `app-preview-${project}-pr-42`);
		assert.equal(next.group, `app-preview-${project}-pr-43`);
		assert.equal(String(first["cancel-in-progress"]), "true");
		assert.equal(prod.group, `app-production-${project}`);
		assert.equal(prod["cancel-in-progress"], false);
	}
});
