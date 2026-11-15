// @vitest-environment node
import { describe, expect, it } from "@effect/vitest";
import { Effect, Fiber, Layer, Schema } from "effect";
import { TestClock } from "effect/testing";
import type { StudioEnv } from "../../server/bindings/studio-env.server";
import { McpProtocol, McpServer, McpTest } from "effect/ai";
import {
	PlaygroundBindings,
	PlaygroundClockLive,
	PlaygroundIdsLive,
	PlaygroundRequestMetadata,
} from "../../server/runtime/context.server";
import { StudioBuildHostLive } from "../build/capabilities.server";
import { PlaygroundCodeModeUsageLive } from "../build/usage-events.server";
import { ExecuteResultSchema } from "./execute.server";
import { CodeModeSandbox, type SandboxFunctions, type SandboxResult } from "./sandbox.server";
import { StudioMcpRegistrations } from "./mcp.server";

const host = Layer.mergeAll(
	StudioBuildHostLive,
	PlaygroundClockLive,
	PlaygroundIdsLive,
	PlaygroundCodeModeUsageLive,
);
type PolicyServices =
	| Layer.Success<typeof host>
	| PlaygroundBindings
	| PlaygroundRequestMetadata
	| CodeModeSandbox;
const clientFor = (
	scenario: (functions: SandboxFunctions) => Promise<SandboxResult>,
	env: StudioEnv = {},
) =>
	McpTest.makeClient(
		StudioMcpRegistrations.pipe(
			Layer.provide(
				McpServer.middleware<{ provides: PolicyServices }>()((effect) =>
					effect.pipe(
						Effect.provide(host),
						Effect.provideService(PlaygroundBindings, env),
						Effect.provideService(PlaygroundRequestMetadata, {
							request: new Request("https://studio.test/mcp"),
							origin: "https://studio.test",
							path: "/mcp",
							method: "POST",
							attemptId: "attempt-policy",
							runId: "run-policy",
							traceId: "trace-policy",
						}),
						Effect.provideService(CodeModeSandbox, {
							execute: (_code, functions) => Effect.promise(() => scenario(functions)),
						}),
					),
				).layer,
			),
		),
		{ name: "studio-policy", version: "1", protocols: [McpProtocol.v2025_11_25] },
	);

const request = {
	spec: { title: "Receipts", root: { label: "Root", children: [{ label: "Child" }] } },
	options: { artifactFormats: ["scene", "excalidraw"] },
};
const execute = (client: McpTest.Client) =>
	client
		.callTool({ name: "execute", arguments: { code: "async () => {}" } })
		.pipe(
			Effect.flatMap((result) =>
				Schema.decodeUnknownEffect(ExecuteResultSchema)(result.structuredContent),
			),
		);

/** These control the sandbox capability only. Actual WorkerLoader/HTTP proof lives at the Worker entrypoint. */
describe("Studio MCP receipt and delivery policy", () => {
	it.effect("keeps discovery compact and serves readable runnable docs and actionable errors", () =>
		Effect.gen(function* () {
			const client = yield* clientFor(async () => ({ result: undefined }));
			const tools = yield* client.listTools();
			expect(tools.tools.map((tool) => tool.name).sort()).toEqual(["docs", "execute", "search"]);
			expect(new TextEncoder().encode(JSON.stringify(tools)).byteLength).toBeLessThan(30_000);
			const docs = yield* client.callTool({ name: "docs", arguments: { topic: "buildMindmap" } });
			expect(docs.content[0]).toMatchObject({
				type: "text",
				text: expect.stringContaining("sketchi.buildMindmap"),
			});
			const invalid = yield* client.callTool({ name: "execute", arguments: { code: "" } });
			expect(invalid).toMatchObject({
				isError: true,
				content: [{ text: expect.stringContaining("code") }],
			});
		}),
	);

	for (const ending of ["absent", "null", "error"] as const) {
		it.effect(`retains persisted accepted receipts and logs after ${ending}`, () =>
			Effect.gen(function* () {
				let artifact: unknown;
				const client = yield* clientFor(async (functions) => {
					const build = functions.buildMindmap;
					if (!build) throw new Error("Missing buildMindmap");
					artifact = await build(request);
					return {
						result: ending === "null" ? null : undefined,
						...(ending === "error" ? { error: "after accepted build" } : {}),
						logs: ["accepted"],
					};
				});
				const output = yield* execute(client);
				expect(artifact).toMatchObject({ ok: true });
				expect(output).toMatchObject({
					ok: ending !== "error",
					logs: ["accepted"],
					builds: [
						{
							index: 0,
							ok: true,
							operation: "buildMindmap",
							artifact: { artifactId: expect.any(String) },
						},
					],
				});
				expect(Object.hasOwn(output, "result")).toBe(ending === "null");
				expect(output.result).toBe(ending === "null" ? null : undefined);
			}),
		);
	}

	it.effect(
		"keeps immutable call order and selected earlier delivery while preserving custom returns",
		() =>
			Effect.gen(function* () {
				const client = yield* clientFor(async (functions) => {
					const build = functions.buildMindmap;
					if (!build) throw new Error("Missing buildMindmap");
					const first = await build(request);
					await build({ ...request, spec: { ...request.spec, title: "Second" } });
					return { result: first };
				});
				const output = yield* execute(client);
				expect(output.builds.map((build) => build.index)).toEqual([0, 1]);
				expect(output.artifactDelivery?.artifactId).toBe(output.builds[0]?.artifact?.artifactId);
				expect(output.result).toMatchObject({
					buildId: output.builds[0]?.buildId,
					artifactId: output.builds[0]?.artifact?.artifactId,
				});
				expect(JSON.stringify(output.builds)).not.toContain('"inline":');
			}),
	);

	it.effect("reports rejected attempts and preserves unrelated script data", () =>
		Effect.gen(function* () {
			const client = yield* clientFor(async (functions) => {
				const build = functions.buildMindmap;
				if (!build) throw new Error("Missing buildMindmap");
				await build({ spec: {} });
				return { result: { custom: "kept" } };
			});
			const output = yield* execute(client);
			expect(output.result).toEqual({ custom: "kept" });
			expect(output.builds).toMatchObject([{ index: 0, ok: false, issues: expect.any(Array) }]);
			expect(output.builds[0]?.issues.length).toBeGreaterThan(0);
			expect(output.artifactDelivery).toBeUndefined();
		}),
	);

	it.effect("keeps optional PNG failure separate from an explicitly required export", () =>
		Effect.gen(function* () {
			const client = yield* clientFor(async (functions) => {
				const build = functions.buildMindmap;
				if (!build) throw new Error("Missing buildMindmap");
				const optional = await build({ spec: request.spec });
				await build({ spec: request.spec, options: { artifactFormats: ["png"] } });
				return { result: optional };
			});
			const output = yield* execute(client);
			expect(output.builds[0]).toMatchObject({
				ok: true,
				issues: expect.arrayContaining([expect.objectContaining({ code: "png_unavailable" })]),
			});
			expect(output.builds[1]).toMatchObject({ ok: false, status: "export_failed" });
			expect(output.finalResponseText).toContain("PNG unavailable");
		}),
	);
	it.effect(
		"shares the default PNG deadline and never renders invalid or explicitly omitted output",
		() =>
			Effect.gen(function* () {
				let renderCalls = 0;
				const started = Promise.withResolvers<void>();
				const client = yield* clientFor(
					async (functions) => {
						await functions.buildMindmap!({ spec: {} });
						await functions.buildMindmap!(request);
						const first = await functions.buildMindmap!({
							spec: request.spec,
							options: { inlineArtifacts: [] },
						});
						await functions.buildMindmap!({ spec: request.spec });
						return { result: first };
					},
					{
						CODEMODE_PNG_RENDERER: {
							getByName: () => ({
								renderPng: () => {
									renderCalls++;
									started.resolve();
									return new Promise<never>(() => {});
								},
							}),
						},
					},
				);
				const pending = yield* execute(client).pipe(Effect.forkChild);
				yield* Effect.promise(() => started.promise);
				yield* TestClock.adjust(15_000);
				const output = yield* Fiber.join(pending);
				expect(renderCalls).toBe(1);
				expect(output.builds.map((build) => build.ok)).toEqual([false, true, true, true]);
				expect(output.builds[1]?.issues.some((issue) => issue.code === "png_unavailable")).toBe(
					false,
				);
				for (const build of output.builds.slice(2)) {
					expect(build.issues).toEqual(
						expect.arrayContaining([expect.objectContaining({ code: "png_unavailable" })]),
					);
				}
				expect(output.artifactDelivery?.artifactId).toBe(output.builds[2]?.artifact?.artifactId);
				expect(output.finalResponseText).toContain("PNG unavailable");
			}),
	);

	it.effect("does not attach a failed later patch warning to the selected earlier artifact", () =>
		Effect.gen(function* () {
			const client = yield* clientFor(async (functions) => {
				const built = (await functions.buildMindmap!(request)) as {
					artifact: { artifactId: string };
				};
				const patched = await functions.applyDiagramPatch!({
					source: { artifactId: built.artifact.artifactId },
					operations: [{ op: "rerouteEdges" }],
					options: { artifactFormats: ["png"] },
				});
				return { result: { built, patched } };
			});
			const output = yield* execute(client);
			expect(output.result).toMatchObject({ patched: { ok: false, status: "export_failed" } });
			expect(output.artifactDelivery?.artifactId).toBe(output.builds[0]?.artifact?.artifactId);
			expect(output.finalResponseText).not.toContain("PNG unavailable");
		}),
	);

	it.effect("requests one coverage repair and delivers the edit without another repair loop", () =>
		Effect.gen(function* () {
			const flow = {
				request: "flowchart: intake → triage → web + phone support → close ticket",
				spec: {
					title: "Support",
					nodes: {
						intake: "Intake",
						triage: "Triage",
						web: "Web support",
						phone: "Phone support",
						close: "Close ticket",
					},
					edges: [
						["intake", "triage"],
						["triage", ["web", "phone"]],
						["web", "close"],
						["phone", "triage"],
					],
				},
				options: request.options,
			};
			for (const edit of [false, true]) {
				const client = yield* clientFor(async (functions) => {
					const built = (await functions.buildFlowchart!(flow)) as {
						artifact: { artifactId: string };
					};
					return {
						result: edit
							? await functions.editFlowchart!({
									artifactId: built.artifact.artifactId,
									edits: [{ op: "set", nodes: { close: { color: "green" } } }],
									request: flow.request,
									options: request.options,
								})
							: built,
					};
				});
				const wire = yield* client.callTool({
					name: "execute",
					arguments: { code: "async () => {}" },
				});
				const output = yield* Schema.decodeUnknownEffect(ExecuteResultSchema)(
					wire.structuredContent,
				);
				if (edit) {
					expect(output.coverageNotice).toBeUndefined();
					expect(wire.content[0]).toMatchObject({
						text: expect.stringContaining("Sketchi artifact ready"),
					});
				} else {
					expect(output.coverageNotice).toContain("phone support → close ticket");
					expect(output.finalResponseText).toBeUndefined();
					expect(wire.content[0]).toMatchObject({
						text: expect.stringContaining("sketchi.editFlowchart"),
					});
				}
			}
		}),
	);
	it.effect("freezes completed and incomplete receipts when the sandbox times out", () =>
		Effect.gen(function* () {
			const started = Promise.withResolvers<void>();
			let pending: Promise<unknown> | undefined;
			const client = yield* clientFor(
				async (functions) => {
					await functions.buildMindmap!(request);
					pending = functions.buildMindmap!({ spec: request.spec }).catch(() => undefined);
					await started.promise;
					return { result: undefined, error: "Execution timed out" };
				},
				{
					CODEMODE_PNG_RENDERER: {
						getByName: () => ({
							renderPng: () => {
								started.resolve();
								return new Promise<never>(() => {});
							},
						}),
					},
				},
			);
			const output = yield* execute(client);
			expect(output).toMatchObject({
				ok: false,
				error: "Execution timed out",
				builds: [{ ok: true }, { ok: false, status: "incomplete" }],
			});
			const frozen = structuredClone(output);
			yield* Effect.promise(() => pending ?? Promise.resolve());
			expect(output).toEqual(frozen);
		}),
	);
});
