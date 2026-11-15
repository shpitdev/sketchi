import assert from "node:assert/strict";
import test from "node:test";

import { ciScope } from "../ci-scope.mjs";

const unitScope = (changedFiles, projects = []) =>
	ciScope({ all: false, full: false, projects, changedFiles });

test("a docs-only unit change skips every conditional gate", () => {
	assert.deepEqual(unitScope(["docs/architecture.md"]), {
		code: false,
		storybook: false,
		routing: false,
	});
});

test("an affected project runs workspace-wide type and graph checks", () => {
	const scope = unitScope(["packages/diagrams/src/render.ts"], ["diagrams", "editor"]);
	assert.equal(scope.code, true);
	assert.equal(scope.storybook, true);
});

test("root workspace and tooling files count as code without an affected project", () => {
	for (const file of ["tools/project-graph.test.ts", "pnpm-lock.yaml", "tsconfig.json"]) {
		assert.equal(unitScope([file]).code, true, file);
	}
	assert.equal(unitScope(["apps/web/README.md"]).storybook, false);
});

test("routing follows graph, drawing, font, shared contract and execution inputs", () => {
	for (const file of [
		"packages/diagrams/src/graph/routing.ts",
		"packages/diagrams/src/graph/intermediate.ts",
		"packages/diagrams/src/families/flowchart/diagram.ts",
		"packages/diagrams/src/families/state-machine/document.ts",
		"packages/diagrams/src/families/flowchart/fixtures/routing/retry.ts",
		"packages/diagrams/src/family.ts",
		"packages/diagrams/src/build/result.ts",
		"packages/diagrams/vitest.config.ts",
		"packages/drawing/src/scene.ts",
		"packages/drawing/src/text-metrics.ts",
		"packages/drawing/src/excalifont-ink.ts",
		"packages/drawing/src/excalidraw/convert.ts",
		"packages/drawing/vitest.routing.config.ts",
		"packages/editor/public/fonts/Excalifont/face.woff2",
		"tools/drawing-tests/routing-fuzz.test.ts",
		"tools/drawing-tests/routing-state-fuzz.test.ts",
		"tools/drawing-tests/routing-fuzz-helpers.ts",
		"tools/drawing-tests/text-fit-helpers.ts",
		"scripts/ci-local.mjs",
		"scripts/ci-scope.mjs",
		"package.json",
		"pnpm-lock.yaml",
		"pnpm-workspace.yaml",
		"nx.json",
		"vitest.config.ts",
		"tsconfig.base.json",
		"tsconfig.json",
		"mise.toml",
		".npmrc",
	]) {
		assert.equal(unitScope([file]).routing, true, file);
	}
});

test("plain-family and unrelated unit changes do not run graph routing even if drawing is affected", () => {
	for (const file of [
		"packages/diagrams/src/families/mindmap/layout.ts",
		"packages/diagrams/src/families/timeline/render.ts",
		"packages/diagrams/src/families/sequence/build.ts",
		"packages/diagrams/src/families/state-machine/render.ts",
		"packages/diagrams/src/families/chart/render.ts",
		"tools/drawing-tests/text-fit-fuzz.test.ts",
		"packages/editor/src/edit-session.ts",
		"apps/studio/src/server.ts",
		"docs/architecture.md",
	]) {
		assert.equal(unitScope([file], ["drawing", "diagrams", "editor"]).routing, false, file);
	}
});

test("full origin/main gates and --all always include routing with no affected project", () => {
	assert.equal(ciScope({ all: false, full: true, projects: [], changedFiles: [] }).routing, true);
	assert.deepEqual(ciScope({ all: true, full: false, projects: [], changedFiles: [] }), {
		code: true,
		storybook: true,
		routing: true,
	});
});
