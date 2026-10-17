import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
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
		{
			name: "span ending before it starts",
			issue: "invalid_timeline_span",
			events: [{ id: "phase", label: "Phase", date: "2026-10-01", end: "2026-09-01" }],
		},
		{
			name: "partial lanes",
			issue: "invalid_timeline_lane",
			events: [
				{ id: "a", label: "Laned", date: "2026-10-01", lane: "Eng" },
				{ id: "b", label: "Unlaned", date: "2026-10-02" },
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

describe("offline timeline phases, lanes and today", () => {
	it("creates and exports an editable PNG without network or clock", () => {
		const home = mkdtempSync(join(tmpdir(), "sketchi-timeline-"));
		try {
			const environment: NodeJS.ProcessEnv = { ...process.env, HOME: home };
			delete environment["FORCE_COLOR"];
			const run = (...args: string[]) =>
				spawnSync(process.execPath, [binary, ...args], {
					encoding: "utf8",
					timeout: 60_000,
					env: environment,
				});
			const document = {
				type: "timeline",
				spec: {
					id: "launch-plan",
					title: "Launch plan",
					today: "2026-03-10",
					lanes: ["Product", "Marketing"],
					events: [
						{ id: "build", label: "Build", date: "2026-02-16", end: "2026-05-29", lane: "Product" },
						{ id: "ga", label: "GA", date: "2026-08-04", kind: "milestone", lane: "Product" },
						{ id: "blog", label: "Launch blog", date: "2026-08", lane: "Marketing" },
					],
				},
			};
			const created = run("create", "--output", "json", "--json", JSON.stringify(document));
			expect(created.status, created.stderr).toBe(0);
			const png = join(home, "launch-plan.png");
			const exported = run("export", "launch-plan", "--format", "png", "--dest", png);
			expect(exported.status, exported.stderr).toBe(0);
			expect(readFileSync(png).subarray(1, 4).toString()).toBe("PNG");
			const scene = run("export", "launch-plan", "--format", "scene", "--dest", "-");
			expect(scene.status, scene.stderr).toBe(0);
			expect(scene.stdout).toContain("Today · Mar 10");
			expect(scene.stdout).toContain("Feb 16 – May 29");
			expect(scene.stdout).not.toContain("2026-02-16");
		} finally {
			rmSync(home, { recursive: true, force: true });
		}
	});
});
