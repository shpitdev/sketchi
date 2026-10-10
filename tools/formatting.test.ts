import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as ts from "typescript";
import { describe, expect, it } from "vitest";

const workspaceRoot = fileURLToPath(new URL("../", import.meta.url));
// Gitignored, so no tracked file can match it.
const untrackedExclusions = new Set([".memory/**"]);
// One representative per exclusion class that must never be reformatted.
const requiredExclusions = [
	"apps/web/src/routeTree.gen.ts",
	"packages/icons/catalog/src/generated/icon-catalog.json",
	"apps/cli/src/__fixtures__/output/generate-success.json",
	"apps/playground/src/server/codemode/fixtures/http-artifact-compatibility-v1.json",
	"packages/diagram/agent/src/lib/code-mode/fixtures/compatibility-v1.json",
	"apps/playground/src/components/ai-elements/code-block.tsx",
	"apps/playground/src/components/ui/button.tsx",
	"packages/icons/catalog/pipeline-output/review/review-data.json",
	"apps/cli/CHANGELOG.md",
];

function oxfmtIgnorePatterns(): string[] {
	const configPath = path.join(workspaceRoot, ".oxfmtrc.json");
	const parsed = ts.parseConfigFileTextToJson(configPath, readFileSync(configPath, "utf8"));
	if (parsed.error) {
		throw new Error(ts.flattenDiagnosticMessageText(parsed.error.messageText, "\n"));
	}
	const patterns: string[] = parsed.config.ignorePatterns ?? [];
	return patterns;
}

function trackedFiles(): string[] {
	return execFileSync("git", ["ls-files", "-z"], {
		cwd: workspaceRoot,
		encoding: "utf8",
		maxBuffer: 64 * 1024 * 1024,
	})
		.split("\0")
		.filter(Boolean);
}

describe("Oxfmt exclusions", () => {
	it("names only live paths and keeps the formatter off every excluded file", () => {
		const patterns = oxfmtIgnorePatterns();
		const tracked = trackedFiles();
		const excluded = new Set<string>();

		for (const pattern of patterns) {
			const matches = tracked.filter((file) => path.matchesGlob(file, pattern));
			if (!untrackedExclusions.has(pattern)) {
				expect(matches.length, `${pattern} matches no tracked file`).toBeGreaterThan(0);
			}
			for (const file of matches) excluded.add(file);
		}

		for (const file of requiredExclusions) {
			expect(excluded.has(file), `${file} must stay excluded`).toBe(true);
		}

		const formattable = [...excluded].filter((file) =>
			/\.(?:[cm]?[jt]sx?|json|jsonc|css|ya?ml|md|html)$/.test(file),
		);
		expect(formattable.length).toBeGreaterThan(0);

		// Oxfmt refuses to run when every target is excluded, which proves no
		// excluded file would be rewritten by `pnpm format`.
		const result = spawnSync(
			path.join(workspaceRoot, "node_modules", ".bin", "oxfmt"),
			["--list-different", ...formattable],
			{ cwd: workspaceRoot, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
		);
		expect(result.stdout).toBe("");
		expect(result.stderr).toContain("All matched files may have been excluded by ignore rules");
	});
});
