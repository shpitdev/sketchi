import type { CloudflareAiGatewayProvider } from "@sketchi/cloudflare/ai-gateway";
import type { SupportedGenerationModel } from "@sketchi/diagrams/generate/models";
import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";

import type { StudioEnv } from "../bindings/studio-env.server";
import { PlaygroundGeneration } from "../generation/service.server";
import { makePlaygroundRuntime } from "./runtime.server";

const lifecycle = vi.hoisted(() => ({
	generationBuilt: 0,
	generationClosed: 0,
}));

vi.mock("@sketchi/diagrams/generate/cloudflare-gateway-chat", async (importOriginal) => {
	const { Effect, Layer } = await import("effect");
	const actual =
		await importOriginal<typeof import("@sketchi/diagrams/generate/cloudflare-gateway-chat")>();
	return {
		...actual,
		CloudflareGatewayChatClientLive: actual.CloudflareGatewayChatClientLive.pipe(
			Layer.tap(() =>
				Effect.gen(function* () {
					lifecycle.generationBuilt += 1;
					yield* Effect.addFinalizer(() =>
						Effect.sync(() => {
							lifecycle.generationClosed += 1;
						}),
					);
				}),
			),
		),
	};
});

function boundary(env: StudioEnv, request = new Request("https://studio.test/api/v1/generate")) {
	return { env, request, platform: { waitUntilPromise: () => undefined } };
}

function fakeAi(calls: { gatewayId: string; model: unknown }[]): CloudflareAiGatewayProvider {
	return {
		gateway: (gatewayId) => ({
			getUrl: () => Promise.resolve("https://gateway.invalid"),
			run: (input) => {
				const { model } = input.query as { readonly model?: unknown };
				calls.push({ gatewayId, model });
				// Permanent offline failure exercises client provisioning without retries or live AI.
				return Promise.resolve(new Response("unauthorized", { status: 401 }));
			},
		}),
	};
}

const generate = (model?: SupportedGenerationModel) =>
	Effect.gen(function* () {
		const generation = yield* PlaygroundGeneration;
		return yield* Effect.result(
			generation.generate({
				prompt: "A release approval flow",
				...(model ? { model } : {}),
			}),
		);
	});

describe("binding-dependent host lifecycles", () => {
	it("builds one generation client per AI binding/gateway and closes only with its host", async () => {
		const before = { ...lifecycle };
		const runtime = makePlaygroundRuntime();
		const calls: { gatewayId: string; model: unknown }[] = [];
		const ai = fakeAi(calls);
		try {
			await Promise.all([
				runtime.run(
					generate(),
					boundary({
						AI: ai,
						SKETCHI_AI_GATEWAY_ID: " shared ",
						SKETCHI_AI_GENERATE_MODEL: "google/model-a",
					}),
				),
				runtime.run(
					generate("google/gemini-3.1-flash-lite"),
					boundary({
						AI: ai,
						SKETCHI_AI_GATEWAY_ID: "shared",
						SKETCHI_AI_GENERATE_MODEL: "google/model-b",
					}),
				),
			]);
			await runtime.run(
				generate(),
				boundary({
					AI: ai,
					SKETCHI_AI_GATEWAY_ID: "shared",
					SKETCHI_AI_GENERATE_MODEL: "google/model-b",
				}),
			);
			expect(lifecycle.generationBuilt - before.generationBuilt).toBe(1);
			expect(lifecycle.generationClosed).toBe(before.generationClosed);
			expect(calls.map((call) => call.gatewayId)).toEqual(["shared", "shared", "shared"]);
			expect(calls.map((call) => call.model)).toHaveLength(3);
			expect(calls.map((call) => call.model)).toEqual(
				expect.arrayContaining(["model-a", "model-b"]),
			);
			await runtime.run(generate(), boundary({ AI: ai, SKETCHI_AI_GATEWAY_ID: "other" }));
			await runtime.run(
				generate(),
				boundary({ AI: fakeAi(calls), SKETCHI_AI_GATEWAY_ID: "shared" }),
			);
			expect(lifecycle.generationBuilt - before.generationBuilt).toBe(3);
			expect(lifecycle.generationClosed).toBe(before.generationClosed);
		} finally {
			await runtime.dispose();
		}
		expect(lifecycle.generationClosed - before.generationClosed).toBe(3);

		const nextHost = makePlaygroundRuntime();
		try {
			await nextHost.run(generate(), boundary({ AI: ai, SKETCHI_AI_GATEWAY_ID: "shared" }));
			expect(lifecycle.generationBuilt - before.generationBuilt).toBe(4);
		} finally {
			await nextHost.dispose();
		}
		expect(lifecycle.generationClosed - before.generationClosed).toBe(4);
	});

	it("builds one generation client per route on the same gateway", async () => {
		const before = { ...lifecycle };
		const runtime = makePlaygroundRuntime();
		const calls: { gatewayId: string; model: unknown }[] = [];
		const ai = fakeAi(calls);
		const haiku = boundary({ AI: ai, SKETCHI_AI_GENERATE_MODEL: "anthropic/claude-haiku-5-5" });
		const google = boundary({ AI: ai, SKETCHI_AI_GENERATE_MODEL: "google/gemini-3.1-flash-lite" });
		try {
			await runtime.run(generate(), haiku);
			await runtime.run(generate(), google);
			await runtime.run(generate(), haiku);
			expect(lifecycle.generationBuilt - before.generationBuilt).toBe(2);
			expect(calls.map((call) => call.model)).toEqual([
				"claude-haiku-5-5",
				"gemini-3.1-flash-lite",
				"claude-haiku-5-5",
			]);
		} finally {
			await runtime.dispose();
		}
	});
});
