import type { TelemetrySpanRow } from "@sketchi/observability";
import { describe, expect, it, vi } from "vitest";
import { Effect } from "effect";

import {
	type BuildFlowchartResult,
	CANVAS_LIMITS,
	type CodeModeObjectBucket,
	type CodeModeObjectBucketObject,
} from "@sketchi/diagram-agent";

import {
	MAX_CANVAS_REQUEST_BYTES,
	MAX_CODE_MODE_BUILD_REQUEST_BYTES,
	handleBuildFlowchartRequest as handleBuildFlowchartRequestEffect,
	handleBuildMindmapRequest as handleBuildMindmapRequestEffect,
	handleBuildSequenceDiagramRequest as handleBuildSequenceDiagramRequestEffect,
	handleCreateCanvasRequest as handleCreateCanvasRequestEffect,
	handleGetArtifactRequest as handleGetArtifactRequestEffect,
	handlePatchArtifactRequest as handlePatchArtifactRequestEffect,
} from "./api.server";
import { PlaygroundCodeMode } from "./service.server";
import type { StudioEnv } from "../bindings/studio-env.server";
import { USAGE_EVENT_ATTRIBUTE, USAGE_ISSUES_ATTRIBUTE } from "./usage-events.server";
import { runPlaygroundEffect } from "../runtime/runtime.server";

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

function handleBuildFlowchartRequest(env: StudioEnv, request: Request) {
	return runPlaygroundEffect(
		handleBuildFlowchartRequestEffect(request),
		testBoundary(env, request),
	);
}

function handleBuildMindmapRequest(env: StudioEnv, request: Request) {
	return runPlaygroundEffect(handleBuildMindmapRequestEffect(request), testBoundary(env, request));
}

function handleBuildSequenceDiagramRequest(env: StudioEnv, request: Request) {
	return runPlaygroundEffect(
		handleBuildSequenceDiagramRequestEffect(request),
		testBoundary(env, request),
	);
}

function handleCreateCanvasRequest(env: StudioEnv, request: Request) {
	return runPlaygroundEffect(handleCreateCanvasRequestEffect(request), testBoundary(env, request));
}

function handleGetArtifactRequest(env: StudioEnv, request: Request, artifactId: string) {
	return runPlaygroundEffect(
		handleGetArtifactRequestEffect(request, artifactId),
		testBoundary(env, request),
	);
}

function handlePatchArtifactRequest(env: StudioEnv, request: Request, artifactId: string) {
	return runPlaygroundEffect(
		handlePatchArtifactRequestEffect(request, artifactId),
		testBoundary(env, request),
	);
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

function sequenceSpec() {
	return {
		title: "Worker API sequence",
		participants: [
			{ id: "client", label: "Client" },
			{ id: "api", label: "API" },
			{ id: "store", label: "Store" },
		],
		messages: [
			{ source: "client", target: "api", label: "Request" },
			{ source: "api", target: "store", label: "Read" },
			{ source: "store", target: "client", label: "Response" },
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

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
	const buffer = new ArrayBuffer(bytes.byteLength);
	new Uint8Array(buffer).set(bytes);
	return buffer;
}

describe("Code Mode API handlers", () => {
	it("creates a CanvasSpec through the normal Worker route", async () => {
		const response = await handleCreateCanvasRequest(
			{},
			postRequest("https://studio.test/api/v1/canvases/create", {
				requestId: "canvas-http",
				spec: {
					kind: "canvas",
					version: 1,
					diagramId: "http-canvas",
					title: "HTTP canvas",
					width: 480,
					height: 320,
					accentColor: "#111827",
					backgroundColor: "#ffffff",
					elements: [
						{
							type: "node",
							id: "card",
							nodeId: "card",
							shape: "rectangle",
							x: 40,
							y: 40,
							width: 240,
							height: 120,
							label: "Canvas",
						},
					],
					layers: [],
					layouts: [],
					zOrder: ["card"],
				},
				options: {
					artifactFormats: ["scene", "excalidraw"],
					inlineArtifacts: ["scene"],
				},
			}),
		);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toMatchObject({
			ok: true,
			status: "accepted",
			requestId: "canvas-http",
			normalizedSpec: { kind: "canvas", version: 1 },
			artifact: {
				diagramId: "http-canvas",
				formats: [{ format: "scene" }, { format: "excalidraw" }],
			},
		});
	});

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

	it("returns typed HTTP 422 for an empty CanvasSpec", async () => {
		const response = await handleCreateCanvasRequest(
			{},
			postRequest("https://studio.test/api/v1/canvases/create", {
				spec: {
					kind: "canvas",
					version: 1,
					diagramId: "empty-http-canvas",
					title: "Empty HTTP canvas",
					width: 480,
					height: 320,
					accentColor: "#111827",
					backgroundColor: "#ffffff",
					elements: [],
					layers: [],
					layouts: [],
					zOrder: [],
				},
			}),
		);

		expect(response.status).toBe(422);
		await expect(response.json()).resolves.toMatchObject({
			ok: false,
			status: "invalid_canvas",
			issues: [
				expect.objectContaining({
					code: "invalid_canvas_geometry",
					stage: "canvas",
				}),
			],
		});
	});

	it("builds a public sequence diagram through the no-auth HTTP handler", async () => {
		const response = await handleBuildSequenceDiagramRequest(
			{},
			postRequest("https://studio.test/api/v1/sequences/build", {
				spec: sequenceSpec(),
				options: {
					artifactFormats: ["scene", "excalidraw"],
					inlineArtifacts: ["excalidraw"],
				},
			}),
		);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toMatchObject({
			ok: true,
			status: "accepted",
			normalizedSpec: {
				participants: [{ id: "client" }, { id: "api" }, { id: "store" }],
			},
			artifact: {
				formats: [{ format: "scene" }, { format: "excalidraw", inline: expect.any(Object) }],
			},
		});
	});

	it("builds a public mindmap through the no-auth HTTP handler", async () => {
		const response = await handleBuildMindmapRequest(
			{},
			postRequest("https://studio.test/api/v1/mindmaps/build", {
				spec: {
					title: "Release plan",
					root: {
						label: "Release",
						children: [
							{ label: "Engineering", children: [{ label: "Verification" }] },
							{ label: "Launch", children: [{ label: "Documentation" }] },
						],
					},
				},
			}),
		);
		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toMatchObject({
			ok: true,
			status: "accepted",
			normalizedSpec: {
				root: {
					id: "topic-0",
					children: [{ id: "topic-0-0" }, { id: "topic-0-1" }],
				},
			},
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

	it("rejects oversized public mindmap request bodies with a typed 413", async () => {
		const spans = new SpanPipeline();
		const response = await handleBuildMindmapRequest(
			{ SKETCHI_ARTIFACTS: new MemoryBucket(), TELEMETRY_SPANS: spans },
			postRequest("https://studio.test/api/v1/mindmaps/build", {
				spec: {
					title: "Large",
					root: {
						label: "root",
						children: [{ label: "x".repeat(MAX_CODE_MODE_BUILD_REQUEST_BYTES) }],
					},
				},
			}),
		);
		expect(response.status).toBe(413);
		expect(response.headers.get("x-sketchi-run-id")).toMatch(/^run_/);
		await expect(response.json()).resolves.toMatchObject({
			ok: false,
			status: "invalid_input",
			issues: [{ code: "request_too_large", stage: "input" }],
		});
		expect(usageCaptures(spans)).toMatchObject([
			{
				event: { operation: "buildMindmap", status_code: 413 },
				request: { omitted: true, reason: "request_too_large" },
			},
		]);
	});

	it("rejects malformed extreme width without response amplification", async () => {
		const response = await handleBuildMindmapRequest(
			{},
			postRequest("https://studio.test/api/v1/mindmaps/build", {
				spec: {
					title: "Malformed width",
					root: {
						label: "root",
						children: Array.from({ length: 40_000 }, () => null),
					},
				},
			}),
		);
		expect(response.status).toBe(422);
		const text = await response.text();
		expect(text.length).toBeLessThan(2_000);
		expect(JSON.parse(text)).toMatchObject({
			issues: [{ code: "mindmap_too_large" }],
		});
	});

	it("stops and cancels an oversized chunked body without Content-Length", async () => {
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
		const request = new Request("https://studio.test/api/v1/mindmaps/build", requestInit);
		expect(request.headers.has("content-length")).toBe(false);
		const response = await handleBuildMindmapRequest({}, request);
		expect(response.status).toBe(413);
		expect(response.headers.get("x-sketchi-run-id")).toMatch(/^run_/);
		expect(cancelled).toBe(true);
		expect(pullCount).toBeLessThanOrEqual(3);
		await expect(response.json()).resolves.toMatchObject({
			issues: [{ code: "request_too_large" }],
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

	it("inlines the scene by default over HTTP, with each logo once", async () => {
		const response = await handleBuildFlowchartRequest(
			{
				ASSETS: {
					fetch: async (input) =>
						new Response(
							`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><title>${new URL(input instanceof Request ? input.url : input).pathname}</title><path d="M0 0H24V24H0Z"/></svg>`,
						),
				},
			},
			postRequest("https://studio.test/api/v1/flowcharts/build", {
				spec: {
					title: "Deploy pipeline",
					nodes: {
						push: { label: "Push to GitHub", icon: "github" },
						build: { label: "Build the Docker image", icon: "docker" },
						ship: { label: "Ship the Docker image", icon: "docker" },
					},
					edges: [
						["push", "build"],
						["build", "ship"],
					],
				},
			}),
		);

		expect(response.status).toBe(200);
		const text = await response.text();
		const built = JSON.parse(text) as {
			artifact: { formats: { format: string; inline?: { icons?: object } }[] };
		};
		expect(built.artifact.formats.map(({ format }) => format)).toEqual(["excalidraw", "scene"]);
		const scene = built.artifact.formats.find((format) => format.format === "scene");
		expect(Object.keys(scene?.inline?.icons ?? {}).sort()).toEqual(["docker", "github"]);
		expect(built.artifact).not.toHaveProperty("preview");
		expect(text.split("<svg").length - 1).toBe(2);
		expect(text).not.toContain("data:image/");
	});

	it("builds a flowchart's declared lanes into lane bands", async () => {
		const spec = approvalSpec();
		const response = await handleBuildFlowchartRequest(
			{},
			postRequest("https://studio.test/api/v1/flowcharts/build", {
				spec: {
					...spec,
					lanes: {
						requester: { label: "Requester", contains: ["request", "done", "revise"] },
						approver: { label: "Approver", contains: ["approve"] },
					},
				},
				options: { artifactFormats: ["scene"], inlineArtifacts: ["scene"] },
			}),
		);

		expect(response.status).toBe(200);
		const built = (await response.json()) as {
			artifact: {
				formats: { format: string; inline?: { elements: { rendererRole?: string }[] } }[];
			};
			normalizedSpec: { lanes?: Record<string, unknown> };
		};
		expect(Object.keys(built.normalizedSpec.lanes ?? {})).toHaveLength(2);
		const scene = built.artifact.formats.find((format) => format.format === "scene")?.inline;
		expect(scene?.elements.filter((element) => element.rendererRole === "swimlane")).toHaveLength(
			2,
		);
	});

	it("builds a flowchart's nested zones and node shapes", async () => {
		const spec = approvalSpec();
		const response = await handleBuildFlowchartRequest(
			{},
			postRequest("https://studio.test/api/v1/flowcharts/build", {
				spec: {
					...spec,
					groups: {
						region: { label: "us-east-1", kind: "region", contains: ["vpc", "done"] },
						vpc: { label: "VPC", kind: "vpc", contains: ["approve"] },
					},
					nodes: { ...spec.nodes, done: { label: "Done", shape: "database" } },
				},
				options: { artifactFormats: ["scene"], inlineArtifacts: ["scene"] },
			}),
		);

		expect(response.status).toBe(200);
		const built = (await response.json()) as {
			artifact: {
				formats: {
					format: string;
					inline?: { elements: { rendererRole?: string; shape?: string }[] };
				}[];
			};
			normalizedSpec: { groups?: Record<string, { contains: string[] }> };
		};
		expect(built.normalizedSpec.groups?.["region"]?.contains).toContain("vpc");
		const scene = built.artifact.formats.find((format) => format.format === "scene")?.inline;
		expect(scene?.elements.filter((element) => element.rendererRole === "zone")).toHaveLength(2);
		expect(scene?.elements.filter((element) => element.shape === "cylinder")).toHaveLength(1);
	});

	it("returns a structured 422 instead of a render 500 for a whitespace-only flowchart title", async () => {
		const response = await handleBuildFlowchartRequest(
			{},
			postRequest("https://studio.test/api/v1/flowcharts/build", {
				spec: { ...approvalSpec(), title: "   " },
			}),
		);

		expect(response.status).toBe(422);
		await expect(response.json()).resolves.toMatchObject({
			ok: false,
			status: "invalid_flowchart",
			issues: [
				{
					stage: "flowchart",
					ref: { path: "spec.title" },
				},
			],
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

	it("builds, retrieves, and patches an artifact through Response handlers", async () => {
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

		expect(patchResponse.status).toBe(200);
		const patched: unknown = await patchResponse.json();
		expect(patched).toMatchObject({
			ok: true,
			sourceArtifactId: artifactId,
			status: "accepted",
			artifact: {
				provenance: { sourceArtifactId: artifactId },
			},
		});

		const childArtifactId = artifactIdFrom(patched);
		const childResponse = await handleGetArtifactRequest(
			{},
			new Request(`https://studio.test/api/v1/artifacts/${childArtifactId}?format=scene`),
			childArtifactId,
		);
		expect(childResponse.status).toBe(200);
		await expect(childResponse.json()).resolves.toMatchObject({
			ok: true,
			artifactId: childArtifactId,
			provenance: { sourceArtifactId: artifactId },
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

	it("gives every span of a call the run and attempt its response names", async () => {
		const spans = new SpanPipeline();
		const response = await handleBuildFlowchartRequest(
			{ TELEMETRY_SPANS: spans },
			new Request("https://studio.test/api/v1/flowcharts/build", {
				body: JSON.stringify({ spec: approvalSpec() }),
				headers: { "cf-ray": "8f00000000000001", "content-type": "application/json" },
				method: "POST",
			}),
		);
		expect(response.status).toBe(200);
		const runId = response.headers.get("x-sketchi-run-id");
		const attemptId = response.headers.get("x-sketchi-attempt-id");
		expect(runId).toMatch(/^run_/);
		expect(spans.rows.length).toBeGreaterThan(5);
		for (const row of spans.rows) {
			expect(row, row.name).toMatchObject({
				attempt_id: attemptId,
				ray_id: "8f00000000000001",
				run_id: runId,
			});
		}
		expect(usageCaptures(spans)).toMatchObject([
			{ event: { attempt_id: attemptId, run_id: runId } },
		]);
	});

	it("records the usage summary and every issue of a failed build", async () => {
		const spans = new SpanPipeline();

		const response = await handleBuildFlowchartRequest(
			{ SKETCHI_ARTIFACTS: new MemoryBucket(), TELEMETRY_SPANS: spans },
			postRequest("https://studio.test/api/v1/flowcharts/build", {
				spec: {
					title: "Broken approval flow",
					nodes: [],
					edges: [{ source: "request", target: "done" }],
				},
			}),
		);

		expect(response.status).toBe(400);
		await expect(response.json()).resolves.toMatchObject({
			ok: false,
			issues: expect.arrayContaining([
				expect.objectContaining({
					code: expect.any(String),
				}),
			]),
		});

		const [capture] = usageCaptures(spans);
		if (!capture) throw new Error("The build recorded no usage capture.");
		expect(capture.event).toMatchObject({
			artifact_count: 0,
			artifact_delivery: false,
			operation: "buildFlowchart",
			request_method: "POST",
			request_path: "/api/v1/flowcharts/build",
			status: "error",
			status_code: 400,
			surface: "api",
		});
		const issues = capture.issues as Array<Record<string, unknown>>;
		expect(issues.length).toBeGreaterThan(0);
		expect((capture.event as Record<string, unknown>)["issue_count"]).toBe(issues.length);
		expect(issues[0]).toMatchObject({
			code: expect.any(String),
			path: expect.stringMatching(/^response\.issues\[/),
		});
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

describe("HTTP package validation authority", () => {
	it("passes the bounded body unchanged to the package operation", async () => {
		const body = { spec: approvalSpec(), callerMetadata: "not a schema field" };
		const request = postRequest("https://studio.test/api/v1/flowcharts/build", body);
		const operation = vi.fn((input: unknown) => {
			expect(input).toEqual(body);
			const result: BuildFlowchartResult = {
				ok: false,
				status: "invalid_input",
				issues: [],
			};
			return Effect.succeed(result);
		});
		const response = await runPlaygroundEffect(
			Effect.gen(function* () {
				const codeMode = yield* PlaygroundCodeMode;
				return yield* handleBuildFlowchartRequestEffect(request).pipe(
					Effect.provideService(PlaygroundCodeMode, {
						...codeMode,
						buildFlowchart: operation,
					}),
				);
			}),
			testBoundary({}, request),
		);
		expect(response.status).toBe(400);
		expect(operation).toHaveBeenCalledOnce();
	});
});
