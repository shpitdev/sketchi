import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const binary = resolve(process.cwd(), "apps/cli/dist/sketchi.js");

const waitlist = {
	type: "flowchart",
	spec: {
		id: "waitlist",
		title: "Waitlist",
		nodes: {
			arrive: "Party arrives",
			ready: "Table ready?",
			seat: "Seat party",
			wait: "Keep waiting",
		},
		edges: [
			["arrive", "ready"],
			["ready", "seat", "yes"],
			["ready", "wait", "no"],
			["wait", "ready"],
		],
	},
};

describe("sketchi edit with flowchart edits", () => {
	let home: string;
	const run = (...args: string[]) => {
		const environment: NodeJS.ProcessEnv = { ...process.env, HOME: home };
		delete environment["FORCE_COLOR"];
		delete environment["NO_COLOR"];
		return spawnSync(process.execPath, [binary, ...args], {
			encoding: "utf8",
			timeout: 20_000,
			env: environment,
		});
	};

	beforeEach(() => {
		home = mkdtempSync(join(tmpdir(), "sketchi-flowchart-edit-"));
	});
	afterEach(() => {
		rmSync(home, { recursive: true, force: true });
	});

	it("applies edits by id or label as the record's next revision, offline", () => {
		expect(run("create", "--output", "json", "--json", JSON.stringify(waitlist)).status).toBe(0);

		const edited = run(
			"edit",
			"waitlist",
			"--output",
			"json",
			"--json",
			JSON.stringify({
				edits: [
					{ op: "insert", node: { text: "Text party" }, between: ["Table ready?", "seat"] },
					{ op: "set", nodes: { seat: { color: "green" } } },
				],
			}),
		);
		expect(edited.status).toBe(0);
		const output = JSON.parse(edited.stdout) as {
			data: {
				revision: number;
				document: { spec: { nodes: Record<string, unknown>; edges: unknown[] } };
				warnings: { code: string; message: string }[];
			};
		};
		expect(output.data.revision).toBe(2);
		expect(output.data.document.spec.nodes).toMatchObject({
			text: "Text party",
			seat: { label: "Seat party", color: "green" },
		});
		expect(output.data.document.spec.edges).toContainEqual(["ready", "text", "yes"]);
		expect(output.data.document.spec.edges).toContainEqual(["text", "seat"]);
		expect(output.data.warnings).toEqual([
			expect.objectContaining({
				code: "reference_resolved",
				message: 'edits[0].between[0]: resolved "Table ready?" to the node labeled it, "ready".',
			}),
		]);
	});

	it("draws a curved flowchart's lines as curves, and squares them again on request", () => {
		const curvedWaitlist = { ...waitlist, spec: { ...waitlist.spec, curved: true } };
		expect(run("create", "--output", "json", "--json", JSON.stringify(curvedWaitlist)).status).toBe(
			0,
		);
		const lines = () => {
			const exported = run("export", "waitlist", "--format", "excalidraw", "--dest", "-");
			expect(exported.status).toBe(0);
			return (
				JSON.parse(exported.stdout) as {
					elements: { type: string; elbowed?: boolean; roundness: unknown }[];
				}
			).elements.filter((element) => element.type === "arrow");
		};
		const curved = lines();
		expect(curved.length).toBe(4);
		expect(curved.every((line) => line.elbowed === false && line.roundness !== null)).toBe(true);

		const squared = run(
			"edit",
			"waitlist",
			"--output",
			"json",
			"--json",
			JSON.stringify({ edits: [{ op: "set", curved: false }] }),
		);
		expect(squared.status).toBe(0);
		expect(lines().some((line) => line.elbowed === true)).toBe(true);
	});

	it("names an edit that does not apply at its path and keeps the record", () => {
		expect(run("create", "--output", "json", "--json", JSON.stringify(waitlist)).status).toBe(0);

		const failed = run(
			"edit",
			"waitlist",
			"--output",
			"json",
			"--json",
			JSON.stringify({
				edits: [{ op: "insert", node: { x: "X" }, between: ["arrive", "nowhere"] }],
			}),
		);
		expect(failed.status).toBe(3);
		expect(JSON.parse(failed.stderr)).toMatchObject({
			ok: false,
			error: {
				code: "invalid_document",
				details: [expect.stringMatching(/^edits\[0\]\.between\[1\]: /)],
			},
		});
		const shown = JSON.parse(run("show", "waitlist", "--output", "json").stdout) as {
			data: { revision: number };
		};
		expect(shown.data.revision).toBe(1);
	});

	it("refuses to patch a flowchart, pointing at edit", () => {
		expect(run("create", "--output", "json", "--json", JSON.stringify(waitlist)).status).toBe(0);
		const refused = run(
			"patch",
			"waitlist",
			"--output",
			"json",
			"--json",
			JSON.stringify({
				operations: [
					{ op: "setStyle", selector: { nodeIds: ["seat"] }, style: { strokeColor: "#16a34a" } },
				],
			}),
		);
		expect(refused.status).toBe(3);
		expect(JSON.parse(refused.stderr)).toMatchObject({
			error: {
				message: 'Diagram "waitlist" is a flowchart, which is not patched.',
				hint: expect.stringContaining("sketchi edit waitlist --json"),
			},
		});
	});

	it("refuses edits to a diagram that is not a flowchart", () => {
		const timeline = {
			type: "timeline",
			spec: {
				id: "launch",
				title: "Launch",
				events: [
					{ id: "a", label: "Plan", order: 1 },
					{ id: "b", label: "Ship", order: 2 },
				],
			},
		};
		expect(run("create", "--output", "json", "--json", JSON.stringify(timeline)).status).toBe(0);
		const refused = run(
			"edit",
			"launch",
			"--output",
			"json",
			"--json",
			JSON.stringify({ edits: [{ op: "set", title: "Renamed" }] }),
		);
		expect(refused.status).toBe(3);
		expect(JSON.parse(refused.stderr)).toMatchObject({
			error: { message: 'Diagram "launch" is a timeline; edits change flowcharts.' },
		});
	});
});
