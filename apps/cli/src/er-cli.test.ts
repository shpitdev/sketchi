import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const binary = resolve(process.cwd(), "apps/cli/dist/sketchi.js");

describe("offline ER input failures", () => {
	it.each([
		{ name: "unknown field", issue: "unknown_relationship_field", to: "customers.uuid" },
		{ name: "unknown entity", issue: "missing_edge_target", to: "clients.id" },
	])("reports $name as invalid_document with exit 3", ({ issue, to }) => {
		const environment = { ...process.env };
		delete environment["FORCE_COLOR"];
		delete environment["NO_COLOR"];
		const spec = {
			title: "Invalid shop",
			entities: [
				{ id: "customers", fields: ["id uuid PK"] },
				{ id: "orders", fields: ["id uuid PK", "customer_id uuid FK"] },
			],
			relationships: [
				{ from: "orders.customer_id", to, fromCardinality: "zero-or-many", toCardinality: "one" },
			],
		};
		const result = spawnSync(
			process.execPath,
			[binary, "create", "--output", "json", "--json", JSON.stringify({ type: "er", spec })],
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
