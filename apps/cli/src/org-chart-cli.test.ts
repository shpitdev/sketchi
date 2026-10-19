import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const binary = resolve(process.cwd(), "apps/cli/dist/sketchi.js");

describe("offline org chart input failures", () => {
	it.each([
		{
			name: "a reporting cycle",
			issue: "invalid_reporting_line",
			people: [
				{ id: "a", name: "Ada", manager: "b" },
				{ id: "b", name: "Alan", manager: "a" },
				{ id: "c", name: "Grace" },
			],
		},
		{
			name: "an unknown manager",
			issue: "missing_edge_source",
			people: [
				{ id: "ceo", name: "Ada", title: "CEO" },
				{ id: "cto", name: "Alan", manager: "ghost" },
			],
		},
	])("reports $name as invalid_document with exit 3", ({ issue, people }) => {
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
				JSON.stringify({ type: "org-chart", spec: { title: "Team", people } }),
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
