import { Effect, Schema } from "effect";
import { describe, expect, it } from "vitest";

import { DiagramGenerationRequest } from "./candidates.js";

const request = {
	model: "google/gemini-3.1-flash-lite",
	prompt: { id: "boundary", request: "Create a diagram" },
};

describe("generation request boundaries", () => {
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
});
