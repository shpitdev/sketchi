import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const binary = resolve(process.cwd(), "apps/cli/dist/sketchi.js");

describe("offline timeline input failures", () => {
	it.each([
		{
			name: "impossible date",
			issue: "invalid_timeline_date",
			events: [{ id: "bad", label: "Impossible day", date: "2026-02-30" }],
		},
		{
			name: "duplicate event IDs",
			issue: "duplicate_event_id",
			events: [
				{ id: "same", label: "First", order: 1 },
				{ id: "same", label: "Second", order: 2 },
			],
		},
		{
			name: "mixed chronology",
			issue: "invalid_timeline_order",
			events: [
				{ id: "dated", label: "Dated event", date: "2026-10-01" },
				{ id: "ordered", label: "Ordered event", order: 2 },
			],
		},
	])("reports $name as invalid_document with exit 3", ({ events, issue }) => {
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
				JSON.stringify({ type: "timeline", spec: { title: "Invalid timeline", events } }),
			],
			{ encoding: "utf8", timeout: 20_000, env: environment },
		);
		expect(result.error).toBeUndefined();
		expect(result.status).toBe(3);
		expect(result.stdout).toBe("");
		const output: { ok: boolean; error: { code: string; details: string[] } } = JSON.parse(
			result.stderr,
		);
		expect(output).toMatchObject({ ok: false, error: { code: "invalid_document" } });
		expect(output.error.details.some((detail) => detail.startsWith(issue))).toBe(true);
	});
});
