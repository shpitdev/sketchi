import {
	MAX_BUILD_REQUEST_BYTES as MAX_CODE_MODE_BUILD_REQUEST_BYTES,
	MAX_CANVAS_REQUEST_BYTES,
} from "@sketchi/diagrams/http-api";
import { type TelemetrySpanRow } from "@sketchi/observability";
import { describe, expect, it } from "vitest";
import { serveDiagramsApi } from "../http.server";

import {
	type ArtifactObjectBucket,
	type ArtifactObjectBucketObject,
} from "@sketchi/diagrams/build";
import { CANVAS_LIMITS } from "@sketchi/drawing";

import { type StudioEnv } from "../../../server/bindings/studio-env.server";
import { runPlaygroundEffect } from "../../../server/runtime/runtime.server";
import { USAGE_EVENT_ATTRIBUTE, USAGE_ISSUES_ATTRIBUTE } from "../usage-events.server";

function testBoundary(env: StudioEnv, request: Request) {
	return {
		env,
		request,
		platform: {
			waitUntilPromise: (promise: Promise<unknown>) => {
				void promise;
			},
		},
	};
}

/** Every route goes through the native diagrams API, as the Worker serves it. */
function serve(env: StudioEnv, request: Request) {
	return runPlaygroundEffect(serveDiagramsApi(request), testBoundary(env, request));
}

const handleBuildFlowchartRequest = serve;
const handleBuildMindmapRequest = serve;
const handleCreateCanvasRequest = serve;

function handleGetArtifactRequest(env: StudioEnv, request: Request, _artifactId: string) {
	return serve(env, request);
}

function handlePatchArtifactRequest(env: StudioEnv, request: Request, _artifactId: string) {
	return serve(env, request);
}

function approvalSpec() {
	return {
		title: "Worker API approval flow",
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

function postRequest(url: string, body: unknown): Request {
	return new Request(url, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
		},
		body: JSON.stringify(body),
	});
}

function paddedJsonBody(body: unknown, byteLength: number): string {
	const json = JSON.stringify(body);
	const encodedLength = new TextEncoder().encode(json).byteLength;
	if (encodedLength > byteLength) {
		throw new Error(`JSON body already exceeds ${byteLength} bytes.`);
	}
	return `${json}${" ".repeat(byteLength - encodedLength)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function artifactIdFrom(value: unknown): string {
	if (
		isRecord(value) &&
		isRecord(value.artifact) &&
		typeof value.artifact.artifactId === "string"
	) {
		return value.artifact.artifactId;
	}
	throw new Error("Response did not contain an artifact id.");
}

/** Collects the rows a request sends to the spans stream. */
class SpanPipeline {
	readonly rows: TelemetrySpanRow[] = [];

	async send(records: readonly unknown[]): Promise<void> {
		this.rows.push(...(records as TelemetrySpanRow[]));
	}
}

/** Each Code Mode call's usage, as its capture span recorded it. */
function usageCaptures(spans: SpanPipeline) {
	return spans.rows
		.filter((row) => row.name === "playground.codeModeUsage.capture")
		.map((row) => {
			const attributes = JSON.parse(row.attributes) as Record<string, unknown>;
			return {
				event: attributes[USAGE_EVENT_ATTRIBUTE],
				issues: attributes[USAGE_ISSUES_ATTRIBUTE],
				request: attributes["sketchi.input"],
				response: attributes["sketchi.output"],
				row,
			};
		});
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

describe("Code Mode API handlers", () => {
	it("accepts a canvas request as large as the canvas allows", async () => {
		const elements = Array.from({ length: CANVAS_LIMITS.maxElements }, (_, index) => ({
			type: "frame",
			id: `frame-${index}`,
			x: (index % 100) * 12,
			y: Math.floor(index / 100) * 12,
			width: 10,
			height: 10,
		}));
		const body = {
			spec: {
				kind: "canvas",
				version: 1,
				diagramId: "full-canvas",
				title: "Full canvas",
				width: 1_200,
				height: 600,
				accentColor: "#111827",
				backgroundColor: "#ffffff",
				elements,
				layers: [],
				layouts: [],
				zOrder: elements.map(({ id }) => id),
			},
			options: { artifactFormats: ["scene"] },
		};
		// Past the other builders' request ceiling, so only the canvas's own ceiling admits it.
		expect(JSON.stringify(body).length).toBeGreaterThan(MAX_CODE_MODE_BUILD_REQUEST_BYTES);

		const response = await handleCreateCanvasRequest(
			{},
			postRequest("https://studio.test/api/v1/canvases/create", body),
		);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toMatchObject({ ok: true, status: "accepted" });
	});

	it("rejects a canvas request past the canvas's own ceiling with a typed 413", async () => {
		const response = await handleCreateCanvasRequest(
			{},
			new Request("https://studio.test/api/v1/canvases/create", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"Content-Length": String(MAX_CANVAS_REQUEST_BYTES + 1),
				},
				body: "{}",
			}),
		);

		expect(response.status).toBe(413);
		await expect(response.json()).resolves.toMatchObject({
			status: "invalid_input",
			issues: [
				{
					code: "request_too_large",
					message: `Canvas request exceeds the ${MAX_CANVAS_REQUEST_BYTES}-byte limit.`,
				},
			],
		});
	});

	it("returns 422 instead of overflowing on a 2,000-level public mindmap", async () => {
		const root: { label: string; children?: unknown[] } = { label: "root" };
		let current = root;
		for (let depth = 0; depth < 2_000; depth += 1) {
			const child: { label: string; children?: unknown[] } = {
				label: `depth ${depth}`,
			};
			current.children = [child];
			current = child;
		}
		const response = await handleBuildMindmapRequest(
			{},
			postRequest("https://studio.test/api/v1/mindmaps/build", {
				spec: { title: "Deep", root },
			}),
		);
		expect(response.status).toBe(422);
		await expect(response.json()).resolves.toMatchObject({
			ok: false,
			status: "invalid_mindmap",
			issues: [{ code: "mindmap_too_deep" }],
		});
	});

	it("accepts a flowchart HTTP body at the 256 KiB boundary", async () => {
		const body = paddedJsonBody({ spec: approvalSpec() }, MAX_CODE_MODE_BUILD_REQUEST_BYTES);
		const response = await handleBuildFlowchartRequest(
			{},
			new Request("https://studio.test/api/v1/flowcharts/build", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body,
			}),
		);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toMatchObject({
			ok: true,
			status: "accepted",
		});
	});

	it("rejects flowchart Content-Length above 256 KiB with a typed 413", async () => {
		const spans = new SpanPipeline();
		const response = await handleBuildFlowchartRequest(
			{ SKETCHI_ARTIFACTS: new MemoryBucket(), TELEMETRY_SPANS: spans },
			new Request("https://studio.test/api/v1/flowcharts/build", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"Content-Length": String(MAX_CODE_MODE_BUILD_REQUEST_BYTES + 1),
				},
				body: JSON.stringify({ spec: approvalSpec() }),
			}),
		);

		expect(response.status).toBe(413);
		await expect(response.json()).resolves.toMatchObject({
			ok: false,
			status: "invalid_input",
			issues: [{ code: "request_too_large", stage: "input" }],
		});
		expect(usageCaptures(spans)).toMatchObject([
			{
				event: { operation: "buildFlowchart", status_code: 413 },
				request: { omitted: true, reason: "request_too_large" },
			},
		]);
	});

	it("stops and cancels an oversized chunked flowchart body", async () => {
		let cancelled = false;
		let pullCount = 0;
		const stream = new ReadableStream<Uint8Array>({
			pull(controller) {
				pullCount += 1;
				controller.enqueue(new Uint8Array(pullCount === 1 ? MAX_CODE_MODE_BUILD_REQUEST_BYTES : 2));
			},
			cancel() {
				cancelled = true;
			},
		});
		const requestInit: RequestInit & { duplex: "half" } = {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: stream,
			duplex: "half",
		};
		const request = new Request("https://studio.test/api/v1/flowcharts/build", requestInit);

		expect(request.headers.has("content-length")).toBe(false);
		const response = await handleBuildFlowchartRequest({}, request);
		expect(response.status).toBe(413);
		expect(cancelled).toBe(true);
		expect(pullCount).toBeLessThanOrEqual(3);
		await expect(response.json()).resolves.toMatchObject({
			ok: false,
			status: "invalid_input",
			issues: [{ code: "request_too_large" }],
		});
	});

	it("builds and retrieves a flowchart through Response handlers, and refuses to patch it", async () => {
		const buildResponse = await handleBuildFlowchartRequest(
			{},
			postRequest("https://studio.test/api/v1/flowcharts/build", {
				spec: approvalSpec(),
			}),
		);

		expect(buildResponse.status).toBe(200);
		expect(buildResponse.headers.get("x-sketchi-run-id")).toMatch(/^run_/);
		const built: unknown = await buildResponse.json();
		expect(built).toMatchObject({ ok: true, status: "accepted" });

		const artifactId = artifactIdFrom(built);
		expect(built).toMatchObject({
			artifact: {
				formats: expect.arrayContaining([
					expect.objectContaining({
						format: "excalidraw",
						url: `https://studio.test/api/v1/artifacts/${artifactId}?format=excalidraw&raw=true`,
					}),
					expect.objectContaining({
						format: "scene",
						url: `https://studio.test/api/v1/artifacts/${artifactId}?format=scene&raw=true`,
					}),
				]),
			},
		});
		const getResponse = await handleGetArtifactRequest(
			{},
			new Request(`https://studio.test/api/v1/artifacts/${artifactId}?format=scene`),
			artifactId,
		);

		expect(getResponse.status).toBe(200);
		const rootArtifact: unknown = await getResponse.json();
		expect(rootArtifact).toMatchObject({
			ok: true,
			artifactId,
			format: "scene",
			url: `https://studio.test/api/v1/artifacts/${artifactId}?format=scene&raw=true`,
		});
		expect(rootArtifact).not.toHaveProperty("provenance");

		const rawExcalidrawResponse = await handleGetArtifactRequest(
			{},
			new Request(`https://studio.test/api/v1/artifacts/${artifactId}?format=excalidraw&raw=true`),
			artifactId,
		);

		expect(rawExcalidrawResponse.status).toBe(200);
		expect(rawExcalidrawResponse.headers.get("content-type")).toBe(
			"application/vnd.excalidraw+json",
		);
		expect(rawExcalidrawResponse.headers.get("content-disposition")).toBe(
			`inline; filename="${artifactId}.excalidraw"`,
		);
		await expect(rawExcalidrawResponse.json()).resolves.toMatchObject({
			type: "excalidraw",
			version: 2,
			files: {},
		});

		const invalidGetResponse = await handleGetArtifactRequest(
			{},
			new Request(`https://studio.test/api/v1/artifacts/${artifactId}?format=svg`),
			artifactId,
		);

		expect(invalidGetResponse.status).toBe(400);
		await expect(invalidGetResponse.json()).resolves.toMatchObject({
			ok: false,
			status: "invalid_input",
		});

		const patchResponse = await handlePatchArtifactRequest(
			{},
			postRequest(`https://studio.test/api/v1/artifacts/${artifactId}/patch`, {
				operations: [
					{
						op: "setStyle",
						selector: { nodeIds: ["approve"] },
						style: { strokeColor: "#7c3aed", fillColor: "#ede9fe" },
					},
				],
			}),
			artifactId,
		);

		// A flowchart changes by edits; its drawing is never patched.
		expect(patchResponse.status).toBe(422);
		await expect(patchResponse.json()).resolves.toMatchObject({
			ok: false,
			status: "unsupported_operation",
			issues: [{ code: "unsupported_patch_operation" }],
		});
	});

	it("uses the R2-compatible artifact binding when one is configured", async () => {
		const bucket = new MemoryBucket();
		const spans = new SpanPipeline();
		const env = { SKETCHI_ARTIFACTS: bucket, TELEMETRY_SPANS: spans };
		const buildResponse = await handleBuildFlowchartRequest(
			env,
			postRequest("https://studio.test/api/v1/flowcharts/build", {
				spec: approvalSpec(),
			}),
		);

		expect(buildResponse.status).toBe(200);
		const built: unknown = await buildResponse.json();
		const artifactId = artifactIdFrom(built);

		expect(
			[...bucket.objects.keys()].filter((key) => key.startsWith(`codemode/${artifactId}/`)).sort(),
		).toEqual([
			`codemode/${artifactId}/document.json`,
			`codemode/${artifactId}/excalidraw.json`,
			`codemode/${artifactId}/manifest.json`,
			`codemode/${artifactId}/scene.json`,
		]);
		const excalidrawObject = await bucket.get(`codemode/${artifactId}/excalidraw.json`);
		const excalidrawJson = JSON.parse((await excalidrawObject?.text()) ?? "{}");
		expect(excalidrawJson).toMatchObject({
			type: "excalidraw",
			version: 2,
			source: "https://sketchi.app",
			files: {},
			elements: expect.any(Array),
			appState: expect.any(Object),
		});

		const getResponse = await handleGetArtifactRequest(
			env,
			new Request(`https://studio.test/api/v1/artifacts/${artifactId}?format=scene`),
			artifactId,
		);

		expect(getResponse.status).toBe(200);
		await expect(getResponse.json()).resolves.toMatchObject({
			ok: true,
			artifactId,
			format: "scene",
		});

		// The build, the get and the patch above each record one usage capture.
		const [build] = usageCaptures(spans);
		expect(build).toMatchObject({
			event: {
				artifacts: [{ artifactId, diagramId: "worker-api-approval-flow" }],
				operation: "buildFlowchart",
				request_method: "POST",
				request_path: "/api/v1/flowcharts/build",
				status: "ok",
				status_code: 200,
				surface: "api",
			},
			request: { spec: { title: "Worker API approval flow" } },
			response: { ok: true, status: "accepted" },
		});
		expect([...bucket.objects.keys()].filter((key) => key.startsWith("codemode/usage/"))).toEqual(
			[],
		);
	});

	it("wraps legacy raw Excalidraw scene artifacts in an importable file envelope", async () => {
		const bucket = new MemoryBucket();
		const artifactId = "artifact-legacy-excalidraw";
		bucket.objects.set(
			`codemode/${artifactId}/manifest.json`,
			JSON.stringify({
				artifactId,
				diagramId: "diagram-legacy-excalidraw",
				formats: [
					{
						format: "excalidraw",
						mimeType: "application/vnd.excalidraw+json",
						sizeBytes: 142,
					},
				],
				createdAt: new Date().toISOString(),
			}),
		);
		bucket.objects.set(
			`codemode/${artifactId}/excalidraw.json`,
			JSON.stringify({
				appState: { viewBackgroundColor: "#ffffff" },
				elements: [
					{
						id: "node:start",
						type: "rectangle",
					},
				],
			}),
		);

		const getResponse = await handleGetArtifactRequest(
			{ SKETCHI_ARTIFACTS: bucket },
			new Request(`https://studio.test/api/v1/artifacts/${artifactId}?format=excalidraw&raw=true`),
			artifactId,
		);

		expect(getResponse.status).toBe(200);
		expect(getResponse.headers.get("content-type")).toBe("application/vnd.excalidraw+json");
		await expect(getResponse.json()).resolves.toMatchObject({
			appState: { viewBackgroundColor: "#ffffff" },
			elements: [{ id: "node:start", type: "rectangle" }],
			files: {},
			source: "https://sketchi.app",
			type: "excalidraw",
			version: 2,
		});
	});

	it("returns raw PNG bytes from the R2-compatible artifact binding", async () => {
		const bucket = new MemoryBucket();
		const artifactId = "artifact-png";
		bucket.objects.set(
			`codemode/${artifactId}/manifest.json`,
			JSON.stringify({
				artifactId,
				diagramId: "diagram-png",
				formats: [
					{
						format: "png",
						mimeType: "image/png",
						sizeBytes: 4,
					},
				],
				createdAt: new Date().toISOString(),
			}),
		);
		bucket.objects.set(`codemode/${artifactId}/png.png`, new Uint8Array([137, 80, 78, 71]));

		const getResponse = await handleGetArtifactRequest(
			{ SKETCHI_ARTIFACTS: bucket },
			new Request(`https://studio.test/api/v1/artifacts/${artifactId}?format=png&raw=true`),
			artifactId,
		);

		expect(getResponse.status).toBe(200);
		expect(getResponse.headers.get("content-type")).toBe("image/png");
		expect(new Uint8Array(await getResponse.arrayBuffer())).toEqual(
			new Uint8Array([137, 80, 78, 71]),
		);
	});
});

describe("artifact patch request boundaries", () => {
	it("caps patch bodies like canvas bodies, since a patch may carry its scene inline", async () => {
		const request = new Request("https://studio.test/api/v1/artifacts/id/patch", {
			method: "POST",
			body: JSON.stringify({
				operations: [],
				padding: "x".repeat(MAX_CANVAS_REQUEST_BYTES),
			}),
		});
		const response = await handlePatchArtifactRequest({}, request, "id");
		expect(response.status).toBe(413);
		expect(await response.json()).toMatchObject({
			issues: [
				{
					code: "request_too_large",
					message: `Artifact patch request exceeds the ${MAX_CANVAS_REQUEST_BYTES}-byte limit.`,
				},
			],
		});
	});
});
