import type { IconRecipe } from "@sketchi/diagram-core";
import { colorDistance, hexRgb, type MarkColor, sanitizeSvg } from "@sketchi/icon-catalog";
import { rankLookAlikes } from "@sketchi/icon-catalog/look-alikes";
import { Clock, Context, Effect, Result } from "effect";

import {
	confusedRequestText,
	decodeAuthorReply,
	draftRequestText,
	normalizeRecipe,
	sourceTone,
	repairRequestText,
	REVIEW_REQUEST_TEXT,
} from "./author.js";
import { IconInputError, IconRecipeError, IconTimeoutError } from "./errors.js";
import { IconImaging, type IconImageExport, type IconImagePrepare } from "./imaging.js";
import type { IconDrawInput, IconSource } from "./input.js";
import {
	decodeJudgeReply,
	type IconJudgeVerdict,
	JUDGE_LOOK_ALIKES,
	type JudgeCandidate,
	judgeLineup,
} from "./judge.js";
import {
	type AuthorContentBlock,
	type AuthorTurn,
	type IconAuthorModel,
	IconDrawModels,
	type ModelCall,
} from "./models.js";
import {
	ICON_EXPORT_SCALE,
	iconLibrary,
	type IconLibrary,
	LARGE_ICON_SIZE,
	NODE_ICON_SIZE,
	previewScene,
	roundSheet,
} from "./scenes.js";

/** Catalog marks by slug, as SVG markup, for the judge's lineup. */
export class IconCatalogSvgs extends Context.Service<
	IconCatalogSvgs,
	{ readonly load: (slug: string) => Effect.Effect<string | undefined> }
>()("@sketchi/icon-draw/IconCatalogSvgs") {}

/** The author's view of the source. */
const SOURCE_SIZE = 256;
/** Each logo in the judge's lineup. */
const LINEUP_SIZE = 128;
/** Author calls per draw, the judge's revision included. */
export const ICON_DRAW_MAX_ROUNDS = 3;
/** A draw answers within this, so a client can wait on one HTTP request. */
export const ICON_DRAW_BUDGET_MS = 85_000;
/** Time a round needs: an author call and a render. A round that would not fit is not started. */
const ROUND_RESERVE_MS = 25_000;
/** Kept free for the judge: no author call or render may run into it. */
const JUDGE_RESERVE_MS = 15_000;
/** Catalog marks ranked for the lineup, so one that fails to load or draw is replaced by the next. */
const LOOK_ALIKE_CANDIDATES = 8;

export interface IconDrawOptions {
	readonly authorModel: IconAuthorModel;
	readonly maxRounds?: number;
	readonly budgetMs?: number;
}

export interface IconDrawUsage {
	/** Model calls, author and judge. */
	readonly calls: number;
	/** Every input token, cached or not. */
	readonly inputTokens: number;
	readonly cacheReadTokens: number;
	readonly cacheWriteTokens: number;
	readonly outputTokens: number;
	readonly ms: number;
	readonly byCall: readonly ModelCall[];
}

export interface AuthorTurnOutcome {
	readonly outcome: "drawn" | "accepted" | "invalid";
	/** Why the checker rejected the recipe, for an invalid turn. */
	readonly issues?: readonly string[];
}

export interface IconDrawResult {
	readonly name: string;
	readonly recipe: IconRecipe;
	/** Base64 PNGs at node size and four times node size, exported at twice their size. */
	readonly previews: { readonly png28: string; readonly png112: string };
	readonly excalidrawlib: IconLibrary;
	readonly judge: IconJudgeVerdict;
	/** The source colors the recipe may use, with the share of the mark each covers. */
	readonly palette: readonly MarkColor[];
	readonly author: {
		readonly model: string;
		readonly rounds: number;
		/** True when the author accepted its own drawing, rather than running out of rounds. */
		readonly accepted: boolean;
		/** What each author turn did, in order. */
		readonly turns: readonly AuthorTurnOutcome[];
	};
	readonly usage: IconDrawUsage;
}

/** A measured color this far from every paint is something the paint reader missed, such as an embedded image. */
const PAINT_MATCH_DISTANCE = 120;
/** How close to the line from a paint to white a color must be to count as that paint thinned over paper. */
const TINT_DISTANCE = 24;

/** Whether `measured` is `paint` blended with white paper: thin lines and anti-aliasing, not a color of its own. */
function isTint(measured: string, paint: string): boolean {
	const [mr, mg, mb] = hexRgb(measured);
	const [pr, pg, pb] = hexRgb(paint);
	const [dr, dg, db] = [255 - pr, 255 - pg, 255 - pb];
	const length = dr * dr + dg * dg + db * db;
	if (length === 0) return false;
	const t = ((mr - pr) * dr + (mg - pg) * dg + (mb - pb) * db) / length;
	if (t <= 0 || t >= 1) return false;
	return Math.hypot(mr - (pr + t * dr), mg - (pg + t * dg), mb - (pb + t * db)) <= TINT_DISTANCE;
}

/**
 * The colors a recipe may use, with the share of the mark each covers. An
 * SVG's are its exact paints: each measured color counts toward the nearest
 * paint, so a gradient's blends count toward its stops rather than becoming
 * colors the source never names, and a paint thinned over paper is dropped.
 * A raster's are its quantized pixel colors.
 */
export function sourcePalette(source: IconSource, pixels: readonly MarkColor[]): MarkColor[] {
	if (source.kind === "raster" || source.colors.length === 0) return [...pixels];
	const shares = new Map<string, number>();
	for (const [measured, share] of pixels) {
		const paint = [...source.colors].sort(
			(left, right) => colorDistance(left, measured) - colorDistance(right, measured),
		)[0];
		if (paint && colorDistance(paint, measured) <= PAINT_MATCH_DISTANCE) {
			shares.set(paint, (shares.get(paint) ?? 0) + share);
		} else if (!source.colors.some((color) => isTint(measured, color))) {
			shares.set(measured, (shares.get(measured) ?? 0) + share);
		}
	}
	return [...shares.entries()]
		.map(([color, share]): MarkColor => [color, share])
		.sort((left, right) => right[1] - left[1]);
}

function imageBlock(png: string): AuthorContentBlock {
	return { type: "image", source: { type: "base64", media_type: "image/png", data: png } };
}

function textBlock(text: string): AuthorContentBlock {
	return { type: "text", text };
}

interface Rendered {
	readonly recipe: IconRecipe;
	readonly sheet: string;
	readonly png28: string;
	readonly png112: string;
}

function renderExports(recipe: IconRecipe, sourcePng: string): IconImageExport[] {
	return [
		{ id: "sheet", scene: roundSheet(recipe, sourcePng), padding: 12, scale: ICON_EXPORT_SCALE },
		{
			id: "png28",
			scene: previewScene(recipe, NODE_ICON_SIZE),
			padding: 4,
			scale: ICON_EXPORT_SCALE,
		},
		{
			id: "png112",
			scene: previewScene(recipe, LARGE_ICON_SIZE),
			padding: 8,
			scale: ICON_EXPORT_SCALE,
		},
	];
}

/**
 * Draw a logo as a hand-drawn recipe: prepare the source, let the author draft
 * and revise against renders of its own recipe, then have a judge from another
 * model family pick the source out of look-alikes from the 28 px drawing alone.
 * A drawing the judge does not recognise still comes back, marked.
 */
export const drawIcon = Effect.fn("iconDraw.draw")(function* (
	input: IconDrawInput,
	options: IconDrawOptions,
) {
	const imaging = yield* IconImaging;
	const models = yield* IconDrawModels;
	const catalog = yield* IconCatalogSvgs;
	const startedAt = yield* Clock.currentTimeMillis;
	const maxRounds = options.maxRounds ?? ICON_DRAW_MAX_ROUNDS;
	const budgetMs = options.budgetMs ?? ICON_DRAW_BUDGET_MS;
	const calls: ModelCall[] = [];
	const deadline = startedAt + budgetMs;
	const timeLeft = Effect.map(Clock.currentTimeMillis, (now) => deadline - now);
	/**
	 * Run one step within what is left of the budget, keeping `reserveMs` of it for what must
	 * follow: imaging, model calls and their retries all stop at the deadline.
	 */
	const inTime = <A, E, R>(
		stage: IconTimeoutError["stage"],
		reserveMs: number,
		step: Effect.Effect<A, E, R>,
	) =>
		Effect.gen(function* () {
			const remaining = (yield* timeLeft) - reserveMs;
			const timedOut = IconTimeoutError.make({
				message: `The draw ran out of its ${budgetMs / 1000} s budget during the ${stage}.`,
				stage,
			});
			if (remaining <= 0) return yield* timedOut;
			return yield* step.pipe(
				Effect.timeoutOrElse({ duration: remaining, orElse: () => Effect.fail(timedOut) }),
			);
		});

	// 1. The source, trimmed and square on paper, and what it looks like.
	const prepared = yield* inTime(
		"source",
		JUDGE_RESERVE_MS,
		imaging.run({
			prepare: [
				{
					id: "source",
					source: input.source,
					size: SOURCE_SIZE,
					quantize: input.source.kind === "raster",
				},
				{
					id: "lineup:source",
					source: input.source,
					size: LINEUP_SIZE,
					quantize: input.source.kind === "raster",
				},
			],
			exports: [],
		}),
	);
	const source = prepared.prepared["source"];
	const lineupSource = prepared.prepared["lineup:source"];
	if (!source || !lineupSource) {
		return yield* IconInputError.make({
			code: "blank_image",
			message: "The logo draws nothing visible on white paper.",
			hint: "Send a logo with dark or colored ink; a white mark needs its background.",
		});
	}
	const palette = sourcePalette(input.source, source.features.palette);
	const paletteHexes = palette.map(([hex]) => hex);
	const tone = sourceTone(palette);
	yield* Effect.annotateCurrentSpan({ "sketchi.icon.palette": paletteHexes.join(" ") });

	// 2. The judge's lineup: the catalog marks the source most resembles, with spares ranked
	//    after them for any that fail to load or draw.
	const lookAlikes = rankLookAlikes(source.features, {
		name: input.name,
		count: LOOK_ALIKE_CANDIDATES,
	});
	const loaded = yield* inTime(
		"lineup",
		JUDGE_RESERVE_MS,
		Effect.forEach(
			lookAlikes,
			({ slug }) =>
				catalog.load(slug).pipe(
					Effect.map((svg) => {
						const sanitized = svg === undefined ? undefined : sanitizeSvg(svg);
						return sanitized?.ok ? { slug, svg: sanitized.value } : undefined;
					}),
				),
			{ concurrency: LOOK_ALIKE_CANDIDATES },
		),
	);
	const lineupPrepare: IconImagePrepare[] = loaded.flatMap((entry) =>
		entry
			? [
					{
						id: `lineup:${entry.slug}`,
						source: { kind: "svg", svg: entry.svg.svg, colors: entry.svg.colors },
						size: LINEUP_SIZE,
						quantize: false,
					} satisfies IconImagePrepare,
				]
			: [],
	);
	const lineupImages: Record<string, string> = { source: lineupSource.png };

	// 3. Draft, render, review.
	const messages: AuthorTurn[] = [
		{
			role: "user",
			content: [imageBlock(source.png), textBlock(draftRequestText(input.name, palette))],
		},
	];
	let rounds = 0;
	let accepted = false;
	let current: Rendered | undefined;
	let lastIssues: readonly string[] = [];
	const turns: AuthorTurnOutcome[] = [];

	const authorTurn = Effect.fnUntraced(function* () {
		const reply = yield* inTime(
			"author",
			JUDGE_RESERVE_MS,
			models.author({ model: options.authorModel, messages }),
		);
		rounds += 1;
		calls.push(reply.call);
		messages.push({ role: "assistant", content: reply.content });
		return decodeAuthorReply(reply.text);
	});

	const render = Effect.fnUntraced(function* (recipe: IconRecipe) {
		const result = yield* inTime(
			"render",
			JUDGE_RESERVE_MS,
			imaging.run({
				prepare: lineupPrepare.filter(
					({ id }) => lineupImages[id.slice("lineup:".length)] === undefined,
				),
				exports: renderExports(recipe, source.png),
			}),
		);
		for (const [id, image] of Object.entries(result.prepared)) {
			lineupImages[id.slice("lineup:".length)] = image.png;
		}
		const { sheet, png28, png112 } = result.exported;
		if (!sheet || !png28 || !png112) {
			return yield* IconRecipeError.make({
				issues: [],
				message: "The recipe could not be drawn.",
			});
		}
		return { recipe, sheet, png28, png112 } satisfies Rendered;
	});

	/** One author turn that should end in a recipe; undefined when it did not. */
	const revise = Effect.fnUntraced(function* () {
		const reply = yield* authorTurn();
		const invalid = (issues: readonly string[]) => {
			lastIssues = issues;
			turns.push({ outcome: "invalid", issues });
			messages.push({ role: "user", content: [textBlock(repairRequestText(issues))] });
			return "repair" as const;
		};
		if (!reply) return invalid(['The reply was not the {"accept", "recipe"} JSON.']);
		if (reply.accept && current) {
			turns.push({ outcome: "accepted" });
			return "accepted" as const;
		}
		const normalized = normalizeRecipe(reply.recipe, paletteHexes, tone);
		if (!normalized.recipe) {
			return invalid(reply.recipe === null ? ["A draft needs a recipe."] : normalized.issues);
		}
		turns.push({ outcome: "drawn" });
		return yield* render(normalized.recipe);
	});

	/** A revision that runs out of time ends the rounds when there is a drawing to keep. */
	const reviseInTime = revise().pipe(
		Effect.catchTag("IconTimeoutError", (error) =>
			current ? Effect.succeed("timeout" as const) : Effect.fail(error),
		),
	);
	const roomForRound = Effect.map(timeLeft, (left) => left >= ROUND_RESERVE_MS + JUDGE_RESERVE_MS);

	while (rounds < maxRounds) {
		if (rounds > 0 && !(yield* roomForRound)) break;
		const outcome = yield* reviseInTime;
		if (outcome === "timeout") break;
		if (outcome === "accepted") {
			accepted = true;
			break;
		}
		if (outcome === "repair") continue;
		current = outcome;
		if (rounds < maxRounds) {
			messages.push({
				role: "user",
				content: [imageBlock(current.sheet), textBlock(REVIEW_REQUEST_TEXT)],
			});
		}
	}
	if (!current) {
		return yield* IconRecipeError.make({
			issues: lastIssues,
			message: "The author did not produce a recipe that can be drawn.",
		});
	}

	// 4. The judge, and one revision when it mistook the drawing for a look-alike. It needs a full
	//    lineup: with fewer look-alikes a pick would mean less, so it does not run.
	const lineupSlugs = loaded
		.flatMap((entry) => (entry && lineupImages[entry.slug] !== undefined ? [entry.slug] : []))
		.slice(0, JUDGE_LOOK_ALIKES);
	const lineup: JudgeCandidate[] =
		lineupSlugs.length === JUDGE_LOOK_ALIKES ? judgeLineup(input.name, lineupSlugs) : [];
	const lineupNames = lineup.map((candidate) =>
		candidate.kind === "source" ? "source" : candidate.slug,
	);
	const judgeOnce = Effect.fnUntraced(function* (drawing: Rendered) {
		const reply = yield* inTime(
			"judge",
			0,
			models.judge({
				sketch: drawing.png28,
				lineup: lineupNames.map((name) => lineupImages[name] ?? ""),
			}),
		);
		calls.push(reply.call);
		const picked = decodeJudgeReply(reply.text, lineup.length);
		return picked === undefined ? undefined : lineupNames[picked - 1];
	});

	let attempts = lineup.length === 0 ? 0 : 1;
	const first =
		lineup.length === 0
			? Result.fail({
					message: `Only ${lineupSlugs.length} of the ${JUDGE_LOOK_ALIKES} look-alikes the judge needs could be drawn.`,
				})
			: yield* judgeOnce(current).pipe(Effect.result);
	let picked = Result.isSuccess(first) ? first.success : undefined;
	let judgeError = Result.isFailure(first) ? first.failure.message : undefined;
	if (
		Result.isSuccess(first) &&
		picked !== undefined &&
		picked !== "source" &&
		rounds < maxRounds &&
		(yield* roomForRound)
	) {
		const confused = lineupImages[picked];
		if (confused) {
			messages.push({
				role: "user",
				content: [imageBlock(source.png), imageBlock(confused), textBlock(confusedRequestText())],
			});
			const outcome = yield* reviseInTime;
			if (outcome !== "accepted" && outcome !== "repair" && outcome !== "timeout") {
				attempts += 1;
				const second = yield* judgeOnce(outcome).pipe(Effect.result);
				if (Result.isSuccess(second) && second.success === "source") {
					current = outcome;
					picked = "source";
				} else if (Result.isFailure(second)) {
					judgeError = second.failure.message;
				}
			}
		}
	}

	const finishedAt = yield* Clock.currentTimeMillis;
	const judge: IconJudgeVerdict = {
		recognizable: picked === "source",
		...(picked === undefined ? {} : { picked }),
		lineup: lineupNames,
		model: models.judgeModel,
		attempts,
		...(judgeError === undefined ? {} : { error: judgeError }),
	};
	yield* Effect.annotateCurrentSpan({
		"sketchi.icon.rounds": rounds,
		"sketchi.icon.accepted": accepted,
		"sketchi.icon.recognizable": judge.recognizable,
	});
	const sum = (pick: (call: ModelCall) => number) =>
		calls.reduce((total, call) => total + pick(call), 0);
	return {
		name: input.name,
		recipe: current.recipe,
		previews: { png28: current.png28, png112: current.png112 },
		excalidrawlib: iconLibrary(input.name, current.recipe),
		judge,
		palette,
		author: { model: options.authorModel, rounds, accepted, turns },
		usage: {
			calls: calls.length,
			inputTokens: sum(
				(call) => call.usage.inputTokens + call.usage.cacheReadTokens + call.usage.cacheWriteTokens,
			),
			cacheReadTokens: sum((call) => call.usage.cacheReadTokens),
			cacheWriteTokens: sum((call) => call.usage.cacheWriteTokens),
			outputTokens: sum((call) => call.usage.outputTokens),
			ms: finishedAt - startedAt,
			byCall: calls,
		},
	} satisfies IconDrawResult;
});
