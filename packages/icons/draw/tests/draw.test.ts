// @vitest-environment jsdom
import { loadLibraryFromBlob } from "@excalidraw/excalidraw";
import { describe, expect, it } from "@effect/vitest";
import {
	CloudflareAiGatewayBinding,
	type CloudflareAiGateway,
} from "@sketchi/cloudflare/ai-gateway";
import { lookAlikeMarks } from "@sketchi/icon-catalog/look-alikes";
import { TelemetryCorrelation } from "@sketchi/observability";
import { Effect, Fiber, Layer } from "effect";
import { Prompt } from "effect/ai";
import { TestClock } from "effect/testing";

import {
	drawIcon,
	ICON_DRAW_BUDGET_MS,
	IconCatalogSvgs,
	IconDrawGatewayConfig,
	IconDrawModels,
	IconDrawModelsGateway,
	IconImaging,
	type ModelCall,
	prepareIconInput,
} from "../src/index.js";

const SLACK_SVG = `<svg viewBox="0 0 24 24"><rect x="1" y="7" width="10" height="4" fill="#36c5f0"/><rect x="13" y="1" width="4" height="10" fill="#2eb67d"/><rect x="13" y="13" width="10" height="4" fill="#ecb22e"/><rect x="7" y="13" width="4" height="10" fill="#e01e5a"/></svg>`;

const draft = {
	parts: (
		[
			[1.5, 7.5, 10, 4.2, "#36c5f0"],
			[12.8, 1.5, 4.2, 10, "#2eb67d"],
			[12.5, 12.8, 10, 4.2, "#ecb22e"],
			[7, 12.5, 4.2, 10, "#e01e5a"],
		] as const
	).map(([x, y, width, height, color]) => ({
		kind: "rect",
		x,
		y,
		width,
		height,
		rounded: true,
		stroke: color,
		fill: color,
	})),
};
const revised = {
	parts: [...draft.parts, { kind: "ellipse", cx: 12, cy: 12, rx: 1, ry: 1, fill: "ink" }],
};
const tooMany = { parts: Array.from({ length: 9 }, () => draft.parts[0]) };
const accept = { accept: true, recipe: null };

const imaging = Layer.succeed(IconImaging, {
	run: (job) =>
		Effect.sync(() => ({
			prepared: Object.fromEntries(
				job.prepare.map((item) => [
					item.id,
					{ png: `png:${item.id}`, features: lookAlikeMarks["slack"]! },
				]),
			),
			exported: Object.fromEntries(job.exports.map((item) => [item.id, `png:${item.id}`])),
		})),
});
const catalog = Layer.succeed(IconCatalogSvgs, {
	load: () => Effect.succeed('<svg viewBox="0 0 2 2"><rect width="2" height="1"/></svg>'),
});

interface Script {
	readonly author: readonly unknown[];
	readonly judge: readonly string[];
	readonly authorDelayMs?: number;
	readonly judgeDelayMs?: number;
}

/** Scripted model replies; every other draw service is a stand-in. */
function scripted(script: Script) {
	const authorReplies = [...script.author];
	const judgeReplies = [...script.judge];
	const judged: number[] = [];
	const call = (role: "author" | "judge"): ModelCall => ({
		role,
		model: role,
		usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
		ms: 5,
	});
	const models = Layer.succeed(IconDrawModels, {
		judgeModel: "judge",
		author: () =>
			Effect.sleep(script.authorDelayMs ?? 0).pipe(
				Effect.andThen(
					Effect.sync(() => {
						const text = JSON.stringify(authorReplies.shift());
						return {
							content: Prompt.make([{ role: "assistant", content: text }]),
							text,
							call: call("author"),
						};
					}),
				),
			),
		judge: ({ lineup }) =>
			Effect.sleep(script.judgeDelayMs ?? 0).pipe(
				Effect.andThen(
					Effect.sync(() => {
						judged.push(lineup.length);
						return { text: judgeReplies.shift() ?? "", call: call("judge") };
					}),
				),
			),
	});
	return { layer: Layer.mergeAll(imaging, catalog, models), judged };
}

const draw = <E, R>(
	layer: Layer.Layer<IconImaging | IconCatalogSvgs | IconDrawModels, E, R>,
	budgetMs?: number,
) =>
	prepareIconInput({ name: "Slack", svg: SLACK_SVG }).pipe(
		Effect.flatMap((prepared) =>
			drawIcon(prepared, {
				authorModel: "anthropic/claude-sonnet-5-5",
				...(budgetMs === undefined ? {} : { budgetMs }),
			}),
		),
		Effect.provide(layer),
	);

/** The real gateway models, over a gateway whose replies the test writes per operation. */
function throughGateway(
	reply: (operation: "icon-author" | "icon-judge", signal: AbortSignal) => Promise<Response>,
) {
	const dispatches = { "icon-author": 0, "icon-judge": 0 };
	const judgeQueries: unknown[] = [];
	const run: CloudflareAiGateway["run"] = (request, options) => {
		const operation = options?.gateway?.metadata?.["sketchiOperation"] as
			| "icon-author"
			| "icon-judge";
		dispatches[operation]++;
		if (operation === "icon-judge") judgeQueries.push(request.query);
		return reply(operation, options!.signal!);
	};
	const models = IconDrawModelsGateway.pipe(
		Layer.provide(
			Layer.mergeAll(
				Layer.succeed(CloudflareAiGatewayBinding, {
					gateway: () => ({ run, getUrl: () => Promise.resolve("https://gateway.invalid") }),
				}),
				Layer.succeed(IconDrawGatewayConfig, {
					gatewayId: "test",
					collectLog: false,
					surface: "test",
					judgeModel: "openai/gpt-6-sol",
					authorEffort: "low",
				}),
			),
		),
	);
	return { layer: Layer.mergeAll(imaging, catalog, models), dispatches, judgeQueries };
}

const authorWire = (reply: unknown) =>
	Response.json({
		id: "msg_test",
		type: "message",
		role: "assistant",
		model: "claude-sonnet-5-5",
		content: [{ type: "text", text: JSON.stringify(reply) }],
		stop_reason: "end_turn",
		stop_sequence: null,
		usage: { input_tokens: 1, output_tokens: 1 },
	});
const judgeWire = (text: string) =>
	Response.json({
		id: "resp_test",
		object: "response",
		created_at: 0,
		status: "completed",
		model: "gpt-6-sol",
		output: [
			{
				id: "msg_test",
				type: "message",
				status: "completed",
				role: "assistant",
				content: [{ type: "output_text", annotations: [], text }],
			},
		],
		usage: {
			input_tokens: 300,
			input_tokens_details: { cached_tokens: 100 },
			output_tokens: 40,
			output_tokens_details: { reasoning_tokens: 30 },
			total_tokens: 340,
		},
	});
const unavailable = () => Response.json({ error: { message: "capacity" } }, { status: 503 });

/** Runs a draw to completion on the test clock. */
const settle = <A, E>(effect: Effect.Effect<A, E>) =>
	Effect.gen(function* () {
		const fiber = yield* Effect.forkChild(
			effect.pipe(Effect.provideService(TelemetryCorrelation, {}), Effect.result),
		);
		yield* TestClock.adjust("200 seconds");
		return yield* Fiber.join(fiber);
	});

describe("drawIcon", () => {
	it.effect("drafts, accepts and judges, returning a library Excalidraw loads", () =>
		Effect.gen(function* () {
			const { layer, judged } = scripted({
				author: [{ accept: false, recipe: draft }, accept],
				judge: ['{"logo": 0}'],
			});
			const icon = yield* draw(layer);
			expect(icon.recipe).toEqual(draft);
			expect(icon.author).toMatchObject({ rounds: 2, accepted: true });
			// The judge sees the drawing among its look-alikes.
			expect(judged).toEqual([5]);
			const loaded = yield* Effect.promise(() =>
				loadLibraryFromBlob(
					new Blob([JSON.stringify(icon.excalidrawlib)], {
						type: "application/vnd.excalidrawlib+json",
					}),
				),
			);
			expect(loaded).toHaveLength(1);
			expect(loaded[0]).toMatchObject({ name: "Slack", status: "published" });
			expect(loaded[0]?.elements).toHaveLength(draft.parts.length);
			expect(new Set(loaded[0]?.elements.map((element) => element.groupIds.join())).size).toBe(1);
		}),
	);

	it.effect("fails once every round's recipe is undrawable", () =>
		Effect.gen(function* () {
			const { layer } = scripted({
				author: [{ accept: false, recipe: tooMany }, { accept: false, recipe: tooMany }, accept],
				judge: [],
			});
			expect(yield* Effect.flip(draw(layer))).toMatchObject({ _tag: "IconRecipeError" });
		}),
	);

	it.effect("revises at most once when the judge keeps mistaking the drawing", () =>
		Effect.gen(function* () {
			// Reply with a look-alike's position whatever the lineup order.
			const { layer } = scripted({
				author: [{ accept: false, recipe: draft }, accept, { accept: false, recipe: revised }],
				judge: ['{"logo": 0}'],
			});
			const lineup = (yield* draw(layer)).judge.lineup;
			const lookAlike = JSON.stringify({ logo: lineup.findIndex((name) => name !== "source") + 1 });
			const mistaken = scripted({
				author: [
					{ accept: false, recipe: draft },
					accept,
					{ accept: false, recipe: revised },
					{ accept: false, recipe: revised },
				],
				judge: [lookAlike, lookAlike, lookAlike],
			});
			const icon = yield* draw(mistaken.layer);
			expect(icon.judge).toMatchObject({ recognizable: false, attempts: 2 });
			expect(icon.author.rounds).toBe(3);
			expect(mistaken.judged).toHaveLength(2);
			expect(icon.recipe).toEqual(draft);
		}),
	);

	it.effect(
		"reads the judge's pick and usage from its provider, and an unreadable pick as none",
		() =>
			Effect.gen(function* () {
				const drawThenAccept = (judgeText: string) => {
					const authorReplies = [
						{ accept: false, recipe: draft },
						accept,
						{ accept: false, recipe: draft },
					];
					return throughGateway(async (operation) =>
						operation === "icon-author" ? authorWire(authorReplies.shift()) : judgeWire(judgeText),
					);
				};
				const judged = drawThenAccept('{"logo":1}');
				const result = yield* settle(draw(judged.layer));
				if (result._tag !== "Success") throw new Error("draw failed");
				const icon = result.success;
				expect(icon.judge.picked).toBe(icon.judge.lineup[0]);
				expect(icon.usage.byCall.filter((call) => call.role === "judge")[0]?.usage).toEqual({
					inputTokens: 200,
					cacheReadTokens: 100,
					cacheWriteTokens: 0,
					outputTokens: 40,
				});
				// Every image in the lineup goes at low detail, the judge's main spend.
				const images = JSON.stringify(judged.judgeQueries[0]).match(/"detail":"[a-z]+"/g);
				expect(images).toEqual(Array.from({ length: 6 }, () => '"detail":"low"'));
				expect(judged.judgeQueries[0]).toMatchObject({ text: { format: { type: "json_schema" } } });

				const unreadable = drawThenAccept("a logo");
				const blank = yield* settle(draw(unreadable.layer));
				if (blank._tag !== "Success") throw new Error("draw failed");
				expect(blank.success.judge).toMatchObject({ recognizable: false, attempts: 1 });
				expect(blank.success.judge.error).toBeUndefined();
				expect(unreadable.dispatches["icon-judge"]).toBe(1);
				// The unreadable reply was still billed: its usage counts.
				const billed = blank.success.usage.byCall.find((call) => call.role === "judge");
				expect(billed?.usage).toMatchObject({ outputTokens: 40 });
			}),
	);
});

describe("drawIcon spend bounds", () => {
	it.effect("stops starting rounds and cuts the judge off at the deadline", () =>
		Effect.gen(function* () {
			const { layer } = scripted({
				author: [
					{ accept: false, recipe: draft },
					{ accept: false, recipe: revised },
					{ accept: false, recipe: draft },
				],
				judge: ['{"logo": 1}'],
				authorDelayMs: 30_000,
				judgeDelayMs: 30_000,
			});
			const result = yield* settle(draw(layer));
			if (result._tag !== "Success") throw new Error("draw failed");
			const icon = result.success;
			// Two 30 s rounds fit; a third would run into the judge's reserve, and the judge's
			// 30 s call is cut off when the budget runs out. The icon still comes back, marked.
			expect(icon.author.rounds).toBe(2);
			expect(icon.usage.ms).toBeLessThanOrEqual(ICON_DRAW_BUDGET_MS);
			expect(icon.judge).toMatchObject({ recognizable: false, attempts: 1 });
			expect(icon.judge.error).toContain("budget");
		}),
	);

	it.effect("times out when not even a first draft fits", () =>
		Effect.gen(function* () {
			const { layer } = scripted({ author: [], judge: [], authorDelayMs: 120_000 });
			const result = yield* settle(draw(layer));
			expect(result).toMatchObject({
				_tag: "Failure",
				failure: { _tag: "IconTimeoutError", stage: "author" },
			});
		}),
	);

	it.effect("retries a model that stays unavailable at most twice, author and judge alike", () =>
		Effect.gen(function* () {
			const judgeDown = throughGateway(async (operation) =>
				operation === "icon-author"
					? authorWire(
							judgeDown.dispatches["icon-author"] === 1 ? { accept: false, recipe: draft } : accept,
						)
					: unavailable(),
			);
			const judged = yield* settle(draw(judgeDown.layer));
			if (judged._tag !== "Success") throw new Error("draw failed");
			expect(judged.success.judge).toMatchObject({ recognizable: false });
			expect(judgeDown.dispatches["icon-judge"]).toBe(3);

			const authorDown = throughGateway(async () => unavailable());
			const failed = yield* settle(draw(authorDown.layer));
			expect(failed._tag).toBe("Failure");
			expect(authorDown.dispatches).toEqual({ "icon-author": 3, "icon-judge": 0 });
		}),
	);

	it.effect("aborts a stalled model call at its own deadline, under a larger caller budget", () =>
		Effect.gen(function* () {
			let aborted = false;
			const stalled = throughGateway(
				(_operation, signal) =>
					new Promise((_resolve, reject) =>
						signal.addEventListener("abort", () => {
							aborted = true;
							reject(new Error("aborted"));
						}),
					),
			);
			// Batch callers may allow a draw far longer than the default budget; the provider's
			// 75 s deadline must still end the one stalled call, without a retry.
			const fiber = yield* Effect.forkChild(
				draw(stalled.layer, 1_000_000).pipe(
					Effect.provideService(TelemetryCorrelation, {}),
					Effect.result,
				),
			);
			yield* TestClock.adjust("76 seconds");
			yield* Effect.promise(() => new Promise((resolve) => setTimeout(resolve, 0)));
			expect(aborted).toBe(true);
			expect(stalled.dispatches).toEqual({ "icon-author": 1, "icon-judge": 0 });
			yield* TestClock.adjust("1000 seconds");
			expect((yield* Fiber.join(fiber))._tag).toBe("Failure");

			// The judge's 30 s deadline ends its stalled call the same way; the drawing comes back, marked.
			let judgeAborted = false;
			const authorReplies = [{ accept: false, recipe: draft }, accept];
			const judgeStalled = throughGateway((operation, signal) =>
				operation === "icon-author"
					? Promise.resolve(authorWire(authorReplies.shift()))
					: new Promise((_resolve, reject) =>
							signal.addEventListener("abort", () => {
								judgeAborted = true;
								reject(new Error("aborted"));
							}),
						),
			);
			const judging = yield* Effect.forkChild(
				draw(judgeStalled.layer, 1_000_000).pipe(
					Effect.provideService(TelemetryCorrelation, {}),
					Effect.result,
				),
			);
			yield* TestClock.adjust("31 seconds");
			yield* Effect.promise(() => new Promise((resolve) => setTimeout(resolve, 0)));
			expect(judgeAborted).toBe(true);
			const marked = yield* Fiber.join(judging);
			if (marked._tag !== "Success") throw new Error("draw failed");
			expect(marked.success.judge).toMatchObject({ recognizable: false, attempts: 1 });
			expect(marked.success.judge.error).toContain("30 s");
			expect(judgeStalled.dispatches["icon-judge"]).toBe(1);
		}),
	);
});
