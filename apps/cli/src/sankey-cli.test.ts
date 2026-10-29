import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const binary = resolve(process.cwd(), "apps/cli/dist/sketchi.js");

describe("offline Sankey input failures", () => {
	it.each([
		{
			name: "a cycle",
			issue: "sankey_cycle",
			links: [
				{ source: "visit", target: "cart", value: 10 },
				{ source: "cart", target: "visit", value: 2 },
			],
		},
		{
			name: "a negative flow",
			issue: "invalid_sankey_flow",
			links: [{ source: "visit", target: "cart", value: -3 }],
		},
	])("reports $name as invalid_document with exit 3", ({ issue, links }) => {
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
					type: "sankey",
					spec: {
						title: "Checkout",
						nodes: [
							{ id: "visit", label: "Visit" },
							{ id: "cart", label: "Cart" },
						],
						links,
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
