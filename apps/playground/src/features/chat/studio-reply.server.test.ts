import { applyChatEvent, emptyChat } from "./chat-client";
import { chatMessageViews } from "./chat-message";
import { deriveBuildState } from "./build-result";
import { describe, expect, it } from "@effect/vitest";
import { Deferred, Effect, Fiber, Stream, Schema } from "effect";
import { AgUi, IdGenerator, Chat, LanguageModel, Response, Tool, Toolkit } from "effect/ai";
import { studioReplyStream, STUDIO_RAN_OUT_REPLY } from "./studio-reply.server";
import type { StudioTurnOutcome } from "./studio-build-tool.server";

const usage = new Response.Usage({ inputTokens: { total: 1 }, outputTokens: { total: 1 } });
const finish = (reason: Response.FinishReason = "stop") =>
	Response.makePart("finish", { reason, usage });
const text = (value: string) => [
	Response.makePart("text-start", { id: "text" }),
	Response.makePart("text-delta", { id: "text", delta: value }),
	Response.makePart("text-end", { id: "text" }),
];
const noBuild: StudioTurnOutcome = { attempts: 0, saved: false, rejected: [] };
const rejected: StudioTurnOutcome = {
	attempts: 1,
	saved: false,
	rejected: [
		{
			code: "missing_field",
			severity: "error",
			stage: "input",
			ref: { kind: "request", path: "spec" },
			message: "The review step needs a label.",
			hint: "Add a label.",
		},
	],
};
const words = (parts: ReadonlyArray<Response.AnyPart>) =>
	parts.flatMap((part) => (part.type === "text-delta" ? [part.delta] : [])).join("");
const collect = (rounds: ReadonlyArray<ReadonlyArray<Response.AnyPart>>, outcome = noBuild) =>
	Effect.gen(function* () {
		let runs = 0;
		const parts = yield* studioReplyStream({
			run: () => Stream.fromIterable(rounds[runs++] ?? []),
			outcome: Effect.succeed(outcome),
		}).pipe(Stream.runCollect);
		return { parts, runs };
	});

describe("Studio reply policy", () => {
	it.effect(
		"holds text until a step completes and replaces a false success after rejected builds",
		() =>
			Effect.gen(function* () {
				const started = yield* Deferred.make<void>();
				const release = yield* Deferred.make<void>();
				const seen: Response.AnyPart[] = [];
				const source = Stream.fromIterable(text("Saved your diagram.")).pipe(
					Stream.concat(Stream.fromEffect(Deferred.succeed(started, undefined)).pipe(Stream.drain)),
					Stream.concat(Stream.fromEffect(Deferred.await(release).pipe(Effect.as(finish())))),
				);
				const fiber = yield* studioReplyStream({
					run: () => source,
					outcome: Effect.succeed(rejected),
				}).pipe(
					Stream.runForEach((part) =>
						Effect.sync(() => {
							seen.push(part);
						}),
					),
					Effect.forkScoped,
				);
				yield* Deferred.await(started);
				expect(words(seen)).toBe("");
				yield* Deferred.succeed(release, undefined);
				yield* Fiber.join(fiber);
				expect(words(seen)).toContain("couldn't save");
				expect(words(seen)).toContain("needs a label");
				expect(words(seen)).not.toContain("Saved your diagram.");
			}),
	);
	it.effect("preserves the answer when saved or when no build was needed", () =>
		Effect.gen(function* () {
			for (const outcome of [noBuild, { ...noBuild, attempts: 1, saved: true }])
				expect(words((yield* collect([[...text("Which title?"), finish()]], outcome)).parts)).toBe(
					"Which title?",
				);
		}),
	);
	it.effect("explains a rejected build even when the last step says nothing", () =>
		Effect.gen(function* () {
			expect(words((yield* collect([[finish()]], rejected)).parts)).toContain("couldn't save");
		}),
	);
	it.effect("retries only empty output-limit finishes and stops after one retry", () =>
		Effect.gen(function* () {
			const retried = yield* collect([[finish("length")], [...text("Done."), finish()]]);
			expect(retried.runs).toBe(2);
			expect(words(retried.parts)).toBe("Done.");
			const exhausted = yield* collect([[finish("length")], [finish("length")]]);
			expect(exhausted.runs).toBe(2);
			expect(words(exhausted.parts)).toBe(STUDIO_RAN_OUT_REPLY);
			expect((yield* collect([[...text("Partial"), finish("length")]])).runs).toBe(1);
		}),
	);
	it.effect("cancellation interrupts the source and never retries", () =>
		Effect.gen(function* () {
			const started = yield* Deferred.make<void>();
			const stopped = yield* Deferred.make<void>();
			let runs = 0;
			const fiber = yield* studioReplyStream({
				run: () => {
					runs++;
					return Stream.fromEffect(Deferred.succeed(started, undefined)).pipe(
						Stream.drain,
						Stream.concat(Stream.never),
						Stream.ensuring(Deferred.succeed(stopped, undefined)),
					);
				},
				outcome: Effect.succeed(noBuild),
			}).pipe(Stream.runDrain, Effect.forkScoped);
			yield* Deferred.await(started);
			yield* Fiber.interrupt(fiber);
			yield* Deferred.await(stopped);
			expect(runs).toBe(1);
		}),
	);
	it.effect("keeps prior tool calls and compact results across an empty-length retry", () =>
		Effect.gen(function* () {
			const prompts: unknown[] = [];
			let builds = 0;
			const tools = Toolkit.make(
				Tool.make("build", {
					parameters: Schema.Struct({ title: Schema.String }),
					success: Schema.String,
				}),
			);
			const toolkit = yield* tools.pipe(
				Effect.provide(
					tools.toLayer({
						build: ({ title }) =>
							Effect.sync(() => {
								builds++;
								return title;
							}),
					}),
				),
			);
			const model = yield* LanguageModel.make({
				generateText: () => Effect.die("Unexpected generateText"),
				streamText: (options) => {
					prompts.push(options.prompt);
					return Stream.fromIterable<Response.StreamPartEncoded>(
						prompts.length === 1
							? [
									Response.makePart("tool-call", {
										id: "saved",
										name: "build",
										params: { title: "Review" },
										providerExecuted: false,
									}),
									finish("tool-calls"),
								]
							: prompts.length === 2
								? [finish("length")]
								: [...text("Done."), finish()],
					);
				},
			});
			const chat = yield* Chat.fromPrompt("Draw a review.");
			yield* studioReplyStream({
				run: () => chat.streamText({ prompt: [], toolkit, maxSteps: 3 }),
				outcome: Effect.succeed({ ...noBuild, attempts: 1, saved: true }),
			}).pipe(Stream.runDrain, Effect.provideService(LanguageModel.LanguageModel, model));
			expect(prompts).toHaveLength(3);
			expect(builds).toBe(1);
			expect(JSON.stringify(prompts[2])).toContain('"type":"tool-result"');
			expect(JSON.stringify(prompts[2])).toContain('"result":"Review"');
		}),
	);
});

it.effect("keeps a repair tool after released text active in chronological assistant order", () =>
	Effect.gen(function* () {
		const spec = { title: "Review", nodes: { a: "Open", b: "Close" }, edges: [["a", "b"]] };
		const source = Stream.fromIterable([
			...text("I will draw this."),
			Response.makePart("tool-call", {
				id: "build-1",
				name: "build_flowchart",
				providerExecuted: false,
				params: { spec },
			}),
			Response.makePart("tool-result", {
				id: "build-1",
				name: "build_flowchart",
				providerExecuted: false,
				isFailure: false,
				preliminary: false,
				result: { ok: false },
				encodedResult: { ok: false },
			}),
			finish("tool-calls"),
			Response.makePart("tool-params-start", {
				id: "build-2",
				name: "build_flowchart",
				providerExecuted: false,
			}),
			Response.makePart("tool-params-delta", { id: "build-2", delta: JSON.stringify({ spec }) }),
		]);
		const events = yield* studioReplyStream({
			run: () => source,
			outcome: Effect.succeed(noBuild),
		}).pipe(
			AgUi.fromStreamParts,
			Stream.provideService(IdGenerator.IdGenerator, {
				generateId: () => Effect.succeed("result"),
			}),
			Stream.runCollect,
		);
		const state = events.reduce((state, event) => applyChatEvent(state, event, "run"), emptyChat);
		const views = chatMessageViews(state.messages, state.completed);
		const build = deriveBuildState(views, true);
		expect(views.map((view) => view.parts[0]?.type)).toEqual([
			"tool-build_flowchart",
			"text",
			"tool-build_flowchart",
		]);
		expect(build.activePart?.toolCallId).toBe("build-2");
		expect(build.ghostLabels).toEqual(["Open", "Close"]);
	}),
);
