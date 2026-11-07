import type { TelemetrySpanRow } from "@sketchi/observability";
import { describe, expect, it, vi } from "vitest";
import { Effect } from "effect";

import {
	CodeModeHttpRequestError,
	handleBuildFlowchartRequest,
	handleBuildMindmapRequest,
	handleBuildSequenceDiagramRequest,
	handleCreateCanvasRequest,
	handlePatchArtifactRequest,
} from "../codemode/api.server";
import { McpTransportError } from "../codemode/mcp.server";
import { handleGenerateDiagramRequest } from "../generation/api.server";
import { PlaygroundCodeModeUsage } from "../codemode/usage-events.server";
import { PlaygroundPlatformCallbacks, PlaygroundRequestMetadata } from "./context.server";
import { readBoundedJson, RequestBodyReadError } from "./request-body.server";
import { makePlaygroundRuntime, runPlaygroundEffect } from "./runtime.server";

function boundary(request: Request) {
	return { env: {}, platform: { waitUntilPromise: () => undefined }, request };
}

describe("HTTP runtime boundaries", () => {
	it.each([
		{
			error: CodeModeHttpRequestError.make({
				cause: "private cause",
				message: "private error",
			}),
			status: 400,
		},
		{
			error: McpTransportError.make({
				cause: "private cause",
				message: "private error",
			}),
			status: 500,
		},
		{
			error: RequestBodyReadError.make({
				cause: "private cause",
				message: "private error",
			}),
			status: 400,
		},
	])("maps $error._tag and logs the error with its request metadata", async ({ error, status }) => {
		const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
		const runtime = makePlaygroundRuntime();
		try {
			const response = await runtime.run(
				Effect.fail(error),
				boundary(
					new Request("https://studio.test/mcp", {
						headers: { "x-sketchi-trace-id": "safe_trace" },
					}),
				),
			);
			expect(response.status).toBe(status);
			expect(response.headers.get("Cache-Control")).toBe("no-store");
			expect(await response.text()).not.toContain("private");
			await runtime.dispose();
			expect(log).toHaveBeenCalledWith(
				"Playground HTTP request failed",
				expect.objectContaining({
					type: "log",
					level: "Error",
					fields: { error_tag: error._tag },
					annotations: expect.objectContaining({
						"request.route": "/mcp",
						"sketchi.trace_id": "safe_trace",
					}),
				}),
			);
		} finally {
			await runtime.dispose();
			log.mockRestore();
		}
	});
	it.each([
		handleBuildFlowchartRequest,
		handleBuildMindmapRequest,
		handleBuildSequenceDiagramRequest,
		handleCreateCanvasRequest,
		handleGenerateDiagramRequest,
		(request: Request) => handlePatchArtifactRequest(request, "id"),
	])("maps a failed body stream through the real handler", async (handler) => {
		const stream = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.error(new Error("private body failure"));
			},
		});
		const init: RequestInit & { duplex: "half" } = {
			method: "POST",
			body: stream,
			duplex: "half",
		};
		const request = new Request("https://studio.test/api/chat", init);
		const response = await runPlaygroundEffect(handler(request), boundary(request));
		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({
			ok: false,
			error: "The request body could not be read.",
		});
	});
	it.each(["bad/id", "bad.id", "x".repeat(65), "", "bad id"])(
		"replaces invalid correlation header %s",
		async (value) => {
			const request = new Request("https://studio.test/mcp", {
				headers: {
					"x-sketchi-run-id": value,
					"x-sketchi-attempt-id": value,
					"x-sketchi-trace-id": value,
				},
			});
			const result = await runPlaygroundEffect(
				Effect.gen(function* () {
					const usage = yield* PlaygroundCodeModeUsage;
					const metadata = yield* PlaygroundRequestMetadata;
					return { ...(yield* usage.createContext), traceId: metadata.traceId };
				}),
				boundary(request),
			);
			expect(result.runId).toMatch(/^run_[A-Za-z0-9_-]+$/);
			expect(result.attemptId).toMatch(/^attempt_[A-Za-z0-9_-]+$/);
			expect(result.traceId).toMatch(/^trace_[A-Za-z0-9_-]+$/);
		},
	);
	it("preserves valid IDs through the 64-character boundary", async () => {
		const value = "A_" + "x".repeat(62);
		const request = new Request("https://studio.test/mcp", {
			headers: {
				"x-sketchi-run-id": value,
				"x-sketchi-attempt-id": value,
				"x-sketchi-trace-id": value,
			},
		});
		const result = await runPlaygroundEffect(
			Effect.gen(function* () {
				const usage = yield* PlaygroundCodeModeUsage;
				const metadata = yield* PlaygroundRequestMetadata;
				return { ...(yield* usage.createContext), traceId: metadata.traceId };
			}),
			boundary(request),
		);
		expect(result).toMatchObject({
			runId: value,
			attemptId: value,
			traceId: value,
		});
	});
});

describe("request spans", () => {
	function exportingBoundary(request: Request) {
		const sends: TelemetrySpanRow[][] = [];
		const pending: Promise<unknown>[] = [];
		return {
			boundary: {
				env: {
					TELEMETRY_SPANS: {
						send: async (rows: readonly unknown[]) => {
							sends.push(rows as TelemetrySpanRow[]);
						},
					},
				},
				platform: { waitUntilPromise: (promise: Promise<unknown>) => pending.push(promise) },
				request,
			},
			pending,
			sends,
		};
	}
	const attributes = (row: TelemetrySpanRow | undefined) =>
		JSON.parse(row?.attributes ?? "{}") as Record<string, unknown>;

	it("sends the request's spans, its bodies and its ray ID in one batch", async () => {
		const request = new Request("https://studio.test/api/v1/flowcharts/build", {
			body: JSON.stringify({ prompt: "two boxes" }),
			headers: {
				authorization: "Bearer credential",
				"cf-ray": "8f1a2b3c4d5e6f70-DFW",
				"content-type": "application/json",
				cookie: "session=credential",
			},
			method: "POST",
		});
		const { boundary: exporting, pending, sends } = exportingBoundary(request);
		const response = await runPlaygroundEffect(
			Effect.gen(function* () {
				const body = yield* readBoundedJson(request, 1_000);
				return Response.json({ echoed: body });
			}),
			exporting,
		);
		expect(await response.json()).toEqual({
			echoed: { _tag: "Body", body: { prompt: "two boxes" } },
		});
		await Promise.all(pending);
		expect(sends).toHaveLength(1);
		const rows = sends[0] ?? [];
		const root = rows.find((row) => row.name === "playground.request");
		expect(root?.ray_id).toBe("8f1a2b3c4d5e6f70-DFW");
		expect(rows.every((row) => row.ray_id === root?.ray_id)).toBe(true);
		expect(attributes(root)["http.response.body"]).toBe(
			'{"echoed":{"_tag":"Body","body":{"prompt":"two boxes"}}}',
		);
		expect(attributes(root)["http.request.headers"]).toEqual({
			"cf-ray": "8f1a2b3c4d5e6f70-DFW",
			"content-type": "application/json",
		});
		const read = rows.find((row) => row.name === "playground.http.readBoundedJson");
		expect(attributes(read)["http.request.body"]).toBe('{"prompt":"two boxes"}');
		expect(read?.parent_span_id).toBe(root?.span_id);
	});

	it("gives every span of a request, deferred work and streams included, its IDs", async () => {
		const request = new Request("https://studio.test/api/chat", {
			headers: {
				"cf-ray": "8f1a2b3c4d5e6f71-DFW",
				"content-type": "application/json",
				"x-sketchi-run-id": "run_from_header",
			},
			method: "POST",
		});
		const { boundary: exporting, pending, sends } = exportingBoundary(request);
		const response = await runPlaygroundEffect(
			Effect.gen(function* () {
				const platform = yield* PlaygroundPlatformCallbacks;
				const metadata = yield* PlaygroundRequestMetadata;
				platform.waitUntil(Effect.void.pipe(Effect.withSpan("test.deferred.work")));
				yield* Effect.logInfo("handled");
				return new Response(`data: ${metadata.attemptId}\n\n`, {
					headers: { "content-type": "text/event-stream" },
				});
			}),
			exporting,
		);
		const attemptId = (await response.text()).slice("data: ".length).trim();
		await Promise.all(pending);
		const rows = sends.flat();
		expect(rows.map((row) => row.name)).toEqual(
			expect.arrayContaining([
				"playground.request",
				"playground.request.deferred",
				"playground.response.stream",
				"test.deferred.work",
			]),
		);
		expect(attemptId).toMatch(/^attempt_/);
		for (const row of rows) {
			expect(row, row.name).toMatchObject({
				attempt_id: attemptId,
				ray_id: "8f1a2b3c4d5e6f71-DFW",
				run_id: "run_from_header",
			});
		}
	});

	it("records a streamed response once it ends, without holding the response", async () => {
		const encoder = new TextEncoder();
		const chunks = ["data: one\n\n", "data: two\n\n"];
		const request = new Request("https://studio.test/api/chat", { method: "POST" });
		const { boundary: exporting, pending, sends } = exportingBoundary(request);
		const response = await runPlaygroundEffect(
			Effect.succeed(
				new Response(
					new ReadableStream<Uint8Array>({
						pull(controller) {
							const chunk = chunks.shift();
							if (chunk) controller.enqueue(encoder.encode(chunk));
							else controller.close();
						},
					}),
					{ headers: { "content-type": "text/event-stream" } },
				),
			),
			exporting,
		);
		expect(sends.map((rows) => rows.map((row) => row.name))).toEqual([["playground.request"]]);
		expect(await response.text()).toBe("data: one\n\ndata: two\n\n");
		await Promise.all(pending);
		const stream = sends.flat().find((row) => row.name === "playground.response.stream");
		expect(attributes(stream)["http.response.body"]).toBe("data: one\n\ndata: two\n\n");
		expect(attributes(stream)["http.response.body.complete"]).toBeUndefined();
	});

	it("passes a client's cancel through to the stream's source", async () => {
		let cancelled = false;
		const request = new Request("https://studio.test/mcp", { method: "POST" });
		const { boundary: exporting, pending, sends } = exportingBoundary(request);
		const response = await runPlaygroundEffect(
			Effect.succeed(
				new Response(
					new ReadableStream<Uint8Array>({
						cancel() {
							cancelled = true;
						},
						start(controller) {
							controller.enqueue(new TextEncoder().encode("data: partial\n\n"));
						},
					}),
					{ headers: { "content-type": "text/event-stream" } },
				),
			),
			exporting,
		);
		const reader = response.body?.getReader();
		await reader?.read();
		await reader?.cancel("client left");
		expect(cancelled).toBe(true);
		await Promise.all(pending);
		const stream = sends.flat().find((row) => row.name === "playground.response.stream");
		expect(attributes(stream)).toMatchObject({
			"http.response.body": "data: partial\n\n",
			"http.response.body.complete": false,
		});
	});
});
