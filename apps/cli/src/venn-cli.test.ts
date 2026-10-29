import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const binary = resolve(process.cwd(), "apps/cli/dist/sketchi.js");

describe("offline Venn diagram input failures", () => {
	it.each([
		{
			name: "a region naming an unknown set",
			issue: "invalid_venn_region",
			regions: [{ sets: ["ios", "web"], items: ["Push notifications"] }],
		},
		{
			name: "a region with items and a count",
			issue: "invalid_venn_region",
			regions: [{ sets: ["ios"], items: ["Apple Pay"], count: 3 }],
		},
	])("reports $name as invalid_document with exit 3", ({ issue, regions }) => {
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
				JSON.stringify({
					type: "venn",
					spec: {
						title: "Platforms",
						sets: [
							{ id: "ios", label: "iOS" },
							{ id: "android", label: "Android" },
						],
						regions,
					},
				}),
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
