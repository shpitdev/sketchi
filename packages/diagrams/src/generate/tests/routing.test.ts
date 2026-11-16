import { describe, expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";

import { DIAGRAM_TYPES } from "../../family.js";
import type { DiagramGenerationRequest } from "../candidates.js";
import { DiagramFamilyNarrowing, workersAiFamilyNarrowingLayer } from "../family-narrowing.js";
import type { WorkersAiRunner } from "../jev-workers-ai.js";
import { buildDiagramGenerationMessages } from "../messages.js";
import { withNarrowedFamilyRoute } from "../routing.js";

const JevRequest = Schema.Struct({
	questions: Schema.Record(
		Schema.String,
		Schema.Struct({
			type: Schema.String,
			criteria: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
		}),
	),
});

/** A Workers AI binding, with the binding's native Promise contract, that records each call. */
function binding(respond: (input: typeof JevRequest.Type) => Promise<unknown>) {
	const calls: { model: string; input: unknown }[] = [];
	const ai: WorkersAiRunner = {
		run: (model, input) => {
			calls.push({ model, input });
			return Schema.decodeUnknownPromise(JevRequest)(input).then(respond);
		},
	};
	return { ai, calls };
}

/** Jev answering timeline, sure of it, to every question. */
const sureOfTimeline = async ({ questions }: typeof JevRequest.Type) => ({
	model: "jev-1.14.0",
	answers: Object.fromEntries(
		Object.entries(questions).map(([key, question]) => {
			if (question.type === "noul")
				return [key, { type: "noul", noul: key === "any" ? 0.95 : 0.05 }];
			const labels = Object.keys(question.criteria ?? {});
			const probabilities = Object.fromEntries(
				labels.map((label) => [label, label === "timeline" ? 0.9 : 0.1 / (labels.length - 1)]),
			);
			return [key, { type: "choice", choice: "timeline", confidence: 0.9, probabilities }];
		}),
	),
	usage: { input_tokens: 10, output_tokens: 2 },
});

const route = (request: DiagramGenerationRequest, ai: WorkersAiRunner) =>
	Effect.gen(function* () {
		const narrowing = yield* DiagramFamilyNarrowing;
		return yield* withNarrowedFamilyRoute(request, narrowing);
	}).pipe(Effect.provide(workersAiFamilyNarrowingLayer({ ai, timeoutMs: 50 })));

const untyped = (request: string): DiagramGenerationRequest => ({
	model: "m",
	prompt: { id: "x", request },
});

const ruleSections = (request: DiagramGenerationRequest["prompt"]) =>
	buildDiagramGenerationMessages(request)
		.system.split("\n")
		.filter((line) => line.endsWith(" rules:")).length;

describe("routing a request to its family", () => {
	it.effect("decides an untyped request's family through Jev on Workers AI", () =>
		Effect.gen(function* () {
			const { ai, calls } = binding(sureOfTimeline);
			const routed = yield* route(untyped("When each release ships"), ai);
			expect(routed.route).toEqual({ cue: "jev", family: "timeline" });
			expect(routed.request.prompt.routedType).toBe("timeline");
			expect(calls.length).toBeGreaterThan(0);
			expect(calls.every((call) => call.model === "typesafe/jev-1.14.0")).toBe(true);
		}),
	);

	for (const [name, respond] of [
		["fails", () => Promise.reject(new Error("Rate limit exceeded"))],
		["never answers", () => new Promise<never>(() => {})],
	] as const) {
		it.live(`routes by the words alone when Jev ${name}`, () =>
			Effect.gen(function* () {
				const routed = yield* route(untyped("Our deployment pipeline."), binding(respond).ai);
				expect(routed.narrowing?._tag).toBe("Failed");
				expect(routed.route).toEqual({ cue: "shaped", family: "flowchart" });
			}),
		);
	}

	it.effect(
		"sends one family's rules and asks Jev nothing for a typed, revising or named request",
		() =>
			Effect.gen(function* () {
				const { ai, calls } = binding(sureOfTimeline);
				const typed = yield* route(
					{ model: "m", prompt: { id: "x", request: "a b c", requestedType: "mindmap" } },
					ai,
				);
				yield* route(
					{ model: "m", prompt: { id: "x", request: "add c", base: { type: "flowchart" } } },
					ai,
				);
				const named = yield* route(
					untyped("ER diagram of: create table users (id int primary key)"),
					ai,
				);
				expect(calls).toEqual([]);
				expect(named.route).toEqual({ cue: "named", family: "er" });
				expect(ruleSections(typed.request.prompt)).toBe(1);
				expect(ruleSections(named.request.prompt)).toBe(1);
				expect(ruleSections(untyped("draw it").prompt)).toBe(DIAGRAM_TYPES.length);
			}),
	);
});
