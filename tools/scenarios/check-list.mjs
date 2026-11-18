// Exercise the built CLI the way Frontierclimb discovers cases, including a symlinked checkout path.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const directory = mkdtempSync(join(tmpdir(), "sketchi-scenarios-"));
try {
	const link = join(directory, "dist");
	symlinkSync(fileURLToPath(new URL("./dist", import.meta.url)), link, "dir");
	const stdout = execFileSync(process.execPath, [join(link, "cli.js"), "--list"]);
	const scenarios = JSON.parse(stdout.toString("utf8"));
	assert.ok(Array.isArray(scenarios) && scenarios.length > 0, "Expected a scenario listing");
	console.log(`Scenario listing via symlink: ${stdout.length} bytes`);
} finally {
	rmSync(directory, { recursive: true, force: true });
}
