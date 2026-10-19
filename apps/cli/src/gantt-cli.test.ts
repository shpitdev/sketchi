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

describe("offline native Gantt charts", () => {
	it("reports a dependency cycle as invalid_document with exit 3", () => {
		const home = mkdtempSync(join(tmpdir(), "sketchi-gantt-"));
		try {
			const result = cli(home)(
				"create",
				"--output",
				"json",
				"--json",
				JSON.stringify({
					type: "gantt",
					spec: {
						title: "Loop",
						tasks: [
							{ id: "a", label: "A", start: "2026-03-02", duration: 2, dependsOn: ["b"] },
							{ id: "b", label: "B", start: "2026-03-04", duration: 2, dependsOn: ["a"] },
						],
					},
				}),
			);
			expect(result.status).toBe(3);
			const output: { error: { code: string; details: string[] } } = JSON.parse(result.stderr);
			expect(output.error.code).toBe("invalid_document");
			expect(
				output.error.details.some((detail) => detail.startsWith("gantt_dependency_cycle")),
			).toBe(true);
		} finally {
			rmSync(home, { recursive: true, force: true });
		}
	});

	it("creates a plan and exports a PNG with the chart's own title only", () => {
		const home = mkdtempSync(join(tmpdir(), "sketchi-gantt-"));
		try {
			const run = cli(home);
			const document = {
				type: "gantt",
				spec: {
					id: "release-plan",
					title: "Release plan",
					tasks: [
						{ id: "design", label: "Design", start: "2026-03-02", end: "2026-03-06" },
						{
							id: "build",
							label: "Build",
							start: "2026-03-09",
							duration: 5,
							dependsOn: ["design"],
						},
						{
							id: "ship",
							label: "Ship",
							start: "2026-03-16",
							milestone: true,
							dependsOn: ["build"],
						},
					],
				},
			};
			const created = run("create", "--output", "json", "--json", JSON.stringify(document));
			expect(created.status, created.stderr).toBe(0);
			const scene = run("export", "release-plan", "--format", "scene", "--dest", "-");
			expect(scene.status, scene.stderr).toBe(0);
			const parsed: { width: number; height: number; elements: { text?: string }[] } = JSON.parse(
				scene.stdout,
			);
			expect(parsed.elements.filter((element) => element.text === "Release plan")).toHaveLength(1);
			const png = join(home, "release-plan.png");
			const exported = run("export", "release-plan", "--format", "png", "--dest", png);
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
