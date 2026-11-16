import { type BuildFlowchartResult } from "../../../families/flowchart/build.js";
import { FLOWCHART_MAX_NODES } from "../../../families/flowchart/document.js";
import { buildResponse, type BuildRejection } from "../../operation.js";
import { CANVAS_LIMITS, type CanvasShapeElement, CanvasSpec } from "@sketchi/drawing";
import { type ArtifactFormat } from "@sketchi/drawing/artifacts";
import { validateExcalidrawScene } from "@sketchi/drawing/excalidraw";
import { Context, Effect, Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
	CodeModeArtifactStorage,
	CodeModeArtifactStorageError,
	makeMemoryArtifactStorage,
	makeObjectBucketArtifactStorage,
	type CodeModeArtifactStorageShape,
	type CodeModeObjectBucket,
	type CodeModeObjectBucketObject,
} from "../artifacts";
import {
	DIAGRAM_PATCH_OPERATION_NAMES,
	type ApplyDiagramPatchResult,
	type CreateCanvasResult,
	type DiagramPatchOperation,
	type GetArtifactResult,
} from "../contract";
import {
	applyDiagramPatch,
	buildFlowchart,
	CodeModeRuntimeEnvironment,
	createCanvas,
	editFlowchart,
	getArtifact,
	type CodeModeRuntimeOptions,
} from "../runtime";

function makeTestRuntime(
	options: CodeModeRuntimeOptions & {
		readonly store?: CodeModeArtifactStorageShape;
	} = {},
) {
	const storage = options.store ?? makeMemoryArtifactStorage();
	const environment: Context.Service.Shape<typeof CodeModeRuntimeEnvironment> = {
		createId: options.createId ?? ((prefix) => `${prefix}-test`),
		...(options.renderer ? { renderer: options.renderer } : {}),
	};
	const run = <A, E extends BuildRejection<unknown>>(
		program: Effect.Effect<A, E, CodeModeArtifactStorage | CodeModeRuntimeEnvironment>,
	) =>
		Effect.runPromise(
			buildResponse(program).pipe(
				Effect.provideService(CodeModeArtifactStorage, storage),
				Effect.provideService(CodeModeRuntimeEnvironment, environment),
			),
		);

	return {
		applyDiagramPatch: (input: unknown) => run(applyDiagramPatch(input)),
		buildFlowchart: (input: unknown) => run(buildFlowchart(input)),
		createCanvas: (input: unknown) => run(createCanvas(input)),
		editFlowchart: (input: unknown) => run(editFlowchart(input)),
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

function linearFlowchartSpec(nodeCount: number) {
	const ids = Array.from({ length: nodeCount }, (_, index) => `node-${index}`);
	return {
		title: `Linear flow with ${nodeCount} nodes`,
		nodes: Object.fromEntries(ids.map((id, index) => [id, `Concrete operation ${index}`])),
		edges: ids.slice(0, -1).map((id, index) => [id, ids[index + 1] ?? id] as [string, string]),
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

function expectBuildFailure(
	result: BuildFlowchartResult,
): asserts result is Extract<BuildFlowchartResult, { ok: false }> {
	expect(result.ok).toBe(false);
	if (result.ok) {
		throw new Error("Expected build failure.");
	}
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
	return Schema.decodeUnknownSync(CanvasSpec, {
		errors: "all",
		reportInput: true,
	})(value);
}

class MemoryBucket implements CodeModeObjectBucket {
	readonly objects = new Map<string, string | Uint8Array>();

	async get(key: string): Promise<CodeModeObjectBucketObject | null> {
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

class FailingPngBucket extends MemoryBucket {
	override async put(key: string, value: string | ArrayBuffer | Uint8Array): Promise<unknown> {
		if (key.endsWith("/png.png")) {
			throw new Error("png write failed");
		}

		return super.put(key, value);
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
		operations: () => [{ op: "rerouteEdges" }],
		check: (patched, source) =>
			expect(patched.elements.filter((e) => e.type === "arrow")).toHaveLength(
				source.elements.filter((e) => e.type === "arrow").length,
			),
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

describe("artifact storage", () => {
	it("stores a build's formats under their object keys and reads them back, PNG as bytes", async () => {
		const bucket = new MemoryBucket();
		let id = 0;
		const runtime = makeTestRuntime({
			store: makeObjectBucketArtifactStorage(bucket, { prefix: "codemode" }),
			createId: (prefix) => `${prefix}-${(id += 1)}`,
			renderer: {
				renderPng: () => Effect.succeed(new Uint8Array([137, 80, 78, 71])),
			},
		});

		const built = await runtime.buildFlowchart({
			spec: approvalSpec(),
			options: { artifactFormats: ["scene", "excalidraw", "png"] },
		});
		expectBuildOk(built);

		expect([...bucket.objects.keys()].sort()).toEqual([
			"codemode/artifact-2/document.json",
			"codemode/artifact-2/excalidraw.json",
			"codemode/artifact-2/manifest.json",
			"codemode/artifact-2/png.png",
			"codemode/artifact-2/scene.json",
		]);
		expect(bucket.objects.get("codemode/artifact-2/png.png")).toBeInstanceOf(Uint8Array);

		const scene = await runtime.getArtifact({
			artifactId: built.artifact.artifactId,
			format: "scene",
			inline: true,
		});
		expectGetOk(scene);
		expect(parseInlineScene(scene.inline).diagramId).toBe("simple-approval-flow");

		const png = await runtime.getArtifact({
			artifactId: built.artifact.artifactId,
			format: "png",
		});
		expectGetOk(png);
		expect(png).toMatchObject({ format: "png", mimeType: "image/png", sizeBytes: 4 });
		expect(png).not.toHaveProperty("inline");
	});

	it("fails the build without exposing the artifact id when a format write fails", async () => {
		const bucket = new FailingPngBucket();
		let id = 0;
		const runtime = makeTestRuntime({
			store: makeObjectBucketArtifactStorage(bucket, {
				prefix: "codemode",
			}),
			createId: (prefix) => `${prefix}-${(id += 1)}`,
			renderer: {
				renderPng: () => Effect.succeed(new Uint8Array([137, 80, 78, 71])),
			},
		});

		const built = await runtime.buildFlowchart({
			spec: approvalSpec(),
			options: { artifactFormats: ["scene", "png"] },
		});

		expectBuildFailure(built);
		expect(built.status).toBe("storage_failed");
		expect(bucket.objects.has("codemode/artifact-2/png.png")).toBe(false);
		// The manifest goes up with its formats, so it can land beside a failed
		// format; the id never reaches a caller, so no reader can resolve it.
		expect(JSON.stringify(built)).not.toContain("artifact-2");
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
});

describe("editFlowchart", () => {
	it("changes a built flowchart by id and builds the edit as a new artifact", async () => {
		const runtime = createTestRuntime();
		const built = await runtime.buildFlowchart({ spec: approvalSpec() });
		if (!built.ok) throw new Error("Expected the base to build.");
		const document = await runtime.getArtifact({
			artifactId: built.artifact.artifactId,
			format: "document",
			inline: true,
		});
		expect(document).toMatchObject({ ok: true });

		const edited = await runtime.editFlowchart({
			artifactId: built.artifact.artifactId,
			edits: [
				{ op: "insert", node: { notify: "Notify requester" }, between: ["approve", "revise"] },
				{ op: "set", nodes: { done: { color: "green" } } },
			],
		});

		expect(edited).toMatchObject({ ok: true, status: "accepted" });
		if (!edited.ok) return;
		expect(edited.artifact.artifactId).not.toBe(built.artifact.artifactId);
		expect(edited.normalizedSpec.nodes).toMatchObject({
			done: { label: "Done", color: "green" },
			notify: "Notify requester",
		});
		expect(edited.normalizedSpec.edges).toEqual([
			["request", "approve"],
			["approve", "done", "yes"],
			["approve", "notify", "no"],
			["notify", "revise"],
		]);
		const scene = edited.artifact.formats.find((format) => format.format === "scene")?.inline as {
			elements: { id: string; strokeColor?: string; fillColor?: string }[];
		};
		expect(scene.elements.find((element) => element.id === "node:done")).toMatchObject({
			strokeColor: "#16a34a",
			fillColor: "#dcfce7",
		});

		expect(edited).toMatchObject({
			artifact: { provenance: { sourceArtifactId: built.artifact.artifactId } },
			edits: [
				{ op: "insert", node: { notify: "Notify requester" }, between: ["approve", "revise"] },
				{ op: "set", nodes: { done: { color: "green" } } },
			],
		});

		// The edit is itself editable.
		const again = await runtime.editFlowchart({
			artifactId: edited.artifact.artifactId,
			edits: [{ op: "set", nodes: { done: { color: null } } }],
		});
		expect(again.ok && again.normalizedSpec.nodes["done"]).toBe("Done");
	});

	it("stores nothing when the edited flowchart does not build", async () => {
		const runtime = createTestRuntime();
		const built = await runtime.buildFlowchart({ spec: approvalSpec() });
		if (!built.ok) throw new Error("Expected the base to build.");

		const result = await runtime.editFlowchart({
			artifactId: built.artifact.artifactId,
			edits: [{ op: "disconnect", edges: [["approve", "revise"]] }],
		});

		expect(result).toMatchObject({ ok: false, status: "invalid_flowchart" });
		expect(result.ok ? undefined : result.partial?.artifactId).toBeUndefined();
	});
});

describe("limits", () => {
	it("caps schema issue amplification for every Code Mode operation", async () => {
		const result = await createTestRuntime().buildFlowchart({
			spec: {
				title: "Malformed",
				nodes: Object.fromEntries(Array.from({ length: 1_000 }, (_, index) => [`n${index}`, {}])),
				edges: [],
			},
		});
		expect(result).toMatchObject({ ok: false, status: "invalid_input" });
		expect(result.issues).toHaveLength(21);
		expect(result.issues.at(-1)?.message).toContain("additional input issues were omitted");
	});

	it("fails semantic limits before rendering or persisting artifacts", async () => {
		let renderCalls = 0;
		let writeCalls = 0;
		const store: CodeModeArtifactStorageShape = {
			read: () => Effect.succeed(null),
			readManifest: () => Effect.succeed(null),
			write: () => {
				writeCalls += 1;
				return Effect.fail(
					new CodeModeArtifactStorageError({
						cause: new Error("invalid flowchart must not persist"),
						message: "invalid flowchart must not persist",
						operation: "write",
					}),
				);
			},
		};
		const runtime = makeTestRuntime({
			store,
			renderer: {
				renderPng: () =>
					Effect.sync(() => {
						renderCalls += 1;
						return new Uint8Array([137, 80, 78, 71]);
					}),
			},
		});
		const result = await runtime.buildFlowchart({
			spec: linearFlowchartSpec(FLOWCHART_MAX_NODES + 1),
			options: { artifactFormats: ["png"] },
		});

		expectBuildFailure(result);
		expect(result.status).toBe("limit_exceeded");
		expect(renderCalls).toBe(0);
		expect(writeCalls).toBe(0);
	});

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
			let nested: unknown = new Date(0);
			for (let depth = 0; depth < 10_000; depth += 1) nested = [nested];
			const scene = {
				...geometryCanvas([geometryNode("a", 0, 0)]),
				ignored: nested,
			};
			const memory = makeMemoryArtifactStorage();
			let writes = 0;
			const store: CodeModeArtifactStorageShape = {
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
