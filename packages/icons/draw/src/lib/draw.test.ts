import { iconRecipeIssues } from "@sketchi/diagram-core";
import { lookAlikeMarks, rankLookAlikes } from "@sketchi/icon-catalog/look-alikes";
import { Effect, Fiber, Layer } from "effect";
import { TestClock } from "effect/testing";
import { describe, expect, it } from "@effect/vitest";

import {
	AUTHOR_SYSTEM_PROMPT,
	decodeAuthorReply,
	draftRequestText,
	normalizeRecipe,
	sourceTone,
} from "./author.js";
import { drawIcon, ICON_DRAW_BUDGET_MS, IconCatalogSvgs, sourcePalette } from "./draw.js";
import { IconImaging, type IconImagingJob } from "./imaging.js";
import { prepareIconInput, rasterHeader, svgCurveSegments } from "./input.js";
import { decodeJudgeReply, judgeLineup } from "./judge.js";
import { DETAILED_MARK_CURVES, iconAuthorFor, IconDrawModels, type ModelCall } from "./models.js";

const SLACK_SVG = `<svg viewBox="0 0 24 24"><rect x="1" y="7" width="10" height="4" fill="#36c5f0"/><rect x="13" y="1" width="4" height="10" fill="#2eb67d"/><rect x="13" y="13" width="10" height="4" fill="#ecb22e"/><rect x="7" y="13" width="4" height="10" fill="#e01e5a"/></svg>`;

const draft = {
	parts: [
		{
			kind: "rect",
			x: 1.5,
			y: 7.5,
			width: 10,
			height: 4.2,
			rounded: true,
			stroke: "#36c5f0",
			fill: "#36c5f0",
		},
		{
			kind: "rect",
			x: 12.8,
			y: 1.5,
			width: 4.2,
			height: 10,
			rounded: true,
			stroke: "#2eb67d",
			fill: "#2eb67d",
		},
		{
			kind: "rect",
			x: 12.5,
			y: 12.8,
			width: 10,
			height: 4.2,
			rounded: true,
			stroke: "#ecb22e",
			fill: "#ecb22e",
		},
		{
			kind: "rect",
			x: 7,
			y: 12.5,
			width: 4.2,
			height: 10,
			rounded: true,
			stroke: "#e01e5a",
			fill: "#e01e5a",
		},
	],
};
const revised = {
	parts: [...draft.parts, { kind: "ellipse", cx: 12, cy: 12, rx: 1, ry: 1, fill: "ink" }],
};
const tooMany = { parts: Array.from({ length: 9 }, () => draft.parts[0]) };

const usage = { inputTokens: 10, outputTokens: 20, cacheReadTokens: 100, cacheWriteTokens: 5 };

interface Script {
	readonly author: readonly unknown[];
	readonly judge: readonly string[];
	/** How long each model call takes, on the test clock. */
	readonly authorDelayMs?: number;
	readonly judgeDelayMs?: number;
	/** Catalog marks that fail to load. */
	readonly missing?: (slug: string) => boolean;
	/** The palette every image measures, Slack's when omitted. */
	readonly palette?: readonly (readonly [string, number])[];
}

/** Fakes for every service a draw needs, replying from a script and recording what was asked. */
function fakes(script: Script) {
	const authorReplies = [...script.author];
	const judgeReplies = [...script.judge];
	const seen = {
		authorTurns: [] as number[],
		jobs: [] as IconImagingJob[],
		judged: [] as string[][],
	};
	const call = (role: "author" | "judge"): ModelCall => ({ role, model: role, usage, ms: 5 });
	const layer = Layer.mergeAll(
		Layer.succeed(IconImaging, {
			run: (job) =>
				Effect.sync(() => {
					seen.jobs.push(job);
					return {
						prepared: Object.fromEntries(
							job.prepare.map((item) => [
								item.id,
								{
									png: `png:${item.id}`,
									features: script.palette
										? { ...lookAlikeMarks["slack"]!, palette: script.palette }
										: lookAlikeMarks["slack"]!,
								},
							]),
						),
						exported: Object.fromEntries(
							job.exports.map((item) => [item.id, `png:${item.id}:${seen.jobs.length}`]),
						),
					};
				}),
		}),
		Layer.succeed(IconCatalogSvgs, {
			load: (slug) =>
				Effect.succeed(
					script.missing?.(slug)
						? undefined
						: '<svg viewBox="0 0 2 2"><rect width="2" height="1"/></svg>',
				),
		}),
		Layer.succeed(IconDrawModels, {
			judgeModel: "judge",
			author: ({ messages }) =>
				Effect.sleep(script.authorDelayMs ?? 0).pipe(
					Effect.andThen(
						Effect.sync(() => {
							seen.authorTurns.push(messages.length);
							const reply = authorReplies.shift();
							const text = typeof reply === "string" ? reply : JSON.stringify(reply);
							return { content: [{ type: "text", text }], text, call: call("author") };
						}),
					),
				),
			judge: ({ lineup }) =>
				Effect.sleep(script.judgeDelayMs ?? 0).pipe(
					Effect.andThen(
						Effect.sync(() => {
							seen.judged.push([...lineup]);
							return { text: judgeReplies.shift() ?? "", call: call("judge") };
						}),
					),
				),
		}),
	);
	return { layer, seen };
}

function run(script: Script, input: unknown = { name: "Slack", svg: SLACK_SVG }) {
	const { layer, seen } = fakes(script);
	return Effect.runPromise(
		prepareIconInput(input).pipe(
			Effect.flatMap((prepared) =>
				drawIcon(prepared, { authorModel: "anthropic/claude-sonnet-5-5" }),
			),
			Effect.provide(layer),
			Effect.result,
		),
	).then((result) => ({ result, seen }));
}

describe("drawIcon", () => {
	it("drafts, reviews, accepts, and has the judge pick the source", async () => {
		const { result, seen } = await run({
			author: [
				{ accept: false, recipe: draft },
				{ accept: true, recipe: null },
			],
			judge: ['{"logo": 0}'],
		});
		expect(result._tag).toBe("Success");
		if (result._tag !== "Success") return;
		const icon = result.success;
		expect(icon.recipe).toEqual(draft);
		expect(icon.author).toMatchObject({ rounds: 2, accepted: true });
		expect(icon.author.turns.map(({ outcome }) => outcome)).toEqual(["drawn", "accepted"]);
		expect(icon.previews).toEqual({ png28: "png:png28:2", png112: "png:png112:2" });
		// The author saw the source, then its draft beside the source.
		expect(seen.authorTurns).toEqual([1, 3]);
		// One job prepared the source; the round's job exported the sheet and previews and the lineup.
		expect(seen.jobs[0]?.prepare.map(({ id }) => id)).toEqual(["source", "lineup:source"]);
		expect(seen.jobs[1]?.exports.map(({ id }) => id)).toEqual(["sheet", "png28", "png112"]);
		// Every loaded look-alike is drawn, so a spare can replace one that draws nothing.
		expect(seen.jobs[1]?.prepare).toHaveLength(8);
		// The judge saw five logos and gave no usable answer, so the drawing is marked.
		expect(seen.judged[0]).toHaveLength(5);
		expect(icon.judge).toMatchObject({ recognizable: false, attempts: 1, model: "judge" });
		expect(icon.judge.lineup).toContain("source");
		expect(icon.usage).toMatchObject({
			calls: 3,
			inputTokens: 345,
			outputTokens: 60,
			cacheReadTokens: 300,
		});
		expect(icon.excalidrawlib.libraryItems).toHaveLength(1);
		expect(icon.excalidrawlib.libraryItems[0]).toMatchObject({
			name: "Slack",
			status: "published",
		});
		expect(icon.palette).toEqual(lookAlikeMarks["slack"]!.palette);
	});

	it("draws a black mark's own black and white in ink and paper, so it inverts with the theme", async () => {
		const black = {
			parts: [
				{ kind: "rect", x: 3, y: 3, width: 18, height: 18, fill: "#000000", stroke: "#000000" },
				{ kind: "ellipse", cx: 12, cy: 12, rx: 4, ry: 4, fill: "#ffffff", stroke: "none" },
			],
		};
		const { result } = await run(
			{
				author: [
					{ accept: false, recipe: black },
					{ accept: true, recipe: null },
				],
				judge: ['{"logo": 0}'],
				palette: [["#000000", 100]],
			},
			{
				name: "Block",
				svg: '<svg viewBox="0 0 24 24"><path d="M3 3h18v18H3z" fill="#000000"/></svg>',
			},
		);
		expect(result._tag).toBe("Success");
		if (result._tag !== "Success") return;
		expect(result.success.recipe.parts).toEqual([
			{ kind: "rect", x: 3, y: 3, width: 18, height: 18, fill: "ink", stroke: "ink" },
			{ kind: "ellipse", cx: 12, cy: 12, rx: 4, ry: 4, fill: "paper", stroke: "none" },
		]);
	});

	it("asks for a fix when the checker rejects a recipe", async () => {
		const { result } = await run({
			author: ["not json", { accept: false, recipe: tooMany }, { accept: false, recipe: draft }],
			judge: [],
		});
		expect(result._tag).toBe("Success");
		if (result._tag !== "Success") return;
		expect(result.success.author.turns.map(({ outcome }) => outcome)).toEqual([
			"invalid",
			"invalid",
			"drawn",
		]);
		expect(result.success.author.turns[1]?.issues).toContain("recipe.parts must hold 1-8 parts.");
		expect(result.success.judge).toMatchObject({ recognizable: false });
	});

	it("fails when no round produces a drawable recipe", async () => {
		const { result } = await run({
			author: [
				{ accept: false, recipe: tooMany },
				{ accept: false, recipe: tooMany },
				{ accept: true, recipe: null },
			],
			judge: [],
		});
		expect(result._tag).toBe("Failure");
		if (result._tag !== "Failure") return;
		expect(result.failure).toMatchObject({ _tag: "IconRecipeError" });
	});

	it("revises once when the judge mistakes the drawing for a look-alike, and keeps a revision it then recognizes", async () => {
		// Learn the lineup the judge is shown, then script it.
		const first = await run({
			author: [
				{ accept: false, recipe: draft },
				{ accept: true, recipe: null },
			],
			judge: [],
		});
		if (first.result._tag !== "Success") throw new Error("setup failed");
		const lineup = first.result.success.judge.lineup;
		const lookAlike = lineup.find((name) => name !== "source")!;
		const position = (name: string) => JSON.stringify({ logo: lineup.indexOf(name) + 1 });
		const { result, seen: asked } = await run({
			author: [
				{ accept: false, recipe: draft },
				{ accept: true, recipe: null },
				{ accept: false, recipe: revised },
			],
			judge: [position(lookAlike), position("source")],
		});
		expect(result._tag).toBe("Success");
		if (result._tag !== "Success") return;
		expect(result.success.recipe).toEqual(revised);
		expect(result.success.judge).toMatchObject({
			recognizable: true,
			picked: "source",
			attempts: 2,
		});
		expect(result.success.author.rounds).toBe(3);
		// The revision turn showed the source and the logo it was mistaken for.
		expect(asked.authorTurns).toEqual([1, 3, 5]);
	});

	it("keeps the accepted drawing when the revision is still mistaken", async () => {
		const first = await run({
			author: [
				{ accept: false, recipe: draft },
				{ accept: true, recipe: null },
			],
			judge: [],
		});
		if (first.result._tag !== "Success") throw new Error("setup failed");
		const lineup = first.result.success.judge.lineup;
		const lookAlike = lineup.find((name) => name !== "source")!;
		const position = (name: string) => JSON.stringify({ logo: lineup.indexOf(name) + 1 });
		const { result } = await run({
			author: [
				{ accept: false, recipe: draft },
				{ accept: true, recipe: null },
				{ accept: false, recipe: revised },
			],
			judge: [position(lookAlike), position(lookAlike)],
		});
		if (result._tag !== "Success") throw new Error("draw failed");
		expect(result.success.recipe).toEqual(draft);
		expect(result.success.judge).toMatchObject({
			recognizable: false,
			picked: lookAlike,
			attempts: 2,
		});
	});
});

describe("drawIcon within its budget", () => {
	it.effect("stops starting rounds and cuts the judge off at the deadline", () =>
		Effect.gen(function* () {
			const { layer } = fakes({
				author: [
					{ accept: false, recipe: draft },
					{ accept: false, recipe: revised },
					{ accept: false, recipe: draft },
				],
				judge: ['{"logo": 1}'],
				authorDelayMs: 30_000,
				judgeDelayMs: 30_000,
			});
			const fiber = yield* Effect.forkChild(
				prepareIconInput({ name: "Slack", svg: SLACK_SVG }).pipe(
					Effect.flatMap((prepared) =>
						drawIcon(prepared, { authorModel: "anthropic/claude-sonnet-5-5" }),
					),
					Effect.provide(layer),
				),
			);
			yield* TestClock.adjust("200 seconds");
			const icon = yield* Fiber.join(fiber);
			// Two 30 s rounds fit; a third would run into the judge's reserve, and the judge's 30 s
			// call is cut off when the 85 s run out. The icon still comes back, marked.
			expect(icon.author.rounds).toBe(2);
			expect(icon.recipe).toEqual(revised);
			expect(icon.usage.ms).toBeLessThanOrEqual(ICON_DRAW_BUDGET_MS);
			expect(icon.judge).toMatchObject({ recognizable: false, attempts: 1 });
			expect(icon.judge.error).toContain("budget");
		}),
	);

	it.effect("fails with a timeout when not even a first draft fits", () =>
		Effect.gen(function* () {
			const { layer } = fakes({ author: [], judge: [], authorDelayMs: 120_000 });
			const fiber = yield* Effect.forkChild(
				prepareIconInput({ name: "Slack", svg: SLACK_SVG }).pipe(
					Effect.flatMap((prepared) =>
						drawIcon(prepared, { authorModel: "anthropic/claude-sonnet-5-5" }),
					),
					Effect.provide(layer),
					Effect.flip,
				),
			);
			yield* TestClock.adjust("200 seconds");
			expect(yield* Fiber.join(fiber)).toMatchObject({ _tag: "IconTimeoutError", stage: "author" });
		}),
	);
});

describe("the judge's lineup", () => {
	const ranked = rankLookAlikes(lookAlikeMarks["slack"]!, { name: "Slack", count: 8 }).map(
		({ slug }) => slug,
	);

	it("replaces look-alikes that fail to load with the next ranked ones", async () => {
		const unavailable = new Set(ranked.slice(0, 2));
		const { result, seen } = await run({
			// A third turn in case the judge's pick is a look-alike: the author keeps its drawing.
			author: [
				{ accept: false, recipe: draft },
				{ accept: true, recipe: null },
				{ accept: true, recipe: null },
			],
			judge: ['{"logo": 1}'],
			missing: (slug) => unavailable.has(slug),
		});
		if (result._tag !== "Success") throw new Error("draw failed");
		expect(seen.judged[0]).toHaveLength(5);
		expect([...result.success.judge.lineup].sort()).toEqual(
			["source", ...ranked.slice(2, 6)].sort(),
		);
	});

	it("does not judge without a full lineup, and says why", async () => {
		const { result, seen } = await run({
			author: [
				{ accept: false, recipe: draft },
				{ accept: true, recipe: null },
			],
			judge: ['{"logo": 1}'],
			missing: (slug) => slug !== ranked[0],
		});
		if (result._tag !== "Success") throw new Error("draw failed");
		expect(seen.judged).toEqual([]);
		expect(result.success.judge).toMatchObject({ recognizable: false, attempts: 0, lineup: [] });
		expect(result.success.judge.error).toContain("Only 1 of the 4 look-alikes");
	});
});

describe("prepareIconInput", () => {
	const png = (width: number, height: number) => {
		const bytes = new Uint8Array(33);
		bytes.set([
			0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52,
		]);
		new DataView(bytes.buffer).setUint32(16, width);
		new DataView(bytes.buffer).setUint32(20, height);
		return btoa(String.fromCharCode(...bytes));
	};
	const prepare = (body: unknown) => Effect.runPromise(prepareIconInput(body).pipe(Effect.result));

	it("accepts an SVG or a raster and names the problem otherwise", async () => {
		const svg = await prepare({ name: "  Slack  ", svg: SLACK_SVG });
		expect(svg._tag === "Success" && svg.success).toMatchObject({
			name: "Slack",
			source: { kind: "svg" },
		});
		const raster = await prepare({ name: "Acme", image: `data:image/png;base64,${png(512, 256)}` });
		expect(raster._tag === "Success" && raster.success.source).toMatchObject({
			kind: "raster",
			mimeType: "image/png",
			width: 512,
			height: 256,
		});
		const code = async (body: unknown) => {
			const result = await prepare(body);
			return result._tag === "Failure" ? result.failure.code : "ok";
		};
		expect(await code({ name: "", svg: SLACK_SVG })).toBe("invalid_name");
		expect(await code({ name: "x".repeat(49), svg: SLACK_SVG })).toBe("invalid_name");
		expect(await code({ name: "Acme" })).toBe("one_source_required");
		expect(await code({ name: "Acme", svg: SLACK_SVG, image: png(64, 64) })).toBe(
			"one_source_required",
		);
		expect(await code({ name: "Acme", svg: "<svg" })).toBe("malformed_svg");
		const nested = `<svg viewBox="0 0 1 1">${"<g>".repeat(99)}<rect width="1" height="1"/>${"</g>".repeat(99)}</svg>`;
		expect(await code({ name: "Acme", svg: nested })).toBe("svg_too_complex");
		expect(await code({ name: "Acme", image: "!!!" })).toBe("invalid_image");
		expect(await code({ name: "Acme", image: btoa("GIF89a....") })).toBe("unsupported_image");
		expect(await code({ name: "Acme", image: png(5000, 64) })).toBe("image_size");
		expect(await code("nope")).toBe("invalid_request");
	});

	it("reads JPEG and WebP sizes from their headers", () => {
		const jpeg = new Uint8Array([
			0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0x00,
			0x02, 0x00, 0x03,
		]);
		expect(rasterHeader(jpeg)).toEqual({ mimeType: "image/jpeg", width: 512, height: 256 });
		const webp = new Uint8Array(30);
		webp.set(
			[..."RIFF"].map((c) => c.charCodeAt(0)),
			0,
		);
		webp.set(
			[..."WEBPVP8X"].map((c) => c.charCodeAt(0)),
			8,
		);
		webp.set([99, 0, 0, 49, 0, 0], 24);
		expect(rasterHeader(webp)).toEqual({ mimeType: "image/webp", width: 100, height: 50 });
	});

	it("counts a mark's curve segments and picks its author by them", () => {
		const path = (d: string) => `<svg viewBox="0 0 24 24"><path d="${d}"/></svg>`;
		// Two cubic segments, one quadratic, one arc; lines and moves do not count.
		expect(svgCurveSegments(path("M0 0C1 1 2 2 3 3 4 4 5 5 6 6Q1 1 2 2L5 5a1 1 0 0 1 2 2z"))).toBe(
			4,
		);
		const curves = (count: number) => path(`M0 0${" c1 1 2 2 3 3".repeat(count)}`);
		const svg = (markup: string) => ({ kind: "svg", svg: markup, colors: [] }) as const;
		// Exponents belong to their numbers, so one command's implicit repeats all count.
		const exponents = path(`M0 0C${" 1e0 1 2 2 3 3".repeat(DETAILED_MARK_CURVES)}`);
		expect(svgCurveSegments(exponents)).toBe(DETAILED_MARK_CURVES);
		expect(svgCurveSegments(path("M0 0C1E-1 1 2 2 3 3 4e+1 4 5 5 6 6"))).toBe(2);
		expect(iconAuthorFor(svg(exponents))).toBe("anthropic/claude-opus-5-5");
		expect(iconAuthorFor(svg(SLACK_SVG))).toBe("anthropic/claude-sonnet-5-5");
		expect(iconAuthorFor(svg(curves(DETAILED_MARK_CURVES - 1)))).toBe(
			"anthropic/claude-sonnet-5-5",
		);
		expect(iconAuthorFor(svg(curves(DETAILED_MARK_CURVES)))).toBe("anthropic/claude-opus-5-5");
		expect(
			iconAuthorFor({ kind: "raster", mimeType: "image/png", base64: "", width: 64, height: 64 }),
		).toBe("anthropic/claude-opus-5-5");
	});
});

describe("author", () => {
	it("shows valid example recipes and asks for JSON", () => {
		expect(AUTHOR_SYSTEM_PROMPT).toContain('"accept"');
		const examples = AUTHOR_SYSTEM_PROMPT.split("\n").filter((line) => line.trim().startsWith("{"));
		expect(examples).toHaveLength(3);
		for (const line of examples) expect(iconRecipeIssues(JSON.parse(line))).toEqual([]);
	});

	it("hands the author a reviewer's note on a redraw, and none otherwise", () => {
		expect(draftRequestText("Hammer", [["#9179f2", 100]])).not.toContain("reviewer");
		expect(draftRequestText("Hammer", [["#9179f2", 100]], "keep the handle")).toContain(
			"A reviewer of an earlier drawing asks: keep the handle",
		);
	});

	it("reads the reply JSON, prose or fences around it", () => {
		expect(decodeAuthorReply('```json\n{"accept": true, "recipe": null}\n```')).toEqual({
			accept: true,
			recipe: null,
		});
		expect(decodeAuthorReply("no")).toBeUndefined();
		expect(decodeAuthorReply('{"recipe": {}}')).toBeUndefined();
	});

	it("takes near-misses of source colors and the edge of the grid as meant", () => {
		const { recipe, issues } = normalizeRecipe(
			{
				parts: [
					{
						kind: "rect",
						x: -1.4,
						y: 0.123,
						width: 24,
						height: 5,
						fill: "#E01E5B",
						stroke: "#000001",
						pen: 1,
						rounded: null,
					},
					{ kind: "ellipse", cx: 12, cy: 12, rx: 3, ry: 3, fill: "#FEFEFE", stroke: "none" },
				],
			},
			["#e01e5a"],
		);
		expect(issues).toEqual([]);
		expect(recipe?.parts).toEqual([
			{ kind: "rect", x: -1, y: 0.12, width: 24, height: 5, fill: "#e01e5a", stroke: "ink" },
			{ kind: "ellipse", cx: 12, cy: 12, rx: 3, ry: 3, fill: "paper", stroke: "none" },
		]);
		expect(
			normalizeRecipe(
				{ parts: [{ kind: "rect", x: 0, y: 0, width: 4, height: 4, fill: "#00ff00" }] },
				["#e01e5a"],
			).issues[0],
		).toContain("is not a source color");
	});

	it("tells a monochrome source's tone from its palette, and inks its own black or white", () => {
		expect(sourceTone([["#000000", 100]])).toBe("dark");
		expect(
			sourceTone([
				["#ffffff", 97],
				["#cccccc", 3],
			]),
		).toBe("light");
		// A pale panel with dark lines reads on white paper as drawn, so nothing inverts.
		expect(
			sourceTone([
				["#f5f8fa", 90],
				["#1c2127", 10],
			]),
		).toBeUndefined();
		expect(
			sourceTone([
				["#000000", 60],
				["#e01e5a", 40],
			]),
		).toBeUndefined();
		const parts = [
			{ kind: "rect", x: 0, y: 0, width: 4, height: 4, fill: "#000000", stroke: "#ffffff" },
			{ kind: "rect", x: 4, y: 4, width: 4, height: 4, fill: "#808080" },
		];
		// A dark mark: black is ink, white is paper, and a mid gray stays the source's gray.
		expect(normalizeRecipe({ parts }, ["#000000", "#808080"], "dark").recipe?.parts).toEqual([
			{ kind: "rect", x: 0, y: 0, width: 4, height: 4, fill: "ink", stroke: "paper" },
			{ kind: "rect", x: 4, y: 4, width: 4, height: 4, fill: "#808080" },
		]);
		// A gray that is not itself near-black, snapped to a near-black source color, is ink too.
		expect(
			normalizeRecipe(
				{ parts: [{ kind: "rect", x: 0, y: 0, width: 4, height: 4, fill: "#505050" }] },
				["#333333"],
				"dark",
			).recipe?.parts[0],
		).toMatchObject({ fill: "ink" });
		// A slate gray is not black: it stays the source's gray, in a monochrome mark too.
		expect(
			normalizeRecipe(
				{ parts: [{ kind: "rect", x: 0, y: 0, width: 4, height: 4, fill: "#5c7080" }] },
				["#5c7080", "#10161a"],
				"dark",
			).recipe?.parts[0],
		).toMatchObject({ fill: "#5c7080" });
		// A light mark swaps them.
		expect(
			normalizeRecipe({ parts: [parts[0]] }, ["#ffffff"], "light").recipe?.parts[0],
		).toMatchObject({ fill: "paper", stroke: "ink" });
		// A colored mark keeps the black it paints with.
		expect(
			normalizeRecipe({ parts: [parts[0]] }, ["#000000", "#e01e5a"]).recipe?.parts[0],
		).toMatchObject({ fill: "#000000" });
	});

	it("sends back a word that would clip past the grid", () => {
		const wide = normalizeRecipe(
			{ parts: [{ kind: "text", cx: 12, cy: 10.5, text: "tinyhttp", size: 8.5 }] },
			[],
		);
		expect(wide.recipe).toBeUndefined();
		expect(wide.issues).toEqual([expect.stringContaining('"tinyhttp"')]);
		expect(
			normalizeRecipe({ parts: [{ kind: "text", cx: 12, cy: 12, text: "tinyhttp", size: 4 }] }, [])
				.issues,
		).toEqual([]);
	});
});

describe("judge", () => {
	it("shows a fixed lineup per request and reads the pick", () => {
		const lineup = judgeLineup("Slack", ["a", "b", "c", "d"]);
		expect(lineup).toEqual(judgeLineup("Slack", ["a", "b", "c", "d"]));
		expect(lineup).toHaveLength(5);
		expect(lineup.filter((candidate) => candidate.kind === "source")).toHaveLength(1);
		expect(decodeJudgeReply('{"logo": 3}', 5)).toBe(3);
		expect(decodeJudgeReply("Logo 2", 5)).toBe(2);
		expect(decodeJudgeReply('{"logo": 9}', 5)).toBeUndefined();
	});

	it("names a source's exact paints by the share its pixels cover", () => {
		expect(
			sourcePalette({ kind: "svg", svg: "", colors: ["#e01e5a", "#36c5f0"] }, [
				["#36c5f1", 60],
				["#e01e5b", 30],
				["#808080", 10],
			]),
		).toEqual([
			["#36c5f0", 60],
			["#e01e5a", 30],
			["#808080", 10],
		]);
		// A gradient's blends count toward its stops, never as colors of their own.
		expect(
			sourcePalette({ kind: "svg", svg: "", colors: ["#f05a28", "#fff100"] }, [
				["#fabd0e", 47],
				["#f05a28", 43],
				["#f58b1b", 4],
			]),
		).toEqual([
			["#fff100", 47],
			["#f05a28", 47],
		]);
		// Thin teal lines on paper measure as a pale teal: a tint, not a color.
		expect(
			sourcePalette({ kind: "svg", svg: "", colors: ["#25c7b7"] }, [
				["#25c7b7", 93],
				["#d0f3f0", 4],
			]),
		).toEqual([["#25c7b7", 93]]);
	});
});
