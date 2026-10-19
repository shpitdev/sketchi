import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const binary = resolve(process.cwd(), "apps/cli/dist/sketchi.js");

describe("offline class diagram input failures", () => {
	it.each([
		{
			name: "an interface extending a class",
			issue: "invalid_generalization",
			relationship: { kind: "inheritance", from: "Drawable", to: "Shape" },
		},
		{
			name: "an unknown class",
			issue: "missing_edge_target",
			relationship: { kind: "association", from: "Shape", to: "Ghost" },
		},
	])("reports $name as invalid_document with exit 3", ({ issue, relationship }) => {
		const environment = { ...process.env };
		delete environment["FORCE_COLOR"];
		delete environment["NO_COLOR"];
		const spec = {
			title: "Invalid shapes",
			classes: [
				{ id: "Drawable", kind: "interface", methods: ["+ draw(): void"] },
				{ id: "Shape", kind: "abstract", methods: ["+ area(): double {abstract}"] },
			],
			relationships: [relationship],
		};
		const result = spawnSync(
			process.execPath,
			[binary, "create", "--output", "json", "--json", JSON.stringify({ type: "class", spec })],
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
