import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const binary = resolve(process.cwd(), "apps/cli/dist/sketchi.js");

function cli(home: string) {
	const environment: NodeJS.ProcessEnv = { ...process.env, HOME: home };
	delete environment["FORCE_COLOR"];
	delete environment["NO_COLOR"];
	return (...args: string[]) =>
		spawnSync(process.execPath, [binary, ...args], {
			encoding: "utf8",
			timeout: 60_000,
			env: environment,
		});
}

const spec = {
	id: "backlog",
	title: "Backlog: effort vs impact",
	xAxis: { title: "Effort", low: "Low effort", high: "High effort" },
	yAxis: { title: "Impact", low: "Low impact", high: "High impact" },
	quadrants: {
		topLeft: "Quick wins",
		topRight: "Major projects",
		bottomLeft: "Fill-ins",
		bottomRight: "Thankless tasks",
	},
	points: [
		{ label: "Single sign-on", x: 0.3, y: 0.85 },
		{ label: "Admin role templates", x: 0.5, y: 0.6 },
	],
};

describe("offline native quadrant charts", () => {
	it("reports a score out of 0 to 1 as invalid_document with exit 3", () => {
		const home = mkdtempSync(join(tmpdir(), "sketchi-quadrant-"));
		try {
			const result = cli(home)(
				"create",
				"--output",
				"json",
				"--json",
				JSON.stringify({
					type: "quadrant",
					spec: { ...spec, points: [{ label: "Single sign-on", x: 30, y: 85 }] },
				}),
			);
			expect(result.status).toBe(3);
			const output: { error: { code: string; details: string[] } } = JSON.parse(result.stderr);
			expect(output.error.code).toBe("invalid_document");
			expect(
				output.error.details.some((detail) => detail.startsWith("invalid_quadrant_point")),
			).toBe(true);
		} finally {
			rmSync(home, { recursive: true, force: true });
		}
	});

	it("creates a quadrant chart and exports a PNG with the chart's own title only", () => {
		const home = mkdtempSync(join(tmpdir(), "sketchi-quadrant-"));
		try {
			const run = cli(home);
			const created = run(
				"create",
				"--output",
				"json",
				"--json",
				JSON.stringify({ type: "quadrant", spec }),
			);
			expect(created.status, created.stderr).toBe(0);
			const scene = run("export", "backlog", "--format", "scene", "--dest", "-");
			expect(scene.status, scene.stderr).toBe(0);
			const parsed: { width: number; height: number; elements: { text?: string }[] } = JSON.parse(
				scene.stdout,
			);
			expect(parsed.elements.filter((element) => element.text === spec.title)).toHaveLength(1);
			const png = join(home, "backlog.png");
			const exported = run("export", "backlog", "--format", "png", "--dest", png);
			expect(exported.status, exported.stderr).toBe(0);
			const bytes = readFileSync(png);
			expect(bytes.subarray(1, 4).toString()).toBe("PNG");
			// The chart draws its own title, so no 64px banner sits above it.
			const ratio = bytes.readUInt32BE(20) / bytes.readUInt32BE(16);
			const content = { width: parsed.width - 80 + 40, height: parsed.height - 80 + 40 };
			const plain = content.height / content.width;
			const bannered = (content.height + 64) / content.width;
			expect(Math.abs(ratio - plain)).toBeLessThan(Math.abs(ratio - bannered));
		} finally {
			rmSync(home, { recursive: true, force: true });
		}
	});
});
