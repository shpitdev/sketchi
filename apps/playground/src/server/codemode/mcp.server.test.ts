import { setImmediate } from "node:timers";
import validationFixtures from "./fixtures/mcp-validation-issues-v2.json";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { describe, expect, it, vi } from "vitest";
import { Context, Effect, Option, Schema } from "effect";

import type { CodeModeObjectBucket, CodeModeObjectBucketObject } from "@sketchi/diagram-agent";
import { normalizedSpecFrom } from "@sketchi/diagram-scenarios";

import type { StudioEnv } from "../bindings/studio-env.server";
import type { PngRenderResult } from "./png-renderer-object.server";
import { PlaygroundRequestMetadata } from "../runtime/context.server";
import { PlaygroundRequestCallbacks, runPlaygroundEffect } from "../runtime/runtime.server";
import { toPlaygroundStandardSchema } from "../schema/effect-standard-schema.server";
import { PlaygroundCodeMode } from "./service.server";
import {
	formatCodeModeDocs,
	getCodeModeDocs,
	CodeModeDocsRequestSchema,
	CodeModeDocsResultSchema,
	CodeModeSearchRequestSchema,
	CodeModeSearchResultSchema,
} from "./mcp-docs.server";
import { createEffectMcpServer, makeEffectMcpTool } from "./effect-mcp-adapter.server";
import {
	ExecuteRequestSchema,
	ExecuteResultSchema,
	createSketchiMcpServer as createSketchiMcpServerEffect,
	executeSketchiCodeMode as executeSketchiCodeModeEffect,
	handleSketchiMcpRequest as handleSketchiMcpRequestEffect,
	makeSketchiCodeModeProvider,
	normalizeSketchiExecuteCode,
	type CodeModeMcpOptions,
	type SketchiCodeModeExecutor,
	type SketchiCodeModeProvider,
} from "./mcp.server";

function stubPngRenderer() {
	const pngRenderer = {
		renderPng: async (): Promise<PngRenderResult> => ({
			_tag: "Rendered" as const,
			coldStart: false,
			png: new Uint8Array([80, 78, 71]).buffer,
			timing: { queueMs: 0, openMs: 0, exportMs: 0 },
		}),
		prewarm: () => {},
	};
	return {
		CODEMODE_PNG_RENDERER: { getByName: () => pngRenderer },
		SKETCHI_ARTIFACTS: new MemoryBucket(),
	};
}

// Accepted MCP builds now depend on the hosted PNG renderer. Stub that external
// boundary by default; failure-path tests opt out explicitly.
function testBoundary(env: StudioEnv, request: Request, pngRenderer = true) {
	return {
		env: pngRenderer
			? { CODEMODE_PNG_RENDERER: stubPngRenderer().CODEMODE_PNG_RENDERER, ...env }
			: env,
		request,
		platform: {
			waitUntilPromise: (promise: Promise<unknown>) => {
				void promise;
			},
		},
	};
}

function createSketchiMcpServer(
	env: StudioEnv,
	options: CodeModeMcpOptions & { origin?: string; request?: Request } = {},
) {
	const request =
		options.request ??
		new Request(`${options.origin ?? "https://studio.test"}/mcp`, {
			method: "POST",
		});
	return runPlaygroundEffect(
		Effect.gen(function* () {
			const callbacks = yield* PlaygroundRequestCallbacks;
			return createSketchiMcpServerEffect(
				callbacks.runPromise,
				options.executor ? { executor: options.executor } : {},
			);
		}),
		testBoundary(env, request),
	);
}

function executeSketchiCodeMode(
	env: StudioEnv,
	input: unknown,
	options: CodeModeMcpOptions & { origin?: string; request?: Request; pngRenderer?: boolean } = {},
) {
	const request =
		options.request ??
		new Request(`${options.origin ?? "https://studio.test"}/mcp`, {
			method: "POST",
		});
	const boundary = testBoundary(env, request, options.pngRenderer);
	return runPlaygroundEffect(
		Effect.gen(function* () {
			const callbacks = yield* PlaygroundRequestCallbacks;
			return yield* executeSketchiCodeModeEffect(
				input,
				callbacks.runPromise,
				options.executor ? { executor: options.executor } : {},
			);
		}),
		boundary,
	);
}

function handleSketchiMcpRequest(
	env: StudioEnv,
	request: Request,
	options: CodeModeMcpOptions = {},
) {
	const boundary = testBoundary(env, request);
	return runPlaygroundEffect(handleSketchiMcpRequestEffect(request, options), boundary);
}

const CIRCLE_TO_DIAMOND_CODE = `async () => {
  const built = await sketchi.buildFlowchart({
    spec: {
      title: "Harness MCP proof flow",
      nodes: [
        { id: "start", label: "Start", kind: "start" },
        { id: "choice", label: "Continue?", kind: "decision" },
        { id: "yes", label: "Continue", kind: "end" },
        { id: "no", label: "Stop", kind: "end" },
      ],
      edges: [
        { source: "start", target: "choice" },
        { source: "choice", target: "yes", label: "yes" },
        { source: "choice", target: "no", label: "no" },
      ],
      layout: { direction: "LR" },
    },
  });

  if (!built.ok) return built;

  const patched = await sketchi.applyDiagramPatch({
    source: { artifactId: built.artifact.artifactId },
    operations: [
      { op: "setShape", selector: { nodeIds: ["start"] }, shape: "circle" },
      { op: "setShape", selector: { nodeIds: ["choice"] }, shape: "diamond" },
      {
        op: "setStyle",
        selector: { nodeIds: ["choice"] },
        style: { strokeColor: "#7c3aed", fillColor: "#ede9fe" },
      },
    ],
    options: {
      artifactFormats: ["scene", "excalidraw"],
      inlineArtifacts: ["excalidraw"],
    },
  });

  if (!patched.ok) return patched;

  return sketchi.getArtifact({
    artifactId: patched.artifact.artifactId,
    format: "excalidraw",
    inline: true,
  });
}`;

const BUILD_MINDMAP_CODE = `async () => sketchi.buildMindmap({
  spec: {
    title: "Code Mode mindmap",
    root: { label: "Mindmap", children: [
      { label: "Branches", children: [{ label: "Depth" }] },
      { label: "Artifacts", children: [{ label: "Excalidraw" }] }
    ] }
  }
})`;

const BUILD_SEQUENCE_CODE = `async () => sketchi.buildSequenceDiagram({
  spec: {
    title: "Request sequence",
    participants: [
      { id: "client", label: "Client" },
      { id: "api", label: "API" },
      { id: "store", label: "Store" }
    ],
    messages: [
      { source: "client", target: "api", label: "Request" },
      { source: "api", target: "store", label: "Read" }
    ]
  }
})`;

const CREATE_CANVAS_CODE = `async () => sketchi.createCanvas({
  spec: {
    kind: "canvas", version: 1, diagramId: "mcp-canvas", title: "MCP canvas",
    width: 480, height: 320, accentColor: "#111827", backgroundColor: "#ffffff",
    elements: [{ type: "node", id: "card", nodeId: "card", shape: "rectangle", x: 40, y: 40, width: 220, height: 100, label: "Canvas" }],
    layers: [], layouts: [], zOrder: ["card"]
  },
  options: { artifactFormats: ["scene", "excalidraw"], inlineArtifacts: ["scene"] }
})`;

const ACCEPTED_ARTIFACT_WITHOUT_URLS_CODE = `async () => ({
  ok: true,
  status: "accepted",
  artifact: {
    artifactId: "artifact_without_urls",
    diagramId: "diagram_without_urls",
    formats: [
      {
        format: "scene",
        mimeType: "application/vnd.sketchi.scene+json",
        sizeBytes: 100
      },
      {
        format: "excalidraw",
        mimeType: "application/vnd.excalidraw+json",
        sizeBytes: 200
      },
      {
        format: "png",
        mimeType: "image/png",
        sizeBytes: 300
      }
    ]
  }
})`;

const ACCEPTED_ARTIFACT_WITH_MIXED_URLS_CODE = `async () => ({
  ok: true,
  status: "accepted",
  artifact: {
    artifactId: "artifact_mixed_urls",
    diagramId: "diagram_mixed_urls",
    formats: [
      {
        format: "scene",
        mimeType: "application/vnd.sketchi.scene+json",
        sizeBytes: 100
      },
      {
        format: "excalidraw",
        mimeType: "application/vnd.excalidraw+json",
        sizeBytes: 200,
        url: "https://custom.test/excalidraw"
      },
      {
        format: "png",
        mimeType: "image/png",
        sizeBytes: 300
      }
    ]
  }
})`;

function createInProcessExecutor(): SketchiCodeModeExecutor {
	return {
		async execute(code: string, providers: SketchiCodeModeProvider[]) {
			const namespaces = Object.fromEntries(
				providers.map((provider) => [provider.name, provider.fns]),
			);
			const names = Object.keys(namespaces);
			const values = Object.values(namespaces);
			const logs: string[] = [];
			const sandboxConsole = {
				log: (...args: unknown[]) => logs.push(args.map(String).join(" ")),
			};

			try {
				const source = code.trim().replace(/;+\s*$/, "");
				// oxlint-disable-next-line typescript/no-implied-eval -- stands in for the Code Mode sandbox, which evaluates code
				const run = new Function(...names, "console", `"use strict"; return (${source})();`);
				return {
					result: await run(...values, sandboxConsole),
					logs,
				};
			} catch (error) {
				return {
					result: null,
					error: error instanceof Error ? error.message : String(error),
					logs,
				};
			}
		},
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function structuredContent(response: unknown): Record<string, unknown> {
	if (!isRecord(response) || !isRecord(response.structuredContent)) {
		throw new Error("MCP response did not include structured content.");
	}

	return response.structuredContent;
}

function textContent(response: unknown): string[] {
	if (!isRecord(response) || !Array.isArray(response.content)) {
		throw new Error("MCP response did not include content.");
	}

	return response.content.flatMap((item) => {
		if (!isRecord(item) || item.type !== "text" || typeof item.text !== "string") {
			return [];
		}
		return [item.text];
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

class MemoryPipeline {
	readonly batches: unknown[][] = [];

	async send(records: readonly unknown[]): Promise<void> {
		this.batches.push([...records]);
	}

	records(): unknown[] {
		return this.batches.flat();
	}
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
	const buffer = new ArrayBuffer(bytes.byteLength);
	new Uint8Array(buffer).set(bytes);
	return buffer;
}

async function readBucketJson(bucket: MemoryBucket, key: string): Promise<unknown> {
	const object = await bucket.get(key);
	return JSON.parse((await object?.text()) ?? "{}");
}

async function usageEventsFrom(bucket: MemoryBucket): Promise<unknown[]> {
	const eventKeys = [...bucket.objects.keys()]
		.filter((key) => key.startsWith("codemode/usage/"))
		.filter((key) => key.endsWith("/event.json"))
		.sort();

	return Promise.all(eventKeys.map((key) => readBucketJson(bucket, key)));
}

async function waitForUsageEvents(bucket: MemoryBucket, count: number): Promise<unknown[]> {
	const deadline = Date.now() + 1_000;

	while (Date.now() < deadline) {
		const events = await usageEventsFrom(bucket);
		if (events.length >= count) {
			return events;
		}
		await delay(5);
	}

	throw new Error(`Expected ${count} usage event(s) to be persisted.`);
}

async function waitForPipelineRecords(pipeline: MemoryPipeline, count: number): Promise<unknown[]> {
	const deadline = Date.now() + 1_000;

	while (Date.now() < deadline) {
		const records = pipeline.records();
		if (records.length >= count) {
			return records;
		}
		await delay(5);
	}

	throw new Error(`Expected ${count} pipeline record(s) to be sent.`);
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}

function createMcpFetch(options: CodeModeMcpOptions, env: StudioEnv = {}): typeof fetch {
	return async (input, init) => {
		const request = new Request(input, init);
		return handleSketchiMcpRequest(env, request, options);
	};
}

// Hang guard for streamable HTTP round trips, not a speed budget.
describe("Sketchi Code Mode MCP server", { timeout: 60_000 }, () => {
	const optionsOperations = [
		[
			"buildFlowchart",
			{
				spec: {
					title: "Trailing options flow",
					nodes: [
						{ id: "start", label: "Start", kind: "start" },
						{ id: "end", label: "Done", kind: "end" },
					],
					edges: [{ source: "start", target: "end" }],
				},
			},
		],
		[
			"buildMindmap",
			{
				spec: {
					title: "Trailing options mindmap",
					root: { label: "Root", children: [{ label: "Child" }] },
				},
			},
		],
		[
			"buildSequenceDiagram",
			{
				spec: {
					title: "Trailing options sequence",
					participants: [
						{ id: "client", label: "Client" },
						{ id: "api", label: "API" },
					],
					messages: [{ source: "client", target: "api", label: "Request" }],
				},
			},
		],
		[
			"buildTimeline",
			{ spec: { title: "Release", events: [{ id: "ship", label: "Ship", date: "2026-10-01" }] } },
		],
		[
			"buildChart",
			{
				spec: {
					title: "Sales",
					kind: "bar",
					categories: ["Q1", "Q2"],
					series: [{ name: "Sales", values: [1, 2] }],
				},
			},
		],
		[
			"buildStateMachine",
			{
				spec: {
					title: "Connection",
					initial: "Idle",
					states: [{ id: "Idle" }, { id: "Done", kind: "final" }],
					transitions: [{ source: "Idle", target: "Done", event: "finish" }],
				},
			},
		],
		[
			"buildGantt",
			{
				spec: {
					title: "Release plan",
					tasks: [{ id: "build", label: "Build", start: "2026-10-01", duration: 3 }],
				},
			},
		],
		[
			"buildErDiagram",
			{
				spec: {
					title: "Customers",
					entities: [{ id: "customers", fields: ["id uuid PK", "email text UK"] }],
					relationships: [],
				},
			},
		],
		[
			"buildClassDiagram",
			{
				spec: {
					title: "Account",
					classes: [{ id: "Account", attributes: ["- id: UUID"] }],
					relationships: [],
				},
			},
		],
		[
			"buildOrgChart",
			{
				spec: {
					title: "Team",
					people: [
						{ id: "lead", name: "Lead" },
						{ id: "dev", name: "Developer", manager: "lead" },
					],
				},
			},
		],
		[
			"buildSankey",
			{
				spec: {
					title: "Budget",
					nodes: [
						{ id: "eng", label: "Engineering" },
						{ id: "compute", label: "Compute" },
					],
					links: [{ source: "eng", target: "compute", value: 10 }],
				},
			},
		],
		[
			"buildQuadrantChart",
			{
				spec: {
					title: "Backlog",
					xAxis: { title: "Effort", low: "Low effort", high: "High effort" },
					yAxis: { title: "Impact", low: "Low impact", high: "High impact" },
					quadrants: {
						topLeft: "Quick wins",
						topRight: "Major projects",
						bottomLeft: "Fill-ins",
						bottomRight: "Thankless tasks",
					},
					points: [{ label: "Dark mode", x: 0.2, y: 0.7 }],
				},
			},
		],
		[
			"createCanvas",
			{
				spec: {
					kind: "canvas",
					version: 1,
					diagramId: "trailing-options-canvas",
					title: "Trailing options canvas",
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
							width: 220,
							height: 100,
							label: "Canvas",
						},
					],
					layers: [],
					layouts: [],
					zOrder: ["card"],
				},
			},
		],
		[
			"applyDiagramPatch",
			{ operations: [{ op: "setShape", selector: { nodeIds: ["start"] }, shape: "circle" }] },
		],
	] as const;

	function optionsCode(operation: string, request: object, trailing: string) {
		return `async () => {
			const request = ${JSON.stringify(request)};
			${
				operation === "applyDiagramPatch"
					? `const built = await sketchi.buildFlowchart(${JSON.stringify(optionsOperations[0][1])});
			if (!built.ok) return built;
			request.source = { artifactId: built.artifact.artifactId };`
					: ""
			}
			return sketchi.${operation}(request, ${trailing});
		}`;
	}

	it.each(optionsOperations)(
		"delivers a default PNG for accepted %s calls without options",
		async (operation, request) => {
			const output = await executeSketchiCodeMode(
				stubPngRenderer(),
				{ code: optionsCode(operation, request, "undefined") },
				{ executor: createInProcessExecutor() },
			);
			expect(output.artifactDelivery?.formats.map(({ format }) => format)).toEqual([
				"scene",
				"excalidraw",
				"png",
			]);
			expect(output.finalResponseText).toContain(`PNG URL: ${output.artifactDelivery?.pngUrl}`);
			expect(output.finalResponseText).not.toContain("unavailable");
		},
	);

	it.each(optionsOperations)(
		"keeps accepted %s artifacts when default PNG rendering fails",
		async (operation, request) => {
			const env = stubPngRenderer();
			env.CODEMODE_PNG_RENDERER.getByName = () => ({
				prewarm: () => {},
				renderPng: async () => ({
					_tag: "Failed",
					operation: "launch",
					message: "Browser Run 429",
				}),
			});
			const output = await executeSketchiCodeMode(
				env,
				{ code: optionsCode(operation, request, "undefined") },
				{ executor: createInProcessExecutor() },
			);
			expect(output.ok).toBe(true);
			expect(output.builds.every((build) => build.ok && build.status === "accepted")).toBe(true);
			expect(output.artifactDelivery?.artifactId).toEqual(expect.any(String));
			expect(output.artifactDelivery?.formats.map(({ format }) => format)).toEqual([
				"scene",
				"excalidraw",
			]);
			expect(output.artifactDelivery?.excalidrawUrl).toContain("format=excalidraw");
			expect(output.artifactDelivery?.pngUrl).toBeUndefined();
			const issues =
				operation === "applyDiagramPatch" && isRecord(output.result)
					? output.result.issues
					: output.builds[0]?.issues;
			expect(issues).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						code: "png_unavailable",
						severity: "warning",
						message: expect.stringContaining("Browser Run 429"),
					}),
				]),
			);
			expect(output.finalResponseText).toContain("PNG unavailable");
			// Artifact URLs must reference real stored exports, not partial unstored scenes.
			expect(
				[...env.SKETCHI_ARTIFACTS.objects.keys()].some(
					(key) =>
						key.includes(output.artifactDelivery?.artifactId ?? "missing") &&
						key.endsWith("excalidraw.json"),
				),
			).toBe(true);
		},
	);

	it("keeps explicit PNG rendering failures strict", async () => {
		const env = stubPngRenderer();
		env.CODEMODE_PNG_RENDERER.getByName = () => ({
			prewarm: () => {},
			renderPng: async () => ({
				_tag: "Failed",
				operation: "evaluate",
				message: "Renderer failed",
			}),
		});
		const output = await executeSketchiCodeMode(
			env,
			{
				code: optionsCode(
					"buildFlowchart",
					optionsOperations[0][1],
					'{ artifactFormats: ["scene", "excalidraw", "png"] }',
				),
			},
			{ executor: createInProcessExecutor() },
		);
		expect(output.builds[0]).toMatchObject({
			ok: false,
			status: "export_failed",
			issues: expect.arrayContaining([
				expect.objectContaining({ code: "render_failed", severity: "error" }),
			]),
		});
		expect(output.artifactDelivery).toBeUndefined();
		expect(output.finalResponseText).toContain("PNG unavailable");
	});

	it("expires a genuinely stalled renderer within one shared budget and keeps both builds accepted", async () => {
		const renderPng = vi.fn(() => new Promise<PngRenderResult>(() => {}));
		const started = performance.now();
		const output = await executeSketchiCodeMode(
			{ CODEMODE_PNG_RENDERER: { getByName: () => ({ prewarm: () => {}, renderPng }) } },
			{
				code: `async () => { await sketchi.buildFlowchart(${JSON.stringify(optionsOperations[0][1])}); return sketchi.buildFlowchart(${JSON.stringify(optionsOperations[0][1])}); }`,
			},
			{ executor: createInProcessExecutor() },
		);
		expect(performance.now() - started).toBeLessThan(30_000);
		expect(renderPng).toHaveBeenCalledTimes(1);
		expect(output.builds).toHaveLength(2);
		for (const build of output.builds)
			expect(build).toMatchObject({
				ok: true,
				status: "accepted",
				issues: expect.arrayContaining([
					expect.objectContaining({
						code: "png_unavailable",
						message: expect.stringContaining("budget"),
					}),
				]),
			});
		expect(output.artifactDelivery?.excalidrawUrl).toEqual(expect.any(String));
		expect(output.finalResponseText).toContain("PNG unavailable");
	});

	it.each(["first", "retry"])(
		"only reports PNG availability for the delivered %s build",
		async (delivered) => {
			const env = stubPngRenderer();
			const good = env.CODEMODE_PNG_RENDERER.getByName().renderPng;
			let calls = 0;
			env.CODEMODE_PNG_RENDERER.getByName = () => ({
				prewarm: () => {},
				renderPng: async () => {
					if (++calls === 1) throw new Error("Browser unavailable");
					return good();
				},
			});
			const output = await executeSketchiCodeMode(
				env,
				{
					code: `async () => { const first = await sketchi.buildFlowchart(${JSON.stringify(optionsOperations[0][1])}); const retry = await sketchi.buildFlowchart(${JSON.stringify(optionsOperations[0][1])}); return ${delivered}; }`,
				},
				{ executor: createInProcessExecutor() },
			);
			expect(output.builds[0]?.issues).toEqual(
				expect.arrayContaining([expect.objectContaining({ code: "png_unavailable" })]),
			);
			if (delivered === "retry") {
				expect(output.artifactDelivery?.pngUrl).toEqual(expect.any(String));
				expect(output.finalResponseText).not.toContain("PNG unavailable");
			} else {
				expect(output.artifactDelivery?.pngUrl).toBeUndefined();
				expect(output.finalResponseText).toContain("PNG unavailable");
			}
		},
	);

	it.each([
		{ spec: {} },
		{
			spec: {
				title: "Underbranched",
				nodes: [
					{ id: "a", label: "Start", kind: "start" },
					{ id: "b", label: "Continue?", kind: "decision" },
					{ id: "c", label: "Finish", kind: "end" },
				],
				edges: [
					{ source: "a", target: "b" },
					{ source: "b", target: "c", label: "yes" },
				],
			},
		},
		{ spec: { title: "Invalid", nodes: [{ id: "a", label: "Only", kind: "start" }], edges: [] } },
	])("does not invoke PNG rendering for rejected or invalid builds", async (request) => {
		const renderPng = vi.fn(async () => {
			throw new Error("Rejected builds must not render PNG");
		});
		const output = await executeSketchiCodeMode(
			{
				...stubPngRenderer(),
				CODEMODE_PNG_RENDERER: { getByName: () => ({ renderPng, prewarm: () => {} }) },
			},
			{ code: `async () => sketchi.buildFlowchart(${JSON.stringify(request)})` },
			{ executor: createInProcessExecutor() },
		);
		expect(output.builds[0]?.ok).toBe(false);
		expect(renderPng).not.toHaveBeenCalled();
		expect(output.artifactDelivery).toBeUndefined();
	});

	it.each([
		'{ inlineArtifacts: ["scene"] }',
		"{ artifactFormats: undefined, inlineArtifacts: [] }",
	])("keeps default PNG when only inline delivery is specified: %s", async (options) => {
		const output = await executeSketchiCodeMode(
			{},
			{ code: optionsCode("buildFlowchart", optionsOperations[0][1], options) },
			{ executor: createInProcessExecutor() },
		);
		expect(output.artifactDelivery?.pngUrl).toBeDefined();
	});

	it("does not render PNG when an explicit format list omits it", async () => {
		const renderPng = vi.fn(async () => {
			throw new Error("PNG was not requested");
		});
		const output = await executeSketchiCodeMode(
			{ CODEMODE_PNG_RENDERER: { getByName: () => ({ renderPng, prewarm: () => {} }) } },
			{
				code: optionsCode(
					"buildFlowchart",
					optionsOperations[0][1],
					'{ artifactFormats: ["scene", "excalidraw"] }',
				),
			},
			{ executor: createInProcessExecutor() },
		);
		expect(output.builds[0]?.ok).toBe(true);
		expect(output.artifactDelivery?.pngUrl).toBeUndefined();
		expect(output.finalResponseText).not.toContain("PNG unavailable");
		expect(renderPng).not.toHaveBeenCalled();
	});

	it("does not attach a failed explicit patch warning to an earlier delivered artifact", async () => {
		const env = stubPngRenderer();
		const goodRender = env.CODEMODE_PNG_RENDERER.getByName().renderPng;
		let calls = 0;
		env.CODEMODE_PNG_RENDERER.getByName = () => ({
			prewarm: () => {},
			renderPng: async () => {
				if (++calls === 1) return goodRender();
				throw new Error("Patch renderer disconnected");
			},
		});
		const output = await executeSketchiCodeMode(
			env,
			{
				code: `async () => { const built = await sketchi.buildFlowchart(${JSON.stringify(optionsOperations[0][1])}); const patched = await sketchi.applyDiagramPatch({ source: { artifactId: built.artifact.artifactId }, operations: [{ op: "setStyle", selector: { nodeIds: ["end"] }, style: { strokeColor: "#7c3aed" } }], options: { artifactFormats: ["scene", "excalidraw", "png"] } }); return { built, patched }; }`,
			},
			{ executor: createInProcessExecutor() },
		);
		expect(output.result).toMatchObject({
			patched: {
				ok: false,
				status: "export_failed",
				issues: expect.arrayContaining([
					expect.objectContaining({
						severity: "warning",
						message: expect.stringContaining("PNG unavailable"),
					}),
				]),
			},
		});
		expect(output.artifactDelivery?.pngUrl).toBeDefined();
		expect(output.finalResponseText).not.toContain("PNG unavailable");
		expect(output.artifactDelivery?.finalResponseText).toBe(output.finalResponseText);
	});

	it.each(optionsOperations)(
		"honors trailing PNG options for %s through execute",
		async (operation, request) => {
			const output = await executeSketchiCodeMode(
				stubPngRenderer(),
				{
					code: optionsCode(
						operation,
						request,
						'{ artifactFormats: ["scene", "excalidraw", "png"], inlineArtifacts: ["excalidraw"] }',
					),
				},
				{ executor: createInProcessExecutor() },
			);
			expect(output.ok).toBe(true);
			expect(output.result).toMatchObject({
				ok: true,
				status: "accepted",
				artifact: {
					formats: expect.arrayContaining([
						expect.objectContaining({ format: "png", url: expect.any(String) }),
						expect.objectContaining({ format: "excalidraw", inline: expect.any(Object) }),
					]),
				},
			});
			expect(output.artifactDelivery?.formats).toEqual(
				expect.arrayContaining([
					expect.objectContaining({ format: "png", url: expect.any(String) }),
				]),
			);
			expect(output.artifactDelivery?.pngUrl).toContain("https://studio.test/api/v1/artifacts/");
			expect(output.finalResponseText).toContain(`PNG URL: ${output.artifactDelivery?.pngUrl}`);
		},
	);

	it.each(optionsOperations)(
		"prefers request.options keys over trailing options for %s",
		async (operation, request) => {
			const output = await executeSketchiCodeMode(
				stubPngRenderer(),
				{
					code: optionsCode(
						operation,
						{ ...request, options: { artifactFormats: ["scene", "png"] } },
						'{ artifactFormats: ["excalidraw"], inlineArtifacts: ["scene"] }',
					),
				},
				{ executor: createInProcessExecutor() },
			);
			expect(output.result).toMatchObject({
				ok: true,
				artifact: {
					formats: [
						expect.objectContaining({ format: "scene", inline: expect.any(Object) }),
						expect.objectContaining({ format: "png" }),
					],
				},
			});
			expect(output.artifactDelivery?.pngUrl).toBeDefined();
		},
	);

	it.each([
		"null",
		"undefined",
		"42",
		'"png"',
		'[{ artifactFormats: ["png"] }]',
		"new Date()",
		'new (class { artifactFormats = ["png"]; })()',
	])("ignores non-plain trailing options: %s", async (trailing) => {
		const output = await executeSketchiCodeMode(
			{},
			{
				code: optionsCode("buildFlowchart", optionsOperations[0][1], trailing),
			},
			{ executor: createInProcessExecutor() },
		);
		expect(output.builds[0]).toMatchObject({
			ok: true,
			artifact: {
				formats: [
					expect.objectContaining({ format: "scene" }),
					expect.objectContaining({ format: "excalidraw" }),
					expect.objectContaining({ format: "png" }),
				],
			},
		});
		expect(output.artifactDelivery?.pngUrl).toBeDefined();
	});

	it("reports a repairable export failure when trailing PNG options have no renderer", async () => {
		const output = await executeSketchiCodeMode(
			{},
			{
				code: optionsCode(
					"buildFlowchart",
					optionsOperations[0][1],
					'{ artifactFormats: ["scene", "png"] }',
				),
			},
			{ executor: createInProcessExecutor(), pngRenderer: false },
		);
		expect(output.result).toMatchObject({
			ok: false,
			status: "export_failed",
			issues: expect.arrayContaining([
				expect.objectContaining({ code: "render_failed", hint: expect.any(String) }),
			]),
		});
		expect(output.artifactDelivery?.pngUrl).toBeUndefined();
		expect(output.finalResponseText).toContain("PNG unavailable");
	});

	it("preserves the MCP request trace in provider callbacks", async () => {
		let callbackContext:
			| {
					parentSpanId: string | undefined;
					spanId: string;
					spanName: string;
					spanTraceId: string;
					traceId: string;
			  }
			| undefined;
		const observeContext = Effect.gen(function* () {
			const metadata = yield* PlaygroundRequestMetadata;
			const span = yield* Effect.currentSpan;
			const parent = Option.getOrUndefined(span.parent);
			return {
				parentSpanId: parent?.spanId,
				spanName: span.name,
				spanId: span.spanId,
				spanTraceId: span.traceId,
				traceId: metadata.traceId,
			};
		});
		const codeMode = {
			buildFlowchart: () =>
				observeContext.pipe(
					Effect.tap((context) =>
						Effect.sync(() => {
							callbackContext = context;
						}),
					),
					Effect.as({
						ok: false as const,
						status: "invalid_input" as const,
						issues: [],
					}),
				),
		} as unknown as Context.Service.Shape<typeof PlaygroundCodeMode>;
		const request = new Request("https://studio.test/mcp", {
			headers: { "x-sketchi-trace-id": "trace-mcp-provider" },
			method: "POST",
		});

		const root = await runPlaygroundEffect(
			Effect.gen(function* () {
				const callbacks = yield* PlaygroundRequestCallbacks;
				const requestContext = yield* observeContext;
				const provider = makeSketchiCodeModeProvider(codeMode, callbacks.runPromise);
				const buildFlowchart = provider.fns.buildFlowchart;
				if (!buildFlowchart) {
					throw new Error("MCP provider did not expose buildFlowchart.");
				}
				return {
					callback: buildFlowchart({ spec: {} }),
					requestContext,
				};
			}),
			testBoundary({}, request),
		);

		await root.callback;
		expect(callbackContext?.spanTraceId).toBe(root.requestContext.spanTraceId);
		expect(callbackContext?.parentSpanId).toBe(root.requestContext.spanId);
		expect(callbackContext?.spanName).toBe("playground.request.callback");
		expect(callbackContext?.traceId).toBe("trace-mcp-provider");
	});

	it("exposes buildMindmap inside the Code Mode namespace", async () => {
		const result = await executeSketchiCodeMode(
			{},
			{ code: BUILD_MINDMAP_CODE },
			{ executor: createInProcessExecutor() },
		);
		expect(result).toMatchObject({
			ok: true,
			builds: [
				{
					ok: true,
					status: "accepted",
					normalizedSpec: { root: { id: "topic-0" } },
				},
			],
			result: { buildId: expect.any(String), ok: true, artifactId: expect.any(String) },
		});
	});
	it("exposes buildSequenceDiagram inside the Code Mode namespace", async () => {
		const result = await executeSketchiCodeMode(
			{},
			{ code: BUILD_SEQUENCE_CODE },
			{ executor: createInProcessExecutor() },
		);
		expect(result).toMatchObject({
			ok: true,
			builds: [
				{
					ok: true,
					status: "accepted",
					normalizedSpec: {
						participants: [{ id: "client" }, { id: "api" }, { id: "store" }],
					},
				},
			],
			result: { buildId: expect.any(String), ok: true, artifactId: expect.any(String) },
		});
	});
	it("builds a native timeline and captures its receipt through Code Mode", async () => {
		const result = await executeSketchiCodeMode(
			{},
			{
				code: `async () => sketchi.buildTimeline({ spec: { title: "Release", events: [{ id: "ship", label: "Ship", date: "2026-10-01" }, { id: "beta", label: "Beta", date: "2026-09-15" }] } })`,
			},
			{ executor: createInProcessExecutor() },
		);
		expect(result).toMatchObject({
			ok: true,
			builds: [
				{
					operation: "buildTimeline",
					ok: true,
					normalizedSpec: {
						events: [
							{ id: "beta", date: "2026-09-15" },
							{ id: "ship", date: "2026-10-01" },
						],
					},
				},
			],
			result: { buildId: expect.any(String), ok: true, artifactId: expect.any(String) },
		});
	});
	it("exposes createCanvas inside the Code Mode namespace", async () => {
		const result = await executeSketchiCodeMode(
			{},
			{ code: CREATE_CANVAS_CODE },
			{ executor: createInProcessExecutor() },
		);
		expect(result).toMatchObject({
			ok: true,
			result: {
				ok: true,
				status: "accepted",
				normalizedSpec: { kind: "canvas", version: 1, diagramId: "mcp-canvas" },
			},
		});
	});
	it("normalizes common LLM execute input wrappers", () => {
		expect(normalizeSketchiExecuteCode("async () => { return 1; };")).toBe(
			"async () => { return 1; }",
		);
		expect(normalizeSketchiExecuteCode("```js\nasync () => { return 1; };\n```")).toBe(
			"async () => { return 1; }",
		);
	});

	it("exposes docs, search, and execute tools through the MCP protocol", async () => {
		const client = new Client({
			name: "sketchi-codemode-test-client",
			version: "0.0.0",
		});
		const server = await createSketchiMcpServer({}, { executor: createInProcessExecutor() });
		const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

		try {
			await server.connect(serverTransport);
			await client.connect(clientTransport);

			await expect(client.ping()).resolves.toEqual({});

			const tools = await client.listTools();
			expect(tools.tools.map((tool) => tool.name).sort()).toEqual(["docs", "execute", "search"]);
			const executeTool = tools.tools.find((tool) => tool.name === "execute");
			expect(executeTool?.inputSchema).toMatchObject({
				properties: {
					code: { type: "string" },
				},
				required: ["code"],
				type: "object",
			});
			expect(executeTool?.description).toContain("plain JavaScript (no TypeScript");
			expect(executeTool?.description).toContain("async () =>");
			expect(executeTool?.description).toContain("artifactDelivery");
			expect(executeTool?.description).toContain("sequence participant.icon");
			expect(executeTool?.description).toContain("When the prompt names technologies");
			// Every request pays for tools/list. Claude Code cuts the description at 4096 characters in
			// upfront mode but keeps parameter descriptions, so the builder specs ride on code.
			expect(executeTool?.description?.length).toBeLessThanOrEqual(1_450);
			const codeDescription = String(
				Reflect.get(executeTool?.inputSchema.properties?.code ?? {}, "description"),
			);
			expect(codeDescription).toContain(
				"Keep every requested step and decision in a separate node, preserving the prompt's step wording and order.",
			);
			// Without this, Sol labels "If parsing succeeds, validate the schema" with "If parsing
			// succeeds" and "A file is uploaded and parsed" with "parsed".
			expect(codeDescription).toContain(
				'Label a step as a short action with its stated actor ("Server checks token"), a decision as a short question ("Image too large?") and a component by its name; never paste a clause',
			);
			// Without this, Sonnet folds "check supplier availability" into "Supplier available?".
			expect(codeDescription).toContain(
				'A stated check or verification ("verify the signature", "stock is checked") is its own process node before the decision that reads its result; "check whether X" alone is just that decision.',
			);
			// Without this, Sonnet turns "log any errors to Sentry" into an invented `Error?` branch.
			expect(codeDescription).toContain(
				'Do not add decisions, loops, steps, or edges the prompt does not state; a step that handles "any errors" or acts "if needed" stays one step in sequence.',
			);
			// Without this, Sonnet draws an OAuth redirect as a new call, leaving its request unanswered.
			expect(codeDescription).toContain(
				'Every reply the prompt states, including a redirect back to the caller, is its own type: "return" message',
			);
			expect(codeDescription).toMatch(/^buildFlowchart \(.*\): spec: \{ title, nodes: /m);
			expect(getCodeModeDocs({ topic: "buildFlowchart" }).content).toContain(
				"type BuildFlowchartRequest",
			);
			expect(codeDescription).not.toMatch(/^type /m);
			expect(codeDescription).toMatch(
				/^- buildChart: .*series: \[\{ name\?, values: number\[\] \}\]/m,
			);
			// "one may be else" turned Sonnet's stated guards into else; the guards are copied instead.
			expect(codeDescription).toMatch(
				/^- buildStateMachine: .*copy each guard the prompt states; use "else" only for a branch/m,
			);
			expect(codeDescription).toMatch(/^- buildErDiagram \(.*fromCardinality: "zero-or-many"/m);
			expect(codeDescription).toMatch(
				/^- buildClassDiagram: .*"composition" or "aggregation": from is the whole/m,
			);
			expect(codeDescription).toMatch(/^- buildOrgChart: .*manager is the id they report to/m);
			expect(codeDescription).toMatch(/^- buildVennDiagram: .*A region lies in exactly its sets/m);
			expect(codeDescription).toMatch(/^- buildJourneyMap: .*3 is neutral/m);
			expect(codeDescription).toMatch(/^- buildSankey: .*value is the stated amount/m);
			expect(codeDescription).toMatch(
				/^- buildWireframe \(.*device: "desktop" \| "tablet" \| "mobile"/m,
			);
			expect(codeDescription).toMatch(
				/^- buildQuadrantChart \(.*a score out of 100 is score \/ 100/m,
			);
			// The head retains builder names; specs and rules ride on the code parameter. Every request
			// pays for this on every turn: five families took it from 13,468 characters to 16,093, and
			// the compact flowchart spec, one shared copy rule and topic-only failure detail bring it
			// under 12,800. The flowchart label rule adds about 200 back. Lower this budget; do not
			// raise it.
			expect(
				JSON.stringify(
					tools.tools.map(({ name, description, inputSchema }) => ({
						name,
						description,
						inputSchema,
					})),
				).length,
			).toBeLessThan(13_000);
			expect(executeTool?.annotations).toMatchObject({
				readOnlyHint: false,
				destructiveHint: false,
				idempotentHint: false,
				openWorldHint: false,
			});
			expect(tools.tools.find((tool) => tool.name === "docs")?.outputSchema).toBeDefined();
			expect(tools.tools.find((tool) => tool.name === "search")?.outputSchema).toBeDefined();
			expect(tools.tools.find((tool) => tool.name === "execute")?.outputSchema).toBeDefined();
			const invalidSearch = await client.callTool({
				name: "search",
				arguments: { query: "", limit: 21 },
			});
			expect(invalidSearch).toEqual(validationFixtures.invalidSearch);

			// Standard Schema issues deliberately replace the parent Zod-shaped payloads.
			const invalidExecuteType = await client.callTool({
				name: "execute",
				arguments: { code: 123 },
			});
			expect(invalidExecuteType).toEqual(validationFixtures.invalidExecuteType);

			const missingExecuteCode = await client.callTool({
				name: "execute",
				arguments: {},
			});
			expect(missingExecuteCode).toEqual(validationFixtures.missingExecuteCode);

			const invalidSearchLimit = await client.callTool({
				name: "search",
				arguments: { query: "diagram", limit: 1.5 },
			});
			expect(invalidSearchLimit).toEqual(validationFixtures.invalidSearchLimit);

			const invalidDocsTopic = await client.callTool({
				name: "docs",
				arguments: { topic: "bogus" },
			});
			expect(invalidDocsTopic).toEqual(validationFixtures.invalidDocsTopic);

			const unknownTool = await client.callTool({
				name: "missing",
				arguments: {},
			});
			expect(unknownTool).toEqual({
				content: [
					{
						type: "text",
						text: "MCP error -32602: Tool missing not found",
					},
				],
				isError: true,
			});

			const docsResponse = await client.callTool({
				name: "docs",
				arguments: { topic: "agentSequence" },
			});
			const docs = structuredContent(docsResponse);
			expect(docs).toMatchObject({
				topic: "agentSequence",
			});
			expect(JSON.stringify(docs)).toContain("buildFlowchart");
			// Models read docs as plain text rather than escaped JSON; structured content keeps the envelope.
			expect(textContent(docsResponse)).toEqual([
				formatCodeModeDocs(getCodeModeDocs({ topic: "agentSequence" })),
			]);

			const search = structuredContent(
				await client.callTool({
					name: "search",
					arguments: { query: "managed convex threads" },
				}),
			);
			expect(JSON.stringify(search)).toContain("managed-thread-non-goal");

			const execute = structuredContent(
				await client.callTool({
					name: "execute",
					arguments: { code: CIRCLE_TO_DIAMOND_CODE },
				}),
			);
			expect(execute).toMatchObject({
				ok: true,
				result: {
					ok: true,
					format: "excalidraw",
					inline: {
						type: "excalidraw",
						version: 2,
					},
				},
			});
		} finally {
			await client.close();
			await server.close();
		}
	});

	it("returns Standard Schema issues for invalid tool output", async () => {
		const invalidOutput = makeEffectMcpTool("invalid-output", {
			title: "Invalid output fixture",
			description: "Exercises MCP output validation.",
			inputSchema: toPlaygroundStandardSchema(
				Schema.Struct({ ok: Schema.optionalKey(Schema.Boolean) }),
			),
			outputSchema: toPlaygroundStandardSchema(Schema.Struct({ value: Schema.String })),
		}).bind(() => ({
			content: [{ type: "text", text: "invalid" }],
			structuredContent: { value: 1 },
		}));
		const server = createEffectMcpServer({
			name: "effect-mcp-output-validation-test",
			tools: [invalidOutput],
			version: "0.0.0",
		});
		const client = new Client({
			name: "effect-mcp-output-validation-test-client",
			version: "0.0.0",
		});
		const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

		try {
			await server.connect(serverTransport);
			await client.connect(clientTransport);

			const response = await client.callTool({
				name: "invalid-output",
				arguments: {},
			});
			// Keep the complete MCP envelope and Standard Schema issue paths pinned.
			expect(response).toEqual(validationFixtures.invalidOutput);
		} finally {
			await client.close();
			await server.close();
		}
	});

	it("puts artifact delivery text first in execute content for harnesses", async () => {
		const client = new Client({
			name: "sketchi-codemode-delivery-text-test-client",
			version: "0.0.0",
		});
		const server = await createSketchiMcpServer(
			{},
			{
				executor: createInProcessExecutor(),
				origin: "https://studio.test",
			},
		);
		const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

		try {
			await server.connect(serverTransport);
			await client.connect(clientTransport);

			const response = await client.callTool({
				name: "execute",
				arguments: { code: ACCEPTED_ARTIFACT_WITHOUT_URLS_CODE },
			});
			const text = textContent(response);

			expect(text).toHaveLength(2);
			expect(text[0]).toBe(
				"Sketchi artifact ready.\nArtifact ID: artifact_without_urls\nDiagram ID: diagram_without_urls\nFormats: scene, excalidraw, png\nExcalidraw URL: https://studio.test/api/v1/artifacts/artifact_without_urls?format=excalidraw&raw=true\nPNG URL: https://studio.test/api/v1/artifacts/artifact_without_urls?format=png&raw=true",
			);
			expect(text[1]).toContain('"artifactDelivery"');
			expect(structuredContent(response)).toMatchObject({
				artifactDelivery: {
					artifactId: "artifact_without_urls",
					excalidrawUrl:
						"https://studio.test/api/v1/artifacts/artifact_without_urls?format=excalidraw&raw=true",
					pngUrl: "https://studio.test/api/v1/artifacts/artifact_without_urls?format=png&raw=true",
				},
				ok: true,
			});
		} finally {
			await client.close();
			await server.close();
		}
	});

	function withInlineExcalidraw(code: string | undefined) {
		const delivery = 'artifactFormats: ["scene", "excalidraw", "png"], inlineArtifacts: []';
		expect(code).toContain(delivery);
		return code?.replace(
			delivery,
			'artifactFormats: ["scene", "excalidraw"], inlineArtifacts: ["excalidraw"]',
		);
	}

	it.each([
		["buildFlowchart", ["vercel", "nextjs"]],
		["buildSequenceDiagram", ["github", "cloudflare", "docker"]],
	] as const)("executes the %s logo example with every named technology", async (topic, slugs) => {
		const code = getCodeModeDocs({ topic }).examples[0]?.code;
		expect(code).toBeDefined();
		const requested: string[] = [];
		const output = await executeSketchiCodeMode(
			{
				SKETCHI_ARTIFACTS: new MemoryBucket(),
				ASSETS: {
					fetch: async (input) => {
						requested.push(new URL(input instanceof Request ? input.url : input).pathname);
						return new Response(
							'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M0 0H24V24H0Z"/></svg>',
						);
					},
				},
			},
			// PNG requires the hosted browser binding, and the inline export proves each logo is drawn.
			{ code: withInlineExcalidraw(code) },
			{ executor: createInProcessExecutor() },
		);
		expect(output.ok).toBe(true);
		const build = output.builds[0];
		expect(build?.ok).toBe(true);
		expect(build?.issues).toEqual([]);
		const spec = build?.normalizedSpec;
		if (!isRecord(spec)) throw new Error("Missing normalized spec");
		const items = topic === "buildFlowchart" ? spec.nodes : spec.participants;
		if (!Array.isArray(items)) throw new Error("Missing logo-bearing items");
		expect(
			items.flatMap((item) => (isRecord(item) && isRecord(item.icon) ? [item.icon.slug] : [])),
		).toEqual(slugs);
		for (const slug of slugs) expect(requested).toContain(`/node-logos/${slug}.svg`);
		// The exported artifact must contain an image for each logo, not just normalized metadata.
		const serialized = JSON.stringify(output.result);
		expect(serialized.match(/"type":"image"/g)).toHaveLength(slugs.length);
	});

	describe("logo payloads in execute results", () => {
		// Two nodes share the docker logo: each image may appear once, never per node or per copy.
		function logoFlowchartCode(options: string) {
			return `async () => sketchi.buildFlowchart({
  spec: {
    title: "Deploy pipeline",
    nodes: [
      { id: "push", label: "Push to GitHub", kind: "start", icon: { slug: "github" } },
      { id: "build", label: "Build the Docker image", kind: "process", icon: { slug: "docker" } },
      { id: "ship", label: "Ship the Docker image", kind: "end", icon: { slug: "docker" } }
    ],
    edges: [{ source: "push", target: "build" }, { source: "build", target: "ship" }]
  },
  options: ${options}
})`;
		}

		async function executeText(code: string) {
			const bucket = new MemoryBucket();
			const server = await createSketchiMcpServer(
				{
					SKETCHI_ARTIFACTS: bucket,
					ASSETS: {
						fetch: async (input) =>
							new Response(
								`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><title>${new URL(input instanceof Request ? input.url : input).pathname}</title><path d="M0 0H24V24H0Z"/></svg>`,
							),
					},
				},
				{ executor: createInProcessExecutor() },
			);
			const client = new Client({ name: "logo-payload-test", version: "1" });
			const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
			await server.connect(serverTransport);
			await client.connect(clientTransport);
			try {
				const response = await client.callTool({ name: "execute", arguments: { code } });
				expect(structuredContent(response)).toMatchObject({ ok: true, result: { ok: true } });
				return { bucket, text: textContent(response).join("\n") };
			} finally {
				await client.close();
				await server.close();
			}
		}

		const count = (text: string, needle: string) => text.split(needle).length - 1;

		it("returns artifact URLs and logo slugs without image bytes by default", async () => {
			const { bucket, text } = await executeText(
				logoFlowchartCode('{ artifactFormats: ["scene", "excalidraw"] }'),
			);

			expect(count(text, "<svg")).toBe(0);
			expect(count(text, "data:image/")).toBe(0);
			expect(text).toContain('"icon":{"slug":"docker"}');
			expect(text).toContain("format=excalidraw&raw=true");
			// The stored exports still draw every logo.
			const stored = [...bucket.objects].filter(([key]) => !key.includes("usage"));
			const excalidraw = stored.find(([key]) => key.endsWith("/excalidraw.json"))?.[1];
			const scene = stored.find(([key]) => key.endsWith("/scene.json"))?.[1];
			if (typeof excalidraw !== "string" || typeof scene !== "string") {
				throw new Error("Missing stored exports");
			}
			expect(count(excalidraw, '"type":"image"')).toBe(3);
			expect(count(excalidraw, "data:image/svg+xml")).toBe(2);
			expect(count(scene, "<svg")).toBe(2);
		});

		it.each([
			["scene", "<svg"],
			["excalidraw", "data:image/svg+xml"],
		])("inlines each image once when the script opts into %s", async (format, needle) => {
			const { text } = await executeText(
				logoFlowchartCode(
					`{ artifactFormats: ["scene", "excalidraw"], inlineArtifacts: ["${format}"] }`,
				),
			);

			expect(count(text, needle)).toBe(2);
			expect(count(text, "<svg") + count(text, "data:image/")).toBe(2);
		});

		it("fills the logo a label names in a diagram that draws logos, with an info note", async () => {
			const { text } = await executeText(`async () => sketchi.buildFlowchart({
  spec: {
    title: "Deploy pipeline",
    nodes: [
      { id: "push", label: "Push to GitHub", kind: "start", icon: { slug: "github" } },
      { id: "build", label: "Docker builds the image", kind: "process", icon: { slug: "docker" } },
      { id: "deploy", label: "Ship to Cloudflare Workers", kind: "end" }
    ],
    edges: [{ source: "push", target: "build" }, { source: "build", target: "deploy" }]
  },
  options: { artifactFormats: ["scene"] }
})`);

			expect(text).toContain(
				'{"id":"deploy","label":"Ship to Cloudflare Workers","kind":"end","icon":{"slug":"cloudflare"}}',
			);
			expect(text).toContain('"code":"icon_filled","severity":"info"');
		});
	});

	it("serves docs, search, and execute over the streamable HTTP MCP route", async () => {
		const client = new Client({
			name: "sketchi-codemode-http-test-client",
			version: "0.0.0",
		});
		const transport = new StreamableHTTPClientTransport(new URL("https://studio.test/mcp"), {
			fetch: createMcpFetch({ executor: createInProcessExecutor() }),
		});

		try {
			await client.connect(transport as unknown as Transport);

			const tools = await client.listTools();
			expect(tools.tools.map((tool) => tool.name).sort()).toEqual(["docs", "execute", "search"]);

			const docs = structuredContent(
				await client.callTool({
					name: "docs",
					arguments: { topic: "execute" },
				}),
			);
			expect(JSON.stringify(docs)).toContain("sketchi.applyDiagramPatch");

			const execute = structuredContent(
				await client.callTool({
					name: "execute",
					arguments: { code: CIRCLE_TO_DIAMOND_CODE },
				}),
			);
			expect(execute).toMatchObject({
				ok: true,
				result: {
					ok: true,
					format: "excalidraw",
					inline: {
						type: "excalidraw",
						version: 2,
					},
					url: expect.stringContaining("https://studio.test/api/v1/artifacts/"),
				},
			});
		} finally {
			await client.close();
		}
	});

	it.each([
		"built",
		"JSON.parse(JSON.stringify(built))",
		"Object.fromEntries(Object.entries(built).reverse())",
	])(
		"deduplicates a returned build (%s) without losing the consumer contract",
		async (returned) => {
			const output = await executeSketchiCodeMode(
				stubPngRenderer(),
				{
					code: `async () => { const built = await sketchi.buildFlowchart({ spec: { title: "Receipt contract", nodes: [{id:"a",label:"Start",kind:"start"},{id:"b",label:"Finish",kind:"end"}], edges:[{source:"a",target:"b"}] }, options: { artifactFormats: ["scene", "png"] } }); return ${returned}; }`,
				},
				{ executor: createInProcessExecutor() },
			);
			const build = output.builds[0];
			expect(build).toMatchObject({
				ok: true,
				buildId: expect.any(String),
				normalizedSpec: expect.any(Object),
				quality: { accepted: true, score: expect.any(Number) },
				artifact: {
					artifactId: expect.any(String),
					formats: expect.arrayContaining([
						expect.objectContaining({ format: "png", url: expect.any(String) }),
					]),
				},
			});
			expect(output.result).toEqual({
				buildId: build?.buildId,
				ok: true,
				artifactId: build?.artifact?.artifactId,
				png: output.artifactDelivery?.pngUrl,
			});
			expect(output.artifactDelivery?.artifactId).toBe(build?.artifact?.artifactId);
			expect(JSON.stringify(output).match(/"normalizedSpec":/g)).toHaveLength(1);
		},
	);

	it.each([
		[
			'return { built, note: "custom" };',
			{ note: "custom", built: expect.objectContaining({ normalizedSpec: expect.any(Object) }) },
		],
		[
			'built.normalizedSpec.title = "changed"; return built;',
			{ normalizedSpec: { title: "changed" } },
		],
		[
			'return { ...built, ok: false, reason: "custom error" };',
			{ ok: false, reason: "custom error" },
		],
		['return await sketchi.searchIcons({q:""});', { ok: false, issues: expect.any(Array) }],
	])("preserves non-duplicate script returns: %s", async (ending, expected) => {
		const output = await executeSketchiCodeMode(
			{},
			{ code: `async () => { const built = await (${BUILD_MINDMAP_CODE})(); ${ending} }` },
			{ executor: createInProcessExecutor() },
		);
		expect(output.result).toMatchObject(expected);
		expect(output.builds[0]?.normalizedSpec).toMatchObject({ title: "Code Mode mindmap" });
	});

	it.each([false, true])(
		"preserves rejected build detection with executor error=%s",
		async (executorError) => {
			const executor = createInProcessExecutor();
			const output = await executeSketchiCodeMode(
				{},
				{ code: `async () => sketchi.buildFlowchart({spec:{}})` },
				{
					executor: {
						async execute(code, providers) {
							const output = await executor.execute(code, providers);
							return { ...output, ...(executorError ? { error: "after build" } : {}) };
						},
					},
				},
			);
			expect(output.ok).toBe(!executorError);
			expect(output.result).toMatchObject({
				ok: false,
				status: "invalid_input",
				issues: output.builds[0]?.issues,
			});
			expect(output.builds[0]).toMatchObject({
				ok: false,
				status: "invalid_input",
				issues: expect.any(Array),
			});
		},
	);

	it("preserves array return values and every rejected-build detection path", async () => {
		const output = await executeSketchiCodeMode(
			{},
			{
				code: `async () => [await sketchi.buildFlowchart({spec:{}}), {ok:false, reason:"custom error"}]`,
			},
			{ executor: createInProcessExecutor() },
		);
		expect(output).toMatchObject({
			ok: true,
			result: [
				{ ok: false, issues: expect.any(Array) },
				{ ok: false, reason: "custom error" },
			],
			builds: [{ ok: false, issues: expect.any(Array) }],
		});
	});

	it("references the returned earlier build rather than the last receipt", async () => {
		const output = await executeSketchiCodeMode(
			{},
			{
				code: `async () => { const first = await (${BUILD_MINDMAP_CODE})(); await (${BUILD_SEQUENCE_CODE})(); return first; }`,
			},
			{ executor: createInProcessExecutor() },
		);
		expect(output.builds).toHaveLength(2);
		expect(output.result).toMatchObject({
			buildId: output.builds[0]?.buildId,
			ok: true,
			artifactId: output.builds[0]?.artifact?.artifactId,
		});
		expect(output.artifactDelivery?.artifactId).toBe(output.builds[0]?.artifact?.artifactId);
	});

	it.each(["first", "rebuilt"])(
		"resolves the returned %s receipt after build -> patch -> rebuild",
		async (returned) => {
			const output = await executeSketchiCodeMode(
				stubPngRenderer(),
				{
					code: `async () => {
			const first = await sketchi.buildFlowchart({spec:{title:"First build",nodes:[{id:"a",label:"Start",kind:"start"},{id:"b",label:"Finish",kind:"end"}],edges:[{source:"a",target:"b"}]},options:{artifactFormats:["scene","excalidraw","png"]}});
			if(!first.ok) return first;
			const patched = await sketchi.applyDiagramPatch({source:{artifactId:first.artifact.artifactId},operations:[{op:"setStyle",selector:{nodeIds:["b"]},style:{strokeColor:"#7c3aed"}}],options:{artifactFormats:["scene","png"]}});
			if(!patched.ok) return patched;
			const rebuilt = await sketchi.buildFlowchart({spec:{...first.normalizedSpec,title:"Rebuilt"},options:{artifactFormats:["scene","png"]}});
			return ${returned};
		}`,
				},
				{ executor: createInProcessExecutor() },
			);
			const selected = output.builds[returned === "first" ? 0 : 1];
			expect(output.builds).toHaveLength(2);
			expect(output.builds.every((build) => build.ok)).toBe(true);
			expect(output.result).toEqual({
				buildId: selected?.buildId,
				ok: true,
				artifactId: selected?.artifact?.artifactId,
				png: output.artifactDelivery?.pngUrl,
			});
			expect(output.artifactDelivery?.artifactId).toBe(selected?.artifact?.artifactId);
			expect(normalizedSpecFrom(output)).toEqual(selected?.normalizedSpec);
			expect(normalizedSpecFrom(output)).toMatchObject({
				title: returned === "first" ? "First build" : "Rebuilt",
			});
		},
	);

	it("reports every build over MCP when the script returns unrelated data", async () => {
		const bucket = new MemoryBucket();
		const server = await createSketchiMcpServer(
			{ SKETCHI_ARTIFACTS: bucket },
			{ executor: createInProcessExecutor() },
		);
		const client = new Client({ name: "build-receipt-test", version: "1" });
		const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
		await server.connect(serverTransport);
		await client.connect(clientTransport);
		try {
			const response = await client.callTool({
				name: "execute",
				arguments: {
					code: `async () => {
                await (${CIRCLE_TO_DIAMOND_CODE})();
                await (${BUILD_MINDMAP_CODE})();
                await (${BUILD_SEQUENCE_CODE})();
                await (${CREATE_CANVAS_CODE})();
                await sketchi.buildFlowchart({ spec: {} });
                return { iconLookups: [], status: "script-finished" };
            }`,
				},
			});
			const output = structuredContent(response);
			expect(output.result).toEqual({ iconLookups: [], status: "script-finished" });
			expect(output.builds).toEqual([
				...["buildFlowchart", "buildMindmap", "buildSequenceDiagram", "createCanvas"].map(
					(operation) =>
						expect.objectContaining({
							operation,
							ok: true,
							status: "accepted",
							buildId: expect.any(String),
							normalizedSpec: expect.any(Object),
							artifact: expect.objectContaining({
								artifactId: expect.any(String),
								formats: expect.any(Array),
							}),
						}),
				),
				expect.objectContaining({
					operation: "buildFlowchart",
					ok: false,
					status: "invalid_input",
					issues: expect.any(Array),
				}),
			]);
			if (!Array.isArray(output.builds)) throw new Error("Missing build receipts");
			expect(output.builds[0]).toMatchObject({
				quality: { accepted: true, score: expect.any(Number) },
			});
			expect(JSON.stringify(output.builds)).not.toContain('"inline":');
			expect(new TextEncoder().encode(JSON.stringify(output)).byteLength).toBeLessThan(1_000_000);
			const events = await waitForUsageEvents(bucket, 1);
			expect(events).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						operation: "execute",
						artifactRefs: output.builds
							.filter(isRecord)
							.filter((build) => isRecord(build.artifact))
							.map((build) =>
								expect.objectContaining({
									artifactId: isRecord(build.artifact) ? build.artifact.artifactId : undefined,
								}),
							),
						response: {
							body: expect.objectContaining({
								value: expect.objectContaining({ builds: output.builds }),
							}),
						},
					}),
				]),
			);
		} finally {
			await client.close();
			await server.close();
		}
	});

	it.each(["return undefined;", 'throw new Error("after build");'])(
		"retains build receipts after %s",
		async (ending) => {
			const output = await executeSketchiCodeMode(
				{},
				{ code: `async () => { await (${BUILD_MINDMAP_CODE})(); ${ending} }` },
				{ executor: createInProcessExecutor() },
			);
			expect(output.builds).toEqual([
				expect.objectContaining({
					operation: "buildMindmap",
					ok: true,
					normalizedSpec: expect.any(Object),
				}),
			]);
		},
	);

	it.each([false, true])(
		"settles successful executions but preserves an executor timeout (timeout=%s)",
		async (timedOut) => {
			const writeStarted = Promise.withResolvers<void>();
			const releaseWrite = Promise.withResolvers<void>();
			const scriptReturned = Promise.withResolvers<void>();
			class GatedBucket extends MemoryBucket {
				override async put(key: string, value: string | ArrayBuffer | Uint8Array) {
					if (!key.startsWith("codemode/usage/")) {
						writeStarted.resolve();
						await releaseWrite.promise;
					}
					return super.put(key, value);
				}
			}
			const bucket = new GatedBucket();
			let launched: Promise<unknown> | undefined;
			const execution = executeSketchiCodeMode(
				{ SKETCHI_ARTIFACTS: bucket },
				{ code: "async () => {}" },
				{
					executor: {
						async execute(_code, providers) {
							const build = providers[0]?.fns.buildMindmap;
							if (!build) throw new Error("Missing builder");
							launched = build({
								spec: {
									title: "Pending persistence",
									root: { label: "Root", children: [{ label: "Child" }] },
								},
							});
							await writeStarted.promise;
							scriptReturned.resolve();
							return timedOut ? { result: null, error: "Execution timed out" } : { result: "done" };
						},
					},
				},
			);
			try {
				await scriptReturned.promise;
				await new Promise<void>((resolve) => setImmediate(resolve));
				if (!timedOut) releaseWrite.resolve();
				// On timeout this must return while storage remains blocked.
				const output = await execution;
				expect(output.builds).toEqual([
					expect.objectContaining({
						operation: "buildMindmap",
						ok: !timedOut,
						status: timedOut ? "incomplete" : "accepted",
					}),
				]);
				if (timedOut) expect(output).toMatchObject({ ok: false, error: "Execution timed out" });
				const events = await waitForUsageEvents(bucket, 1);
				expect(events).toEqual([
					expect.objectContaining({
						response: {
							body: expect.objectContaining({
								value: expect.objectContaining({ builds: output.builds }),
							}),
						},
					}),
				]);
				releaseWrite.resolve();
				await launched;
				// A late completion must not mutate the already-published timeout snapshot.
				if (timedOut) expect(output.builds[0]?.status).toBe("incomplete");
			} finally {
				releaseWrite.resolve();
				await launched;
			}
		},
	);

	it.each([1, 2])(
		"counts issues once per build, not per returned copy (%i builds)",
		async (count) => {
			const events = new MemoryPipeline();
			const issues = new MemoryPipeline();
			const output = await executeSketchiCodeMode(
				{ CODEMODE_USAGE_EVENTS: events, CODEMODE_USAGE_ISSUES: issues },
				{
					code: `async () => { let built; for (let i = 0; i < ${count}; i++) built = await sketchi.buildFlowchart({spec:{}}); return built; }`,
				},
				{ executor: createInProcessExecutor() },
			);
			const issueCount = output.builds.reduce((total, build) => total + build.issues.length, 0);
			expect(issueCount).toBeGreaterThan(0);
			expect(await waitForPipelineRecords(events, 1)).toEqual([
				expect.objectContaining({ issue_count: issueCount }),
			]);
			expect(await waitForPipelineRecords(issues, issueCount)).toHaveLength(issueCount);
		},
	);

	it("does not duplicate warnings from an accepted build returned directly", async () => {
		const events = new MemoryPipeline();
		const issues = new MemoryPipeline();
		const output = await executeSketchiCodeMode(
			{ CODEMODE_USAGE_EVENTS: events, CODEMODE_USAGE_ISSUES: issues },
			{
				code: `async () => sketchi.buildFlowchart({spec:{title:"Warning receipt",nodes:[{id:"a",label:"Begin",kind:"start",icon:{slug:"not-a-real-logo"}},{id:"b",label:"Finish",kind:"end"}],edges:[{source:"a",target:"b"}]}})`,
			},
			{ executor: createInProcessExecutor() },
		);
		const build = output.builds[0];
		expect(build).toMatchObject({ ok: true, buildId: expect.any(String) });
		if (!build || !isRecord(build.quality) || !Array.isArray(build.quality.checks))
			throw new Error("Missing quality report");
		expect(build.issues.length).toBeGreaterThan(0);
		const count = build.issues.length + build.quality.checks.length;
		expect(await waitForPipelineRecords(events, 1)).toEqual([
			expect.objectContaining({ issue_count: count }),
		]);
		expect(await waitForPipelineRecords(issues, count)).toHaveLength(count);
	});

	it("preserves non-build issues alongside canonical build receipt issues", async () => {
		const events = new MemoryPipeline();
		const issues = new MemoryPipeline();
		const output = await executeSketchiCodeMode(
			{ CODEMODE_USAGE_EVENTS: events, CODEMODE_USAGE_ISSUES: issues },
			{
				code: `async () => { const built = await sketchi.buildFlowchart({spec:{}}); const extra = await sketchi.searchIcons({q:""}); return { built, extra }; }`,
			},
			{ executor: createInProcessExecutor() },
		);
		if (
			!isRecord(output.result) ||
			!isRecord(output.result.extra) ||
			!Array.isArray(output.result.extra.issues)
		)
			throw new Error("Expected search issues");
		const count =
			output.builds.reduce((total, build) => total + build.issues.length, 0) +
			output.result.extra.issues.length;
		expect(await waitForPipelineRecords(events, 1)).toEqual([
			expect.objectContaining({ issue_count: count }),
		]);
		expect(await waitForPipelineRecords(issues, count)).toHaveLength(count);
	});

	it("waits for sandbox builds whose RPC arrives after the script returns", async () => {
		const executor = createInProcessExecutor();
		const output = await executeSketchiCodeMode(
			{},
			{
				code: `async () => { (${BUILD_MINDMAP_CODE})(); return { ok: false, reason: "optional step skipped" }; }`,
			},
			{
				executor: {
					execute(code, providers) {
						return executor.execute(
							code,
							providers.map((provider) => ({
								...provider,
								fns: Object.fromEntries(
									Object.entries(provider.fns).map(([name, fn]) => [
										name,
										async (...args: unknown[]) => {
											await new Promise<void>((resolve) => setImmediate(resolve));
											return fn(...args);
										},
									]),
								),
							})),
						);
					},
				},
			},
		);
		expect(output.result).toEqual({ ok: false, reason: "optional step skipped" });
		expect(output.builds).toEqual([
			expect.objectContaining({ operation: "buildMindmap", ok: true }),
		]);
	});

	it("keeps concurrent receipts in call order and isolates them from script mutation", async () => {
		const output = await executeSketchiCodeMode(
			{},
			{
				code: `async () => {
            const results = await Promise.all([(${BUILD_MINDMAP_CODE})(), (${BUILD_SEQUENCE_CODE})()]);
            results[0].normalizedSpec.title = "mutated by script";
            results[0].quality.score = -1;
            return { done: true };
        }`,
			},
			{ executor: createInProcessExecutor() },
		);
		expect(output.builds).toEqual([
			expect.objectContaining({
				index: 0,
				operation: "buildMindmap",
				normalizedSpec: expect.objectContaining({ title: "Code Mode mindmap" }),
				quality: expect.objectContaining({ accepted: true, score: expect.any(Number) }),
			}),
			expect.objectContaining({ index: 1, operation: "buildSequenceDiagram" }),
		]);
		expect(JSON.stringify(output.builds)).not.toContain('"score":-1');
	});

	it("retains completed builds when the executor itself rejects", async () => {
		const output = await executeSketchiCodeMode(
			{},
			{ code: "async () => {}" },
			{
				executor: {
					async execute(_code, providers) {
						const build = providers[0]?.fns.buildMindmap;
						if (!build) throw new Error("Missing builder");
						await build({
							spec: {
								title: "Completed before rejection",
								root: { label: "Root", children: [{ label: "Child" }] },
							},
						});
						throw new Error("Executor rejected");
					},
				},
			},
		);
		expect(output).toMatchObject({
			ok: false,
			error: "Executor rejected",
			builds: [expect.objectContaining({ ok: true, operation: "buildMindmap" })],
		});
	});

	it.each([950_000, 1_000_000])(
		"keeps artifact refs and enforces the snapshot cap with %i bytes of script output",
		async (size) => {
			const bucket = new MemoryBucket();
			const output = await executeSketchiCodeMode(
				{ SKETCHI_ARTIFACTS: bucket },
				{
					code: `async () => {
            await (${BUILD_MINDMAP_CODE})();
            return "x".repeat(${size});
        }`,
				},
				{ executor: createInProcessExecutor() },
			);
			expect(output.builds).toHaveLength(1);
			const events = await waitForUsageEvents(bucket, 1);
			expect(events).toEqual([
				expect.objectContaining({
					artifactRefs: [
						expect.objectContaining({ artifactId: output.builds[0]?.artifact?.artifactId }),
					],
					response: {
						body: expect.objectContaining(
							size < 1_000_000
								? {
										value: expect.objectContaining({ builds: output.builds }),
										sizeBytes: expect.any(Number),
									}
								: { omittedReason: "snapshot_too_large", sizeBytes: expect.any(Number) },
						),
					},
				}),
			]);
			if (size < 1_000_000)
				expect(new TextEncoder().encode(JSON.stringify(output)).byteLength).toBeLessThan(1_000_000);
		},
	);

	it("returns structured execute errors instead of throwing tool failures", async () => {
		await expect(
			executeSketchiCodeMode({}, {}, { executor: createInProcessExecutor() }),
		).resolves.toMatchObject({
			ok: false,
			logs: [],
		});

		const result = await executeSketchiCodeMode(
			{},
			{
				code: `async () => {
          throw new Error("generated code failed");
        }`,
			},
			{ executor: createInProcessExecutor() },
		);

		expect(result).toEqual({
			builds: [],
			ok: false,
			error: "generated code failed",
			logs: [],
			result: null,
		});
	});

	it("accepts execute code with a trailing arrow-function semicolon", async () => {
		const result = await executeSketchiCodeMode(
			{},
			{
				code: `${CIRCLE_TO_DIAMOND_CODE};`,
			},
			{ executor: createInProcessExecutor() },
		);

		expect(result).toMatchObject({
			ok: true,
			result: {
				ok: true,
				format: "excalidraw",
			},
		});
	});

	it("adds artifactDelivery when generated code returns an accepted artifact bundle", async () => {
		const result = await executeSketchiCodeMode(
			{},
			{
				code: `async () => ({
          ok: true,
          status: "accepted",
          artifact: {
            artifactId: "artifact_delivery",
            diagramId: "diagram_delivery",
            formats: [
              {
                format: "scene",
                mimeType: "application/vnd.sketchi.scene+json",
                url: "https://studio.test/api/v1/artifacts/artifact_delivery?format=scene&raw=true"
              },
              {
                format: "excalidraw",
                mimeType: "application/vnd.excalidraw+json",
                sizeBytes: 1234,
                url: "https://studio.test/api/v1/artifacts/artifact_delivery?format=excalidraw&raw=true"
              },
              {
                format: "png",
                mimeType: "image/png",
                sizeBytes: 5678,
                url: "https://studio.test/api/v1/artifacts/artifact_delivery?format=png&raw=true"
              }
            ]
          }
        })`,
			},
			{ executor: createInProcessExecutor() },
		);

		expect(result).toMatchObject({
			artifactDelivery: {
				artifactId: "artifact_delivery",
				diagramId: "diagram_delivery",
				excalidrawUrl:
					"https://studio.test/api/v1/artifacts/artifact_delivery?format=excalidraw&raw=true",
				finalResponseText:
					"Sketchi artifact ready.\nArtifact ID: artifact_delivery\nDiagram ID: diagram_delivery\nFormats: scene, excalidraw, png\nExcalidraw URL: https://studio.test/api/v1/artifacts/artifact_delivery?format=excalidraw&raw=true\nPNG URL: https://studio.test/api/v1/artifacts/artifact_delivery?format=png&raw=true",
				formats: [
					{
						format: "scene",
					},
					{
						format: "excalidraw",
						mimeType: "application/vnd.excalidraw+json",
						sizeBytes: 1234,
					},
					{
						format: "png",
						mimeType: "image/png",
						sizeBytes: 5678,
					},
				],
				pngUrl: "https://studio.test/api/v1/artifacts/artifact_delivery?format=png&raw=true",
				sceneUrl: "https://studio.test/api/v1/artifacts/artifact_delivery?format=scene&raw=true",
			},
			finalResponseText:
				"Sketchi artifact ready.\nArtifact ID: artifact_delivery\nDiagram ID: diagram_delivery\nFormats: scene, excalidraw, png\nExcalidraw URL: https://studio.test/api/v1/artifacts/artifact_delivery?format=excalidraw&raw=true\nPNG URL: https://studio.test/api/v1/artifacts/artifact_delivery?format=png&raw=true",
			ok: true,
		});
		expect(result.artifactDelivery?.finalResponseInstruction).toContain(
			"Paste artifactDelivery.finalResponseText",
		);
	});

	it("captures MCP execute usage events in the artifact bucket", async () => {
		const bucket = new MemoryBucket();
		const usageEventsPipeline = new MemoryPipeline();
		const request = new Request("https://studio.test/mcp", {
			method: "POST",
			headers: {
				"user-agent": "agy-test",
				"x-sketchi-harness": "agy",
				"x-sketchi-model": "gemini-3.5-flash",
				"x-sketchi-reasoning-level": "medium",
				"x-sketchi-scenario-id": "scenario-approval",
			},
		});

		const result = await executeSketchiCodeMode(
			{
				CODEMODE_USAGE_EVENTS: usageEventsPipeline,
				SKETCHI_ARTIFACTS: bucket,
			},
			{
				code: ACCEPTED_ARTIFACT_WITHOUT_URLS_CODE,
			},
			{
				executor: createInProcessExecutor(),
				origin: "https://studio.test",
				request,
			},
		);

		expect(result).toMatchObject({
			artifactDelivery: {
				artifactId: "artifact_without_urls",
			},
			ok: true,
		});

		const usageEvents = await waitForUsageEvents(bucket, 1);
		expect(usageEvents).toHaveLength(1);
		expect(usageEvents[0]).toMatchObject({
			artifactRefs: [
				{
					artifactId: "artifact_without_urls",
					diagramId: "diagram_without_urls",
				},
			],
			client: {
				harness: "agy",
				model: "gemini-3.5-flash",
				reasoningLevel: "medium",
				scenarioId: "scenario-approval",
				userAgent: "agy-test",
			},
			operation: "execute",
			request: {
				method: "POST",
				path: "/mcp",
			},
			schema: "sketchi.codemode.usage.v1",
			status: "ok",
			surface: "mcp",
		});
		if (!isRecord(usageEvents[0]) || !isRecord(usageEvents[0].request)) {
			throw new Error("Usage event did not include request metadata.");
		}
		if (!isRecord(usageEvents[0].request.body)) {
			throw new Error("Usage event did not include a request snapshot.");
		}
		expect(usageEvents[0].request.body.value).toMatchObject({
			code: ACCEPTED_ARTIFACT_WITHOUT_URLS_CODE,
		});

		const eventRows = await waitForPipelineRecords(usageEventsPipeline, 1);
		expect(eventRows[0]).toMatchObject({
			artifact_count: 1,
			artifact_delivery: true,
			artifact_formats: "scene,excalidraw,png",
			harness: "agy",
			issue_count: 0,
			model: "gemini-3.5-flash",
			operation: "execute",
			reasoning_level: "medium",
			request_method: "POST",
			request_path: "/mcp",
			scenario_id: "scenario-approval",
			schema: "sketchi.codemode.usage.v1",
			status: "ok",
			surface: "mcp",
			user_agent: "agy-test",
		});
		if (!isRecord(eventRows[0])) {
			throw new Error("Usage pipeline event row was not an object.");
		}
		expect(eventRows[0].event_key).toMatch(/^codemode\/usage\//);
		expect(eventRows[0].event_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
	});

	it("synthesizes artifactDelivery URLs from the MCP origin when formats omit URLs", async () => {
		const result = await executeSketchiCodeMode(
			{},
			{
				code: ACCEPTED_ARTIFACT_WITHOUT_URLS_CODE,
			},
			{
				executor: createInProcessExecutor(),
				origin: "https://studio.test",
			},
		);

		expect(result).toMatchObject({
			artifactDelivery: {
				artifactId: "artifact_without_urls",
				diagramId: "diagram_without_urls",
				excalidrawUrl:
					"https://studio.test/api/v1/artifacts/artifact_without_urls?format=excalidraw&raw=true",
				finalResponseText:
					"Sketchi artifact ready.\nArtifact ID: artifact_without_urls\nDiagram ID: diagram_without_urls\nFormats: scene, excalidraw, png\nExcalidraw URL: https://studio.test/api/v1/artifacts/artifact_without_urls?format=excalidraw&raw=true\nPNG URL: https://studio.test/api/v1/artifacts/artifact_without_urls?format=png&raw=true",
				formats: [
					{
						format: "scene",
						url: "https://studio.test/api/v1/artifacts/artifact_without_urls?format=scene&raw=true",
					},
					{
						format: "excalidraw",
						url: "https://studio.test/api/v1/artifacts/artifact_without_urls?format=excalidraw&raw=true",
					},
					{
						format: "png",
						url: "https://studio.test/api/v1/artifacts/artifact_without_urls?format=png&raw=true",
					},
				],
				pngUrl: "https://studio.test/api/v1/artifacts/artifact_without_urls?format=png&raw=true",
				sceneUrl:
					"https://studio.test/api/v1/artifacts/artifact_without_urls?format=scene&raw=true",
			},
			finalResponseText:
				"Sketchi artifact ready.\nArtifact ID: artifact_without_urls\nDiagram ID: diagram_without_urls\nFormats: scene, excalidraw, png\nExcalidraw URL: https://studio.test/api/v1/artifacts/artifact_without_urls?format=excalidraw&raw=true\nPNG URL: https://studio.test/api/v1/artifacts/artifact_without_urls?format=png&raw=true",
			ok: true,
		});
	});

	it("preserves existing artifactDelivery URLs while synthesizing missing ones", async () => {
		const result = await executeSketchiCodeMode(
			{},
			{
				code: ACCEPTED_ARTIFACT_WITH_MIXED_URLS_CODE,
			},
			{
				executor: createInProcessExecutor(),
				origin: "https://studio.test",
			},
		);

		expect(result).toMatchObject({
			artifactDelivery: {
				artifactId: "artifact_mixed_urls",
				diagramId: "diagram_mixed_urls",
				excalidrawUrl: "https://custom.test/excalidraw",
				finalResponseText:
					"Sketchi artifact ready.\nArtifact ID: artifact_mixed_urls\nDiagram ID: diagram_mixed_urls\nFormats: scene, excalidraw, png\nExcalidraw URL: https://custom.test/excalidraw\nPNG URL: https://studio.test/api/v1/artifacts/artifact_mixed_urls?format=png&raw=true",
				formats: [
					{
						format: "scene",
						url: "https://studio.test/api/v1/artifacts/artifact_mixed_urls?format=scene&raw=true",
					},
					{
						format: "excalidraw",
						url: "https://custom.test/excalidraw",
					},
					{
						format: "png",
						url: "https://studio.test/api/v1/artifacts/artifact_mixed_urls?format=png&raw=true",
					},
				],
				pngUrl: "https://studio.test/api/v1/artifacts/artifact_mixed_urls?format=png&raw=true",
				sceneUrl: "https://studio.test/api/v1/artifacts/artifact_mixed_urls?format=scene&raw=true",
			},
			ok: true,
		});
	});

	it("uses the injected MCP request origin when no override is supplied", async () => {
		const result = await executeSketchiCodeMode(
			{},
			{
				code: ACCEPTED_ARTIFACT_WITHOUT_URLS_CODE,
			},
			{
				executor: createInProcessExecutor(),
			},
		);

		expect(result).toMatchObject({
			artifactDelivery: {
				artifactId: "artifact_without_urls",
				diagramId: "diagram_without_urls",
				finalResponseText:
					"Sketchi artifact ready.\nArtifact ID: artifact_without_urls\nDiagram ID: diagram_without_urls\nFormats: scene, excalidraw, png\nExcalidraw URL: https://studio.test/api/v1/artifacts/artifact_without_urls?format=excalidraw&raw=true\nPNG URL: https://studio.test/api/v1/artifacts/artifact_without_urls?format=png&raw=true",
				formats: [
					{
						format: "scene",
					},
					{
						format: "excalidraw",
					},
					{
						format: "png",
					},
				],
			},
			finalResponseText:
				"Sketchi artifact ready.\nArtifact ID: artifact_without_urls\nDiagram ID: diagram_without_urls\nFormats: scene, excalidraw, png\nExcalidraw URL: https://studio.test/api/v1/artifacts/artifact_without_urls?format=excalidraw&raw=true\nPNG URL: https://studio.test/api/v1/artifacts/artifact_without_urls?format=png&raw=true",
			ok: true,
		});
		expect(result.artifactDelivery?.excalidrawUrl).toContain(
			"https://studio.test/api/v1/artifacts/",
		);
		expect(result.artifactDelivery?.pngUrl).toContain("https://studio.test/api/v1/artifacts/");
		expect(result.artifactDelivery?.sceneUrl).toContain("https://studio.test/api/v1/artifacts/");
	});
});

describe("MCP module-scope tool definitions", () => {
	it("binds new request handlers without regenerating any tool schema", async () => {
		const spies = [
			CodeModeDocsRequestSchema,
			CodeModeSearchRequestSchema,
			ExecuteRequestSchema,
		].map((schema) => vi.spyOn(schema["~standard"].jsonSchema, "input"));
		spies.push(
			...[CodeModeDocsResultSchema, CodeModeSearchResultSchema, ExecuteResultSchema].map((schema) =>
				vi.spyOn(schema["~standard"].jsonSchema, "output"),
			),
		);
		try {
			const first = await createSketchiMcpServer({});
			const second = await createSketchiMcpServer({});
			for (const spy of spies) expect(spy).not.toHaveBeenCalled();
			await first.close();
			await second.close();
		} finally {
			for (const spy of spies) spy.mockRestore();
		}
	});
});
