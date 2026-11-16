// Positive fixtures deliberately unwrap Results: failure here is invalid test/story data, not user input.
import { Effect, Result } from "effect";
import * as drawing from "@sketchi/drawing";
import {
	type CanvasConnectorElement as ArrowSceneElement,
	type CanvasShapeElement as NodeSceneElement,
	type CanvasPoint as ScenePoint,
	type CanvasSpec,
} from "@sketchi/drawing";
import { validateExcalidrawScene } from "@sketchi/drawing/excalidraw";
import { describe, expect, it, vi } from "vitest";

import { CodeModeArtifactStorage, makeMemoryArtifactStorage } from "../../../build/artifacts.js";
import { buildMindmap } from "../../../build/builds.js";
import { CodeModeRuntimeEnvironment } from "../../../build/runtime.js";
import { buildResponse } from "../../../build/operation.js";
import {
	type MindmapInputError,
	type MindmapTopic,
	mindmapLayoutIssues,
	parseMindmap,
	renderMindmap,
} from "../index.js";
import type { MindmapLayoutIssue } from "../readout.js";

// Count the box comparisons the layout packs subtrees with, and the label wraps
// it measures with. Both are deterministic, so they bound layout work without a
// wall-clock timer. The wrappers pass every call through unchanged.
const work = vi.hoisted(() => ({ comparisons: 0, wraps: 0 }));
vi.mock("@sketchi/drawing", async (importOriginal) => {
	const core = await importOriginal<typeof drawing>();
	return {
		...core,
		clearanceBelow: (...args: Parameters<typeof core.clearanceBelow>) => {
			work.comparisons += args[0].length * args[1].length;
			return core.clearanceBelow(...args);
		},
		wrapTextToWidth: (...args: Parameters<typeof core.wrapTextToWidth>) => {
			work.wraps += 1;
			return core.wrapTextToWidth(...args);
		},
	};
});

const storage = makeMemoryArtifactStorage();
function build(spec: unknown) {
	return Effect.runPromise(
		buildMindmap({
			spec,
			options: {
				inlineArtifacts: ["scene", "excalidraw"],
				artifactFormats: ["scene", "excalidraw"],
			},
		}).pipe(
			buildResponse,
			Effect.provideService(CodeModeRuntimeEnvironment, {
				createId: (prefix) => `${prefix}_${Math.random().toString(36).slice(2)}`,
			}),
			Effect.provideService(CodeModeArtifactStorage, storage),
		),
	);
}

const topic = (label: string, children: MindmapTopic[] = []): MindmapTopic => ({
	label,
	children,
});
const leaves = (...labels: string[]) => labels.map((label) => topic(label));

describe("mindmaps", () => {
	it("build a nested outline into a valid Excalidraw file", async () => {
		const built = await build({
			title: "App launch",
			root: {
				label: "App launch",
				children: [
					{ label: "Goals", children: leaves("10k signups", "4-star rating") },
					{ label: "Features", children: leaves("Shared budgets", "Bank sync") },
					{ label: "Marketing", children: leaves("Launch video", "Press kit") },
				],
			},
		});
		if (!built.ok) throw new Error(JSON.stringify(built.issues));
		const formats = new Map(built.artifact.formats.map((format) => [format.format, format.inline]));
		const excalidraw = formats.get("excalidraw") as Parameters<typeof validateExcalidrawScene>[0];
		expect(validateExcalidrawScene(excalidraw)).toEqual({ ok: true, issues: [] });
	});

	/** As many topics as deep as they go: three main branches doubling down six levels, which folds. */
	let budget = 99;
	const bushy = (depth: number): MindmapTopic =>
		topic(
			`Level ${depth} topic with words`,
			depth === 6
				? []
				: Array.from({ length: depth === 0 ? 3 : 2 }, () =>
						budget-- > 0 ? [bushy(depth + 1)] : [],
					).flat(),
		);
	// Measured: 405 comparisons and 900 wraps for the widest map; 4,706 and 901 for the
	// deepest, which tries fold depths.
	it.each([
		[
			"widest",
			topic(
				"Company knowledge base",
				Array.from({ length: 9 }, (_, branch) =>
					topic(
						`Department number ${branch + 1}`,
						Array.from({ length: 10 }, (_, leaf) =>
							topic(`Team topic ${branch}.${leaf} with a longer description to wrap`),
						),
					),
				),
			),
			2_000,
			1_500,
		],
		["deepest", bushy(0), 20_000, 1_500],
	] as const)("bound layout work for the %s map", (id, root, comparisons, wraps) => {
		const diagram = parseMindmap({ id, title: id, root }).pipe(Result.getOrThrow);
		work.comparisons = 0;
		work.wraps = 0;
		renderMindmap(diagram);
		expect(work.comparisons).toBeGreaterThan(0);
		expect(work.comparisons).toBeLessThan(comparisons);
		expect(work.wraps).toBeLessThan(wraps);
	});
});

const deep: { label: string; children?: unknown[] } = { label: "Root" };
let current = deep;
for (let depth = 0; depth < 2000; depth++) {
	const child = { label: `Level ${depth}` };
	current.children = [child];
	current = child;
}

/** One minimal bad root per input bound; the large ones are checked before recursive decoding. */
const bad: Record<MindmapInputError["code"], unknown> = {
	disconnected_graph: { label: "Root" },
	mindmap_too_deep: deep,
	mindmap_too_large: { label: "Root", children: Array.from({ length: 100_000 }, () => null) },
};

describe("mindmap input bounds", () => {
	it.each(Object.entries(bad))("raise %s without amplifying the response", async (code, root) => {
		const result = await build({ title: "Bounds", root });
		expect(result.ok).toBe(false);
		expect(result.issues.map((issue) => issue.code)).toEqual([code]);
		expect(JSON.stringify(result).length).toBeLessThan(2000);
	});
});

const product = parseMindmap({
	id: "product",
	title: "Product",
	root: topic("App launch", [
		topic("Goals", leaves("10k signups", "4-star rating")),
		topic("Features", leaves("Shared budgets", "Bank sync", "Spending alerts")),
		topic("Design", leaves("Onboarding flow", "Dark mode")),
		topic("Engineering", leaves("Load testing", "Crash reporting")),
	]),
}).pipe(Result.getOrThrow);
const scene = renderMindmap(product);
const node = (id: string) =>
	scene.elements.find(
		(element): element is NodeSceneElement => element.type === "node" && element.nodeId === id,
	)!;
const into = (id: string) =>
	scene.elements.find(
		(element): element is ArrowSceneElement =>
			element.type === "arrow" && element.targetNodeId === id,
	)!;
const center = (shape: NodeSceneElement) => ({
	x: shape.x + shape.width / 2,
	y: shape.y + shape.height / 2,
});
/** The scene with arrows redrawn as straight lines to new ends. */
const redrawn = (changes: readonly (readonly [ArrowSceneElement, ScenePoint])[]): CanvasSpec => ({
	...scene,
	elements: scene.elements.map((element) => {
		const change = changes.find(([arrow]) => arrow === element);
		return change
			? { ...change[0], points: [change[0].points[0], change[1]], curved: false }
			: element;
	}),
});

/** One deliberately broken scene per layout issue the fuzz relies on. */
const broken: Record<MindmapLayoutIssue["kind"], () => CanvasSpec> = {
	overlap: () => ({
		...scene,
		elements: scene.elements.map((element) =>
			element.type === "node" && element.nodeId === "topic-0-1"
				? { ...element, x: node("topic-0-0").x + 4, y: node("topic-0-0").y + 4 }
				: element,
		),
	}),
	"through-node": () => redrawn([[into("topic-0-0-0"), center(node("topic-0-2-0"))]]),
	crossing: () =>
		redrawn([
			[into("topic-0-0"), into("topic-0-1").points.at(-1)!],
			[into("topic-0-1"), into("topic-0-0").points.at(-1)!],
		]),
};

describe("mindmap layout readout", () => {
	it("passes the drawn scene", () => {
		expect(mindmapLayoutIssues(scene)).toEqual([]);
	});

	it.each(Object.entries(broken))("reports %s", (kind, breakScene) => {
		expect(mindmapLayoutIssues(breakScene()).map((issue) => issue.kind)).toContain(kind);
	});
});
