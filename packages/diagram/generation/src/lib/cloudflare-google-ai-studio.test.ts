import { describe, expect, it } from "vitest";
import { Cause, Effect, Exit, Fiber, Layer, Schema } from "effect";

import { DiagramGenerationRequest } from "./candidates.js";
import { DiagramGenerationClient, DiagramGenerationPolicyLive } from "./client.js";
import {
	CloudflareAiGatewayBinding,
	CloudflareGoogleAiStudioClientLive,
	CloudflareGoogleAiStudioConfig,
	type CloudflareAiGateway,
} from "./cloudflare-google-ai-studio.js";

function clientLayer(run: CloudflareAiGateway["run"]) {
	return CloudflareGoogleAiStudioClientLive.pipe(
		Layer.provide(
			Layer.mergeAll(
				Layer.succeed(CloudflareAiGatewayBinding, {
					gateway: () => ({
						run,
						getUrl: () => Promise.resolve("https://gateway.invalid"),
					}),
				}),
				Layer.succeed(CloudflareGoogleAiStudioConfig, {
					collectLog: true,
					gatewayId: "test",
				}),
				DiagramGenerationPolicyLive,
			),
		),
	);
}

const request = {
	model: "google/gemini-2.5-flash",
	prompt: { id: "boundary", request: "Create a diagram" },
};

describe("Google AI Studio boundaries", () => {
	it.each([
		"gemini-2.5-flash:countTokens?x=",
		"google/../model",
		"google/",
		"x".repeat(129),
		"google/" + "x".repeat(129),
	])("rejects unsafe model %s at the request schema", async (model) => {
		const error = await Effect.runPromise(
			Schema.decodeUnknownEffect(DiagramGenerationRequest)({
				...request,
				model,
			}).pipe(Effect.flip),
		);
		expect(error._tag).toBe("SchemaError");
	});
	it.each([
		"gemini-2.5-flash",
		"google/gemini-2.5-flash",
		"google-ai-studio/gemini-2.5-flash",
		"x".repeat(128),
	])("accepts safe model %s", async (model) => {
		const decoded = await Effect.runPromise(
			Schema.decodeUnknownEffect(DiagramGenerationRequest)({
				...request,
				model,
			}),
		);
		expect(decoded.model).toBe(model);
	});
	it("encodes the route segment even for a caller bypassing schema decoding", async () => {
		let endpoint: string | undefined;
		const layer = clientLayer(async (data) => {
			endpoint = data.endpoint;
			return Response.json({
				candidates: [
					{
						content: {
							parts: [
								{
									text: JSON.stringify({
										title: "Unsupported",
										intent: {
											requestedKind: "er",
											nativeKind: null,
											requirements: [],
										},
									}),
								},
							],
						},
					},
				],
			});
		});
		await Effect.runPromise(
			Effect.flatMap(DiagramGenerationClient, (client) =>
				client.generate({ ...request, model: "google/gemini:countTokens?x=" }),
			).pipe(Effect.provide(layer)),
		);
		expect(endpoint).toBe("v1beta/models/gemini%3AcountTokens%3Fx%3D:generateContent");
	});
	it("keeps the gateway signal alive while the response body is consumed", async () => {
		const reading = Promise.withResolvers<void>();
		let gatewaySignal: AbortSignal | undefined;
		class PendingResponse extends Response {
			override text(): Promise<string> {
				reading.resolve();
				return super.text();
			}
		}
		const layer = clientLayer(async (_data, options) => {
			const signal = options?.signal;
			if (!signal) throw new Error("Expected a gateway signal");
			gatewaySignal = signal;
			return new PendingResponse(
				new ReadableStream<Uint8Array>({
					start(controller) {
						signal.addEventListener("abort", () => controller.error(new Error("body aborted")), {
							once: true,
						});
					},
				}),
			);
		});
		const fiber = Effect.runFork(
			Effect.flatMap(DiagramGenerationClient, (client) => client.generate(request)).pipe(
				Effect.provide(layer),
			),
		);
		await reading.promise;
		await Effect.runPromise(Fiber.interrupt(fiber));
		const exit = await Effect.runPromise(Fiber.await(fiber));
		expect(Exit.isFailure(exit) && Cause.hasInterrupts(exit.cause)).toBe(true);
		expect(gatewaySignal?.aborted).toBe(true);
	});
});
