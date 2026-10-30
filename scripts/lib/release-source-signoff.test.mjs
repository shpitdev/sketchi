import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";

import { gateSignoff, isVersionBump } from "../release-source-signoff.mjs";

const require = createRequire(import.meta.resolve("nx/package.json"));
const release = require("@zkochan/js-yaml").load(
	readFileSync(new URL("../../.github/workflows/release.yml", import.meta.url), "utf8"),
).jobs;

const bump = [
	"diff --git a/apps/cli/package.json b/apps/cli/package.json",
	"--- a/apps/cli/package.json",
	"+++ b/apps/cli/package.json",
	"@@ -3 +3 @@",
	'-  "version": "0.4.1",',
	'+  "version": "0.4.2",',
].join("\n");

test("a Version Packages diff counts as the same source", () => {
	assert.ok(
		isVersionBump({
			files: [".changeset/quiet-owls.md", "apps/cli/CHANGELOG.md", "apps/cli/package.json"],
			packageDiff: bump,
		}),
	);
	assert.ok(isVersionBump({ files: ["apps/cli/CHANGELOG.md"], packageDiff: "" }));
});

test("any other change is new source", () => {
	assert.ok(!isVersionBump({ files: ["apps/cli/src/index.ts"], packageDiff: "" }));
	assert.ok(
		!isVersionBump({ files: ["pnpm-lock.yaml", "apps/cli/package.json"], packageDiff: bump }),
	);
	assert.ok(
		!isVersionBump({
			files: ["apps/cli/package.json"],
			packageDiff: `${bump}\n@@ -20 +20 @@\n-    "effect": "4.0.1",\n+    "effect": "4.0.2",`,
		}),
	);
});

test("only a signoff the gate posted itself counts, not a carried one", () => {
	const status = (fields) => ({ context: "local-ci", state: "success", ...fields });
	assert.ok(gateSignoff([status({ description: "Passed in 4m2s on omarchy" })]));
	assert.equal(
		gateSignoff([status({ description: "carried from 1234abcd (same patch)" })]),
		undefined,
	);
	assert.equal(gateSignoff([status({ state: "pending", description: "Passed" })]), undefined);
	assert.equal(gateSignoff([{ context: "ci", state: "success", description: "" }]), undefined);
});

test("the full gate runs only when no signoff covers the released source", () => {
	const source = release.guard.steps.find(({ id }) => id === "source");
	assert.equal(source.run, "node scripts/release-source-signoff.mjs");
	assert.match(
		release.guard.steps
			.find(({ uses }) => uses?.startsWith("actions/checkout@"))
			.with["fetch-depth"].toString(),
		/^2$/,
	);
	assert.equal(release.guard.outputs.verified, "${{ steps.source.outputs.verified }}");
	assert.match(release.verify.if, /needs\.guard\.outputs\.verified != 'true'/);
	assert.match(release.verify.if, /needs\.guard\.outputs\.publish == 'true'/);
	assert.match(release.verify.steps.at(-1).run, /pnpm ci:local --no-signoff --all/);

	// Publishing waits for the gate, and a skipped gate only means the source was covered.
	assert.match(release.publish.if, /needs\.guard\.outputs\.publish == 'true'/);
	assert.match(
		release.publish.if,
		/needs\.verify\.result == 'success' \|\| needs\.verify\.result == 'skipped'/,
	);
	assert.match(release.tag.if, /needs\.publish\.result == 'success'/);
	assert.match(release.release.if, /needs\.tag\.result == 'success'/);
	for (const job of [release.publish, release.tag, release.release]) {
		assert.match(job.if, /!cancelled\(\)/);
	}
});
