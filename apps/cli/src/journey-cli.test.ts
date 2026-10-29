import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const binary = resolve(process.cwd(), "apps/cli/dist/sketchi.js");

describe("offline journey map input failures", () => {
	it.each([
		{
			name: "a score off the 1-5 scale",
			issue: "invalid_journey_step",
			stages: [{ name: "Discover", steps: [{ label: "Sees an ad", score: 9 }] }],
		},
		{
			name: "a stage without steps",
			issue: "invalid_journey_stage",
			stages: [
				{ name: "Discover", steps: [{ label: "Sees an ad", score: 4 }] },
				{ name: "Buy", steps: [] },
			],
		},
	])("reports $name as invalid_document with exit 3", ({ issue, stages }) => {
		const environment = { ...process.env };
		delete environment["FORCE_COLOR"];
		delete environment["NO_COLOR"];
		const result = spawnSync(
			process.execPath,
			[
				binary,
				"create",
				"--output",
				"json",
				"--json",
				JSON.stringify({ type: "journey", spec: { title: "Purchase", stages } }),
			],
			{ encoding: "utf8", timeout: 20_000, env: environment },
		);
		expect(result.error).toBeUndefined();
		expect(result.status).toBe(3);
		const output: { ok: boolean; error: { code: string; details: string[] } } = JSON.parse(
			result.stderr,
		);
		expect(output).toMatchObject({ ok: false, error: { code: "invalid_document" } });
		expect(output.error.details.some((detail) => detail.startsWith(issue))).toBe(true);
	});
});
