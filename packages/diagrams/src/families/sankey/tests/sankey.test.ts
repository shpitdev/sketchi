import { type CanvasSpec } from "@sketchi/drawing";
import { validateExcalidrawScene } from "@sketchi/drawing/excalidraw";
import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";

import {
	CodeModeArtifactStorage,
	makeMemoryArtifactStorage,
} from "../../../build/code-mode/artifacts.js";
import { buildSankey } from "../../../build/code-mode/builds.js";
import { CodeModeRuntimeEnvironment } from "../../../build/code-mode/runtime.js";
import { applyDiagramPatch } from "../../../canvas/patch.js";
import { buildResponse, type BuildRejection } from "../../../build/operation.js";
import {
	getSankeyValidationIssues,
	SANKEY_MAX_NODES,
	type SankeyDiagram,
	sankeyFixture,
	SankeyValidationIssueCodeSchema,
} from "../document.js";
import { sankeyStressFixtures } from "../fixtures.js";
import { layoutSankeyDiagram } from "../layout.js";
import { readSankeyScene, type SankeyLayoutIssue, sankeyLayoutIssues } from "../readout.js";
import { renderSankeyDiagram } from "../render.js";

const storage = makeMemoryArtifactStorage();
function run<A, E extends BuildRejection<unknown>>(
	effect: Effect.Effect<A, E, CodeModeRuntimeEnvironment | CodeModeArtifactStorage>,
	artifacts = storage,
) {
	return Effect.runPromise(
		buildResponse(effect).pipe(
			Effect.provideService(CodeModeRuntimeEnvironment, {
				createId: (prefix) => `${prefix}_${Math.random().toString(36).slice(2)}`,
			}),
			Effect.provideService(CodeModeArtifactStorage, artifacts),
		),
	);
}
const options = {
	inlineArtifacts: ["scene", "excalidraw"],
	artifactFormats: ["scene", "excalidraw"],
} as const;
const inline = (built: { artifact: { formats: { format: string; inline?: unknown }[] } }) =>
	new Map(built.artifact.formats.map((format) => [format.format, format.inline]));
type Excalidraw = Parameters<typeof validateExcalidrawScene>[0];

/** The documented example: two departments' spend on three services. */
const budgetSpec = {
	title: "Cloud budget",
	unit: "$k",
	nodes: [
		{ id: "eng", label: "Engineering" },
		{ id: "data", label: "Data" },
		{ id: "compute", label: "Compute" },
		{ id: "storage", label: "Storage" },
		{ id: "db", label: "Databases" },
	],
	links: [
		{ source: "eng", target: "compute", value: 180 },
		{ source: "eng", target: "db", value: 60 },
		{ source: "data", target: "storage", value: 85 },
		{ source: "data", target: "compute", value: 4 },
	],
};

describe("Sankey diagrams", () => {
	it("build the documented spec into a valid Excalidraw file that keeps its mark roles through a patch", async () => {
		const built = await run(buildSankey({ spec: budgetSpec, options }));
		if (!built.ok) throw new Error(JSON.stringify(built.issues));
		expect(validateExcalidrawScene(inline(built).get("excalidraw") as Excalidraw)).toEqual({
			ok: true,
			issues: [],
		});

		const patched = await run(
			applyDiagramPatch({
				source: { artifactId: built.artifact.artifactId },
				operations: [
					{
						op: "setStyle",
						selector: { nodeIds: ["sankey:node:eng"] },
						style: { strokeColor: "#1f44c9" },
					},
				],
				options,
			}),
		);
		if (!patched.ok) throw new Error(JSON.stringify(patched.issues));
		const scene = inline(patched).get("scene") as CanvasSpec;
		expect(scene.elements.find((element) => element.id === "node:sankey:node:eng")).toMatchObject({
			strokeColor: "#1f44c9",
			rendererRole: "sankey-mark",
		});
		expect(validateExcalidrawScene(inline(patched).get("excalidraw") as Excalidraw)).toEqual({
			ok: true,
			issues: [],
		});
	});

	it("refuse a layout whose labels cannot all sit clear, storing nothing", async () => {
		const teams = Array.from({ length: 8 }, (_, index) => ({
			id: `t${index}`,
			label: `Team ${index}`,
		}));
		const services = Array.from({ length: 8 }, (_, index) => ({
			id: `s${index}`,
			label: `Service ${index}`,
		}));
		const memory = makeMemoryArtifactStorage();
		const writes = vi.spyOn(memory, "write");
		const crowded = await run(
			buildSankey({
				spec: {
					title: "All to all",
					nodes: [...teams, ...services],
					links: teams.flatMap((team) =>
						services.map((service) => ({
							source: team.id,
							target: service.id,
							value: 1,
							label: "Renewals and expansions and other income",
						})),
					),
				},
				options: { minQualityScore: 0 },
			}),
			memory,
		);
		expect(crowded).toMatchObject({ ok: false, status: "quality_failed" });
		expect(writes).not.toHaveBeenCalled();
	});

	it("bound the ordering work", () => {
		// Deterministic pair comparisons, not wall clock.
		const { dense } = sankeyStressFixtures;
		expect(layoutSankeyDiagram(dense).work).toBeLessThan(4_200_000);
		expect(renderSankeyDiagram(dense)).toEqual(renderSankeyDiagram(dense));
	});
});

const node = (id: string) => ({ id, label: id });
const link = (source: string, target: string, value = 1) => ({ source, target, value });

/** One minimal bad diagram per code the validator owns. */
const bad: Record<string, Partial<SankeyDiagram>> = {
	sankey_too_large: {
		nodes: Array.from({ length: SANKEY_MAX_NODES + 1 }, (_, index) => node(`n${index}`)),
	},
	invalid_sankey_node_id: { nodes: [node("a:1"), node("b")], links: [link("a:1", "b")] },
	duplicate_sankey_node_id: { nodes: [node("a"), node("a"), node("b")], links: [link("a", "b")] },
	sankey_text_too_long: {
		nodes: [{ id: "a", label: "A".repeat(49) }, node("b")],
		links: [link("a", "b")],
	},
	unknown_sankey_node: { nodes: [node("a"), node("b")], links: [link("a", "z")] },
	sankey_self_link: { nodes: [node("a"), node("b")], links: [link("a", "b"), link("b", "b")] },
	duplicate_sankey_link: { nodes: [node("a"), node("b")], links: [link("a", "b"), link("a", "b")] },
	invalid_sankey_value: { nodes: [node("a"), node("b")], links: [link("a", "b", 0)] },
	sankey_cycle: {
		nodes: [node("a"), node("b")],
		links: [link("a", "b"), link("b", "a")],
	},
	unlinked_sankey_node: { nodes: [node("a"), node("b"), node("c")], links: [link("a", "b")] },
	blank_sankey_label: { nodes: [{ id: "a", label: " \n " }, node("b")], links: [link("a", "b")] },
};

describe("Sankey validator", () => {
	it("covers every issue code it can raise", () => {
		expect(new Set(Object.keys(bad))).toEqual(new Set(SankeyValidationIssueCodeSchema.literals));
	});

	it.each(Object.entries(bad))("raises %s for a minimal bad diagram", (code, change) => {
		const issues = getSankeyValidationIssues({ ...sankeyFixture, ...change });
		expect(issues.map((issue) => issue.code)).toContain(code);
	});
});

type Mutable = Record<string, unknown> & { x: number; y: number; width: number; height: number };
const at = (scene: CanvasSpec, id: string) => {
	const element = scene.elements.find((candidate) => candidate.id === id);
	if (!element) throw new Error(`No element ${id}.`);
	return element as unknown as Mutable;
};
/** A point just inside a band, beside its source bar. */
const insideBand = (scene: CanvasSpec, source: string, target: string) => {
	const band = readSankeyScene(scene).bands.find(
		(entry) => entry.source === source && entry.target === target,
	)!;
	return { x: band.sourceEnd.x + 2, y: (band.sourceEnd.top + band.sourceEnd.bottom) / 2 };
};
const centreOf = (scene: CanvasSpec, id: string) => {
	const node = at(scene, id);
	return { x: node.x + node.width / 2, y: node.y + node.height / 2 };
};

/** One deliberately broken drawing per issue the fuzz oracle reads. */
const broken: Record<SankeyLayoutIssue["code"], (scene: CanvasSpec) => void> = {
	"band-off-node": (scene) => {
		at(scene, "node:sankey:link:engineering:compute").y += 500;
	},
	"side-unbalanced": (scene) => {
		at(scene, "node:sankey:node:engineering").height += 40;
	},
	"band-leaves-gap": (scene) => {
		at(scene, "node:sankey:link:engineering:compute").x -= 30;
	},
	"band-over-node": (scene) => {
		const point = insideBand(scene, "data", "storage");
		Object.assign(at(scene, "node:sankey:node:networking"), {
			x: point.x - 1,
			y: point.y - 2,
			width: 4,
			height: 4,
		});
	},
	"labels-overlap": (scene) => {
		const other = at(scene, "text:sankey:node:storage");
		Object.assign(at(scene, "text:sankey:node:compute"), { x: other.x, y: other.y });
	},
	"label-over-node": (scene) => {
		Object.assign(
			at(scene, "text:sankey:node:compute"),
			centreOf(scene, "node:sankey:node:engineering"),
		);
	},
	"label-over-band": (scene) => {
		Object.assign(at(scene, "text:sankey:node:compute"), insideBand(scene, "data", "storage"));
	},
	"leader-over-label": (scene) => {
		const { y } = centreOf(scene, "node:sankey:node:engineering");
		scene.elements.push({
			type: "line",
			id: "leader:sankey:link:engineering:compute",
			points: [
				{ x: 0, y },
				{ x: scene.width, y },
			],
		});
	},
	"label-on-band": (scene) => {
		(scene as { elements: CanvasSpec["elements"] }).elements = scene.elements.filter(
			(element) => element.id !== "node:sankey:knockout:engineering",
		);
		Object.assign(
			at(scene, "text:sankey:node:engineering"),
			insideBand(scene, "engineering", "compute"),
		);
	},
	"text-overflow": (scene) => {
		at(scene, "text:sankey:node:compute").maxWidth = 1;
	},
};

describe("Sankey layout readout", () => {
	it("reads the fixture as clean", () => {
		expect(sankeyLayoutIssues(renderSankeyDiagram(sankeyFixture))).toEqual([]);
	});

	it.each(Object.entries(broken))("reports %s on a drawing broken that way", (code, breakIt) => {
		const scene = structuredClone(renderSankeyDiagram(sankeyFixture));
		breakIt(scene);
		expect(sankeyLayoutIssues(scene).map((issue) => issue.code)).toContain(code);
	});
});
