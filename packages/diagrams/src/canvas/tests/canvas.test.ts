import { type BuildFlowchartResult } from "../../families/flowchart/build";
import { buildResponse, type BuildRejection } from "../../build/operation";
import { CANVAS_LIMITS, type CanvasShapeElement, CanvasSpec } from "@sketchi/drawing";
import { type ArtifactFormat } from "@sketchi/drawing/artifacts";
import { validateExcalidrawScene } from "@sketchi/drawing/excalidraw";
import { Context, Effect, Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
	ArtifactStorage,
	makeMemoryArtifactStorage,
	makeObjectBucketArtifactStorage,
	type ArtifactStorageShape,
	type ArtifactObjectBucket,
	type ArtifactObjectBucketObject,
} from "../../build/artifacts";
import { buildFlowchart } from "../../build/builds";
import { BuildRuntimeEnvironment, type BuildRuntimeOptions } from "../../build/runtime";
import { getArtifact } from "../artifact";
import { type GetArtifactResult } from "../artifact-contract";
import { createCanvas } from "../create";
import { type CreateCanvasResult } from "../create-contract";
import { applyDiagramPatch } from "../patch";
import {
	DIAGRAM_PATCH_OPERATION_NAMES,
	type ApplyDiagramPatchResult,
	type DiagramPatchOperation,
} from "../patch-contract";

function makeTestRuntime(
	options: BuildRuntimeOptions & {
		readonly store?: ArtifactStorageShape;
	} = {},
) {
	const storage = options.store ?? makeMemoryArtifactStorage();
	const environment: Context.Service.Shape<typeof BuildRuntimeEnvironment> = {
		createId: options.createId ?? ((prefix) => `${prefix}-test`),
		...(options.renderer ? { renderer: options.renderer } : {}),
	};
	const run = <A, E extends BuildRejection<unknown>>(
		program: Effect.Effect<A, E, ArtifactStorage | BuildRuntimeEnvironment>,
	) =>
		Effect.runPromise(
			buildResponse(program).pipe(
				Effect.provideService(ArtifactStorage, storage),
				Effect.provideService(BuildRuntimeEnvironment, environment),
			),
		);

	return {
		applyDiagramPatch: (input: unknown) => run(applyDiagramPatch(input)),
		buildFlowchart: (input: unknown) => run(buildFlowchart(input)),
		createCanvas: (input: unknown) => run(createCanvas(input)),
		getArtifact: (input: unknown) => run(getArtifact(input)),
	};
}

function createTestRuntime() {
	let id = 0;
	return makeTestRuntime({
		store: makeMemoryArtifactStorage(),
		createId: (prefix) => `${prefix}-${(id += 1)}`,
	});
}

/**
 * The approval flowchart's drawing stored as a canvas. A flowchart is never patched, so the patch
 * engine's tests run on the same graph through a canvas artifact.
 */
async function approvalCanvas(
	runtime: ReturnType<typeof createTestRuntime>,
	inlineArtifacts: ("scene" | "excalidraw")[] = [],
) {
	const built = await runtime.buildFlowchart({
		spec: approvalSpec(),
		options: { inlineArtifacts: ["scene"] },
	});
	if (!built.ok) throw new Error("Expected the approval flowchart to build.");
	const scene = built.artifact.formats.find((format) => format.format === "scene")?.inline;
	return runtime.createCanvas({ spec: scene, options: { inlineArtifacts } });
}

function approvalSpec() {
	return {
		title: "Simple approval flow",
		direction: "TB",
		nodes: {
			request: "Request arrives",
			approve: "Approved?",
			done: "Done",
			revise: "Revise",
		},
		edges: [
			["request", "approve"],
			["approve", "done", "yes"],
			["approve", "revise", "no"],
		],
	};
}

function geometryCanvas(elements: CanvasSpec["elements"] = []): CanvasSpec {
	return {
		kind: "canvas",
		version: 1,
		diagramId: "geometry",
		title: "Geometry",
		width: 600,
		height: 600,
		accentColor: "#111827",
		backgroundColor: "#ffffff",
		layers: [],
		layouts: [],
		elements,
		zOrder: elements.map(({ id }) => id),
	};
}

function geometryNode(id: string, x: number, y: number): CanvasShapeElement {
	return {
		type: "node",
		id,
		nodeId: id,
		shape: "rectangle",
		x,
		y,
		width: 100,
		height: 60,
		label: id,
	};
}

function expectBuildOk(
	result: BuildFlowchartResult,
): asserts result is Extract<BuildFlowchartResult, { ok: true }> {
	if (!result.ok) {
		throw new Error(`Expected build success: ${JSON.stringify(result.issues)}`);
	}
	expect(result.ok).toBe(true);
}

function expectCanvasOk(
	result: CreateCanvasResult,
): asserts result is Extract<CreateCanvasResult, { ok: true }> {
	if (!result.ok) {
		throw new Error(`Expected canvas success: ${JSON.stringify(result.issues)}`);
	}
	expect(result.ok).toBe(true);
}

function expectGetOk(
	result: GetArtifactResult,
): asserts result is Extract<GetArtifactResult, { ok: true }> {
	expect(result.ok).toBe(true);
	if (!result.ok) {
		throw new Error(`Expected get success: ${JSON.stringify(result.issues)}`);
	}
}

function expectPatchOk(
	result: ApplyDiagramPatchResult,
): asserts result is Extract<ApplyDiagramPatchResult, { ok: true }> {
	if (!result.ok) {
		throw new Error(`Expected patch success: ${JSON.stringify(result.issues)}`);
	}
	expect(result.ok).toBe(true);
}

function expectPatchFailure(
	result: ApplyDiagramPatchResult,
): asserts result is Extract<ApplyDiagramPatchResult, { ok: false }> {
	expect(result.ok).toBe(false);
	if (result.ok) {
		throw new Error("Expected patch failure.");
	}
}

function parseInlineScene(value: unknown) {
	// @effect-diagnostics-next-line schemaSync:off -- Decode an authored fixture synchronously so invalid test input fails at setup.
	return Schema.decodeUnknownSync(CanvasSpec, {
		errors: "all",
		reportInput: true,
	})(value);
}

class MemoryBucket implements ArtifactObjectBucket {
	readonly objects = new Map<string, string | Uint8Array>();

	async get(key: string): Promise<ArtifactObjectBucketObject | null> {
		const value = this.objects.get(key);
		if (!value) {
			return null;
		}
		const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
		return {
			size: bytes.byteLength,
			arrayBuffer: async () => toArrayBuffer(bytes),
			text: async () => (typeof value === "string" ? value : new TextDecoder().decode(value)),
		};
	}

	async put(key: string, value: string | ArrayBuffer | Uint8Array): Promise<unknown> {
		this.objects.set(key, typeof value === "string" ? value : new Uint8Array(value));
		return null;
	}
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
	const buffer = new ArrayBuffer(bytes.byteLength);
	new Uint8Array(buffer).set(bytes);
	return buffer;
}

type InlineScene = ReturnType<typeof parseInlineScene>;
function element(scene: InlineScene, id: string): Record<string, unknown> {
	const found: Record<string, unknown> | undefined = scene.elements.find(
		(candidate) => candidate.id === id,
	);
	if (!found) throw new Error(`Expected element ${id}.`);
	return found;
}

function approveToDone(scene: InlineScene) {
	const arrow = scene.elements.find(
		(candidate) =>
			candidate.type === "arrow" &&
			candidate.sourceNodeId === "approve" &&
			candidate.targetNodeId === "done",
	);
	if (arrow?.type !== "arrow") throw new Error("Expected an approve → done arrow.");
	return arrow;
}

/** Whether a point lies on the border of a node's box. */
function onEdge(point: { x: number; y: number }, node: Record<string, unknown>) {
	const [x, y, width, height] = [node["x"], node["y"], node["width"], node["height"]].map(
		Number,
	) as [number, number, number, number];
	const within = (value: number, from: number, to: number) => value >= from - 1 && value <= to + 1;
	const near = (value: number, edge: number) => Math.abs(value - edge) <= 1;
	return (
		within(point.x, x, x + width) &&
		within(point.y, y, y + height) &&
		(near(point.x, x) || near(point.x, x + width) || near(point.y, y) || near(point.y, y + height))
	);
}

/** One row per patch operation: the operations to send and what the patched scene must show. */
const patchCases: Record<
	(typeof DIAGRAM_PATCH_OPERATION_NAMES)[number],
	{
		operations: (scene: InlineScene) => DiagramPatchOperation[];
		check: (patched: InlineScene, source: InlineScene) => void;
	}
> = {
	setDefaultStyle: {
		operations: () => [{ op: "setDefaultStyle", style: { strokeColor: "#123456" } }],
		check: (patched) =>
			expect(patched.elements.some((e) => "strokeColor" in e && e.strokeColor === "#123456")).toBe(
				true,
			),
	},
	setStyle: {
		operations: () => [
			{ op: "setStyle", selector: { nodeIds: ["done"] }, style: { strokeColor: "#16a34a" } },
		],
		check: (patched) => expect(element(patched, "node:done")["strokeColor"]).toBe("#16a34a"),
	},
	setShape: {
		operations: () => [{ op: "setShape", selector: { nodeIds: ["approve"] }, shape: "ellipse" }],
		check: (patched) => expect(element(patched, "node:approve")["shape"]).toBe("ellipse"),
	},
	translate: {
		operations: () => [{ op: "translate", selector: { nodeIds: ["done"] }, dx: 40, dy: 0 }],
		check: (patched, source) =>
			expect(element(patched, "node:done")["x"]).toBe(
				Number(element(source, "node:done")["x"]) + 40,
			),
	},
	replaceText: {
		operations: () => [{ op: "replaceText", selector: { nodeIds: ["done"] }, text: "Shipped" }],
		check: (patched) => expect(element(patched, "node:done")["label"]).toBe("Shipped"),
	},
	rerouteEdges: {
		// Bend the approve → done arrow off its nodes, then reroute: it must leave and reach their edges.
		operations: (scene) => [
			{
				op: "replace",
				id: approveToDone(scene).id,
				element: {
					...approveToDone(scene),
					points: [
						{ x: 0, y: 0 },
						{ x: 5, y: 5 },
					],
				} as never,
			},
			{ op: "rerouteEdges" },
		],
		check: (patched) => {
			const arrow = approveToDone(patched);
			const start = arrow.points[0];
			const end = arrow.points.at(-1);
			expect(start && onEdge(start, element(patched, "node:approve"))).toBe(true);
			expect(end && onEdge(end, element(patched, "node:done"))).toBe(true);
		},
	},
	insert: {
		operations: () => [{ op: "insert", elements: [geometryNode("extra", 400, 400)] }],
		check: (patched) => expect(element(patched, "extra")["label"]).toBe("extra"),
	},
	remove: {
		operations: () => [{ op: "remove", selector: { nodeIds: ["revise"] } }],
		check: (patched) =>
			expect(patched.elements.some((e) => "nodeId" in e && e.nodeId === "revise")).toBe(false),
	},
	replace: {
		operations: (scene) => [
			{
				op: "replace",
				id: "node:done",
				element: { ...element(scene, "node:done"), label: "Finished" } as never,
			},
		],
		check: (patched) => expect(element(patched, "node:done")["label"]).toBe("Finished"),
	},
	reorder: {
		operations: (scene) => [
			{ op: "reorder", ids: ["node:done"], beforeId: scene.zOrder[0] ?? "node:request" },
		],
		check: (patched) => expect(patched.zOrder[0]).toBe("node:done"),
	},
	group: {
		operations: () => [{ op: "group", ids: ["node:done", "node:revise"], groupId: "outcomes" }],
		check: (patched) => {
			expect(element(patched, "node:done")["groupIds"]).toContain("outcomes");
			expect(element(patched, "node:revise")["groupIds"]).toContain("outcomes");
		},
	},
	ungroup: {
		operations: () => [
			{ op: "group", ids: ["node:done", "node:revise"], groupId: "outcomes" },
			{ op: "ungroup", ids: ["node:done"], groupId: "outcomes" },
		],
		check: (patched) => {
			expect(element(patched, "node:done")["groupIds"] ?? []).not.toContain("outcomes");
			expect(element(patched, "node:revise")["groupIds"]).toContain("outcomes");
		},
	},
};

describe("patches", () => {
	it.each(DIAGRAM_PATCH_OPERATION_NAMES)("applies %s to a stored canvas", async (name) => {
		const runtime = createTestRuntime();
		const built = await approvalCanvas(runtime, ["scene"]);
		expectCanvasOk(built);
		const source = parseInlineScene(
			built.artifact.formats.find((format) => format.format === "scene")?.inline,
		);
		const row = patchCases[name];

		const patched = await runtime.applyDiagramPatch({
			source: { artifactId: built.artifact.artifactId },
			operations: row.operations(source),
			options: {
				preserveConnectivity: false,
				artifactFormats: ["scene", "excalidraw"],
				inlineArtifacts: ["scene", "excalidraw"],
			},
		});

		expectPatchOk(patched);
		const scene = parseInlineScene(
			patched.artifact.formats.find((format) => format.format === "scene")?.inline,
		);
		row.check(scene, source);
		const excalidraw = patched.artifact.formats.find((format) => format.format === "excalidraw")
			?.inline as Parameters<typeof validateExcalidrawScene>[0];
		expect(validateExcalidrawScene(excalidraw).issues).toEqual([]);
	});

	it("keeps patch provenance consistent across the result and later format retrieval", async () => {
		let id = 0;
		const runtime = makeTestRuntime({
			store: makeMemoryArtifactStorage(),
			createId: (prefix) => `${prefix}-${(id += 1)}`,
			renderer: {
				renderPng: () => Effect.succeed(new Uint8Array([137, 80, 78, 71])),
			},
		});
		const built = await approvalCanvas(runtime);
		expectCanvasOk(built);

		expect(built.artifact).not.toHaveProperty("provenance");
		const rootScene = await runtime.getArtifact({
			artifactId: built.artifact.artifactId,
			format: "scene",
			inline: true,
		});
		expectGetOk(rootScene);
		expect(rootScene).not.toHaveProperty("provenance");

		const patched = await runtime.applyDiagramPatch({
			source: { artifactId: built.artifact.artifactId },
			operations: [
				{
					op: "setShape",
					selector: { nodeIds: ["approve"] },
					shape: "diamond",
				},
			],
			options: {
				artifactFormats: ["scene", "excalidraw", "png"],
				inlineArtifacts: ["scene"],
			},
		});
		expectPatchOk(patched);

		const provenance = {
			sourceArtifactId: built.artifact.artifactId,
		};
		expect(patched.sourceArtifactId).toBe(provenance.sourceArtifactId);
		expect(patched.artifact.provenance).toEqual(provenance);
		if (!patched.artifact.provenance) {
			throw new Error("Expected the patched artifact to include provenance.");
		}
		patched.artifact.provenance.sourceArtifactId = "artifact-mutated";

		const formats: ArtifactFormat[] = ["scene", "excalidraw", "png"];
		for (const format of formats) {
			const retrieved = await runtime.getArtifact({
				artifactId: patched.artifact.artifactId,
				format,
			});
			expectGetOk(retrieved);
			expect(retrieved.provenance).toEqual(provenance);
		}
	});

	it("refuses to patch a flowchart, which changes by edits", async () => {
		const runtime = createTestRuntime();
		const built = await runtime.buildFlowchart({ spec: approvalSpec() });
		if (!built.ok) throw new Error("Expected the base to build.");

		const patched = await runtime.applyDiagramPatch({
			source: { artifactId: built.artifact.artifactId },
			operations: [
				{ op: "setStyle", selector: { nodeIds: ["done"] }, style: { strokeColor: "#16a34a" } },
			],
		});

		expect(patched).toMatchObject({
			ok: false,
			status: "unsupported_operation",
			issues: [
				expect.objectContaining({
					code: "unsupported_patch_operation",
					hint: expect.stringContaining("sketchi.editFlowchart"),
				}),
			],
		});
	});

	it("rejects an object-store scene whose source manifest was not published", async () => {
		const sourceRuntime = createTestRuntime();
		const built = await sourceRuntime.buildFlowchart({
			spec: approvalSpec(),
			options: { inlineArtifacts: ["scene"] },
		});
		expectBuildOk(built);
		const sourceScene = parseInlineScene(
			built.artifact.formats.find((format) => format.format === "scene")?.inline,
		);

		const bucket = new MemoryBucket();
		await bucket.put("codemode/artifact-partial/scene.json", JSON.stringify(sourceScene));
		let id = 0;
		const runtime = makeTestRuntime({
			store: makeObjectBucketArtifactStorage(bucket, { prefix: "codemode" }),
			createId: (prefix) => `${prefix}-${(id += 1)}`,
		});

		const patched = await runtime.applyDiagramPatch({
			source: { artifactId: "artifact-partial" },
			operations: [{ op: "rerouteEdges" }],
		});

		expectPatchFailure(patched);
		expect(patched.status).toBe("source_unavailable");
		expect(patched.issues).toContainEqual(
			expect.objectContaining({
				code: "patch_source_unavailable",
				message: expect.stringContaining("valid source manifest"),
			}),
		);
		expect([...bucket.objects.keys()]).toEqual(["codemode/artifact-partial/scene.json"]);
	});
});

describe("limits", () => {
	it("counts raw unknown fields and UTF-8 bytes before schema decoding", async () => {
		const scene = {
			...geometryCanvas([geometryNode("a", 0, 0)]),
			ignored: "💡".repeat(CANVAS_LIMITS.maxSerializedBytes / 4),
		};
		expect(await createTestRuntime().createCanvas({ spec: scene })).toMatchObject({
			ok: false,
			status: "limit_exceeded",
		});
		expect(
			await createTestRuntime().applyDiagramPatch({
				source: { scene },
				operations: [{ op: "setDefaultStyle", style: {} }],
			}),
		).toMatchObject({
			ok: false,
			status: "invalid_input",
			issues: [expect.objectContaining({ code: "canvas_limit_exceeded" })],
		});
	});

	it.each(["createCanvas", "applyDiagramPatch"])(
		"returns a typed rejection for deeply nested unknown fields in %s",
		async (operation) => {
			// A Date leaf selects the recursive serializer even with Node's fast path.
			// @effect-diagnostics-next-line globalDate:off -- The boundary fixture constructs explicit timestamps or measures elapsed time against the native host.
			let nested: unknown = new Date(0);
			for (let depth = 0; depth < 10_000; depth += 1) nested = [nested];
			const scene = {
				...geometryCanvas([geometryNode("a", 0, 0)]),
				ignored: nested,
			};
			const memory = makeMemoryArtifactStorage();
			let writes = 0;
			const store: ArtifactStorageShape = {
				...memory,
				write(input) {
					writes += 1;
					return memory.write(input);
				},
			};
			const runtime = makeTestRuntime({ store });
			const result =
				operation === "createCanvas"
					? await runtime.createCanvas({
							requestId: "deep-canvas-request",
							spec: scene,
						})
					: await runtime.applyDiagramPatch({
							source: { scene },
							operations: [{ op: "setDefaultStyle", style: {} }],
						});
			expect(result).toMatchObject({
				ok: false,
				status: "invalid_input",
				issues: [
					expect.objectContaining({
						code: "invalid_type",
						stage: "input",
						ref: {
							kind: "request",
							path: operation === "createCanvas" ? "spec" : "source.scene",
						},
					}),
				],
			});
			if (operation === "createCanvas") {
				expect(result).toMatchObject({
					buildId: "build-test",
					requestId: "deep-canvas-request",
				});
			}
			expect(writes).toBe(0);
		},
	);

	it("keeps every accepted canvas within a share link's Excalidraw elements", async () => {
		const cylinders = (count: number) =>
			geometryCanvas(
				Array.from({ length: count }, (_, index) => ({
					...geometryNode(`db-${index}`, (index % 50) * 140, Math.floor(index / 50) * 120),
					shape: "cylinder" as const,
					width: 120,
					height: 100,
					label: "DB",
				})),
			);
		const one = await createTestRuntime().createCanvas({
			spec: cylinders(1),
			options: { artifactFormats: ["excalidraw"], inlineArtifacts: ["excalidraw"] },
		});
		expectCanvasOk(one);
		const inline = one.artifact.formats[0]?.inline as { readonly elements: readonly unknown[] };
		// A labelled cylinder composes several Excalidraw elements.
		const perCylinder = inline.elements.length;
		expect(perCylinder).toBeGreaterThan(2);
		const count = Math.floor(CANVAS_LIMITS.maxExportedElements / perCylinder) + 1;
		expect(count).toBeLessThanOrEqual(CANVAS_LIMITS.maxElements);

		const result = await createTestRuntime().createCanvas({
			spec: cylinders(count),
			options: { artifactFormats: ["scene"] },
		});
		expect(result).toMatchObject({
			ok: false,
			status: "limit_exceeded",
			issues: [
				expect.objectContaining({
					code: "canvas_limit_exceeded",
					message: `Canvas exports ${count * perCylinder} Excalidraw elements, more than the ${CANVAS_LIMITS.maxExportedElements} a share link holds.`,
				}),
			],
		});
	}, 60_000);

	it("returns limit_exceeded when a patch grows a scene past the element limit", async () => {
		const result = await createTestRuntime().applyDiagramPatch({
			source: { scene: geometryCanvas([geometryNode("a", 0, 0)]) },
			operations: [
				{
					op: "insert",
					elements: Array.from({ length: CANVAS_LIMITS.maxElements }, (_, index) => ({
						type: "frame",
						id: `frame-${index}`,
						x: 0,
						y: 0,
						width: 10,
						height: 10,
					})),
				},
			],
			options: { preserveConnectivity: false, artifactFormats: ["scene"] },
		});
		expect(result).toMatchObject({
			ok: false,
			status: "limit_exceeded",
			issues: [
				expect.objectContaining({
					code: "canvas_limit_exceeded",
					message: `Canvas has ${CANVAS_LIMITS.maxElements + 1} elements, more than the ${CANVAS_LIMITS.maxElements} it may hold.`,
				}),
			],
		});
	});
});
