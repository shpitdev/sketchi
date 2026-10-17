import assert from "node:assert/strict";
import test from "node:test";

import { ciScope } from "../ci-scope.mjs";

test("a docs-only change skips every conditional gate", () => {
	assert.deepEqual(ciScope({ all: false, projects: [], changedFiles: ["docs/architecture.md"] }), {
		code: false,
		storybook: false,
	});
});

test("an affected project runs workspace-wide type and graph checks", () => {
	const scope = ciScope({
		all: false,
		projects: ["diagram-renderer", "diagram-ui"],
		changedFiles: ["packages/diagram/renderer/src/index.ts"],
	});
	assert.equal(scope.code, true);
	assert.equal(scope.storybook, true);
});

test("root workspace and tooling files count as code without an affected project", () => {
	for (const file of ["tools/project-graph.test.ts", "pnpm-lock.yaml", "tsconfig.json"]) {
		assert.equal(ciScope({ all: false, projects: [], changedFiles: [file] }).code, true, file);
	}
	assert.equal(
		ciScope({ all: false, projects: [], changedFiles: ["apps/web/README.md"] }).storybook,
		false,
	);
});

test("the release gate runs everything", () => {
	assert.deepEqual(ciScope({ all: true, projects: [], changedFiles: [] }), {
		code: true,
		storybook: true,
	});
});
