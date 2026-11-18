import { type BuildFlowchartResult } from "../../families/flowchart/build";
import { FLOWCHART_MAX_NODES } from "../../families/flowchart/document";
import { getArtifact } from "../../canvas/artifact";
import { type GetArtifactResult } from "../../canvas/artifact-contract";
import { buildResponse, type BuildRejection } from "../operation";
import { CanvasSpec } from "@sketchi/drawing";
import { Context, Effect, Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
	ArtifactStorage,
	ArtifactStorageError,
	makeMemoryArtifactStorage,
	makeObjectBucketArtifactStorage,
	type ArtifactStorageShape,
	type ArtifactObjectBucket,
	type ArtifactObjectBucketObject,
} from "../artifacts";
import { buildFlowchart } from "../builds";
import { editFlowchart } from "../edit-flowchart";
import { BuildRuntimeEnvironment, type BuildRuntimeOptions } from "../runtime";

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
		buildFlowchart: (input: unknown) => run(buildFlowchart(input)),
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

function expectGetOk(
	result: GetArtifactResult,
): asserts result is Extract<GetArtifactResult, { ok: true }> {
	expect(result.ok).toBe(true);
	if (!result.ok) {
		throw new Error(`Expected get success: ${JSON.stringify(result.issues)}`);
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
			inline: true,
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
		const store: ArtifactStorageShape = {
			read: () => Effect.succeed(null),
			readManifest: () => Effect.succeed(null),
			write: () => {
				writeCalls += 1;
				return Effect.fail(
					new ArtifactStorageError({
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
});
