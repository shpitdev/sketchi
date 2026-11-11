import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { IconRecipe } from "@sketchi/diagram-core";
import type { SketchiIcon } from "@sketchi/icon-catalog";
import type { IconAuthorModel } from "@sketchi/icon-draw";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { attemptCeilingUsd, type BatchAuthor, type MarkAttempt, priceLogs } from "./draw-mark.js";
import { initializeResvg, svgPng } from "./excalidraw-export.js";
import { verdictLine, writeSheets } from "./sheets.js";
import { promote } from "./promote.js";
import { runBatch } from "./runner.js";
import { marksToDraw } from "./selection.js";
import { RunStore } from "./store.js";
import { ledgerCsv, summarize, summaryMarkdown } from "./summary.js";

const SONNET: IconAuthorModel = "anthropic/claude-sonnet-5-5";
const OPUS: IconAuthorModel = "anthropic/claude-opus-5-5";
const authors = { first: SONNET, retry: OPUS };

const icon = (slug: string, collection = "devtools-ci"): SketchiIcon => ({
	slug,
	name: slug.toUpperCase(),
	collection,
	colorMode: "multicolor",
	aliases: [],
	keywords: [],
	bytes: 100,
	svgPath: `/output/upload-ready/svg/${collection}/${slug}.svg`,
	viewBox: { minX: 0, minY: 0, width: 24, height: 24 },
});

const recipe = { parts: [{ kind: "rect", x: 4, y: 4, width: 16, height: 16, fill: "#2496ed" }] };

function attempt(
	author: BatchAuthor,
	verdict: "recognized" | "missed" | "failed",
	costUsd = 0.02,
): MarkAttempt {
	const base = {
		// A mark left to the source is drawn by Sonnet here, as most are.
		author: author === "source" ? SONNET : author,
		startedAt: "2026-11-09T00:00:00.000Z",
		calls: 3,
		inputTokens: 10_000,
		outputTokens: 1_000,
		cacheReadTokens: 0,
		cacheWriteTokens: 0,
		ms: 20_000,
		costUsd,
		estimatedCostUsd: costUsd,
		logIds: ["log"],
	};
	if (verdict === "failed") {
		return { ...base, outcome: "failed", error: { tag: "IconRecipeError", message: "No recipe." } };
	}
	return {
		...base,
		outcome: "drawn",
		recipe: recipe as MarkAttempt["recipe"] & object,
		judge: {
			recognizable: verdict === "recognized",
			picked: verdict === "recognized" ? "source" : "lookalike",
			lineup: ["source", "lookalike", "a", "b", "c"],
			model: "gemini-3.8-flash",
			attempts: 1,
		},
		rounds: 2,
		accepted: true,
		turns: [{ outcome: "drawn" }, { outcome: "accepted" }],
		previews: { png28: "AA==", png112: "AA==" },
	};
}

let root: string;
beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "icon-batch-"));
});
afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

describe("marksToDraw", () => {
	const marks = [
		icon("a", "one"),
		icon("b", "one"),
		icon("c", "one"),
		icon("d", "two"),
		icon("e", "three"),
	];

	it("skips marks that already have a recipe", () => {
		expect(marksToDraw(marks, new Set(["b", "d"])).map((mark) => mark.slug)).toEqual([
			"a",
			"c",
			"e",
		]);
	});

	it("samples across collections in turn, the same way every time", () => {
		const sample = marksToDraw(marks, new Set(), { sample: 3 });
		expect(new Set(sample.map((mark) => mark.collection))).toEqual(
			new Set(["one", "two", "three"]),
		);
		expect(marksToDraw(marks, new Set(), { sample: 3 })).toEqual(sample);
	});

	it("refuses a slug that is not a catalog mark", () => {
		expect(() => marksToDraw(marks, new Set(), { slugs: ["a-text"] })).toThrow(/wordmarks/u);
	});
});

describe("runBatch", () => {
	it("retries a missed mark once with the stronger author, and keeps the recognized drawing", async () => {
		const store = new RunStore(root);
		const plans: Record<string, Array<"recognized" | "missed" | "failed">> = {
			first: ["recognized"],
			rescued: ["missed", "recognized"],
			missed: ["missed", "missed"],
			broken: ["failed", "failed"],
		};
		const calls: string[] = [];
		const outcome = await runBatch({
			marks: Object.keys(plans).map((slug) => icon(slug)),
			store,
			concurrency: 2,
			spendCapUsd: 10,
			authors,
			draw: async (mark, author, index) => {
				calls.push(`${mark.slug}:${author}`);
				return attempt(author, plans[mark.slug]![index]!);
			},
		});
		expect(outcome).toMatchObject({ settled: 4, pending: 0, capped: false });
		expect(calls.filter((call) => call.endsWith(OPUS)).sort()).toEqual([
			`broken:${OPUS}`,
			`missed:${OPUS}`,
			`rescued:${OPUS}`,
		]);
		const records = Object.fromEntries(
			(await store.records()).map((record) => [record.slug, record]),
		);
		expect(records["first"]).toMatchObject({ status: "recognized", chosen: 0 });
		expect(records["rescued"]).toMatchObject({ status: "recognized", chosen: 1 });
		expect(records["missed"]).toMatchObject({ status: "unrecognized", chosen: 1 });
		expect(records["broken"]?.status).toBe("failed");
		expect(records["broken"]?.chosen).toBeUndefined();

		const summary = summarize(Object.values(records));
		expect(summary).toMatchObject({
			settled: 4,
			recognized: 2,
			recognizedFirst: 1,
			rescued: 1,
			unrecognized: 1,
			failed: 1,
			attempts: 7,
		});
		expect(summary.costUsd).toBeCloseTo(0.14);
		expect(ledgerCsv(Object.values(records)).split("\n")[0]).toContain("judge_picked");
		expect(summaryMarkdown(Object.values(records), { remaining: 10 })).toContain(
			"`broken` (devtools-ci): failed, IconRecipeError",
		);
	});

	it("starts no draw that could pass the spend cap, and resumes where it stopped", async () => {
		const store = new RunStore(root);
		const marks = ["a", "b", "c", "d", "e"].map((slug) => icon(slug));
		const draw = async (_mark: unknown, author: BatchAuthor) => attempt(author, "recognized", 0.05);
		// Each draw holds its $0.06 ceiling: $0.20 fits three, one at a time.
		const ceilingUsd = () => 0.06;
		const stopped = await runBatch({
			marks,
			store,
			concurrency: 1,
			spendCapUsd: 0.2,
			authors,
			draw,
			ceilingUsd,
		});
		expect(stopped).toMatchObject({ settled: 3, pending: 2, capped: true });
		expect(stopped.spentUsd).toBeCloseTo(0.15);

		const resumed = await runBatch({
			marks,
			store,
			concurrency: 2,
			spendCapUsd: 1,
			authors,
			draw,
			ceilingUsd,
		});
		expect(resumed).toMatchObject({ settled: 5, pending: 0, capped: false });
		expect(resumed.spentUsd).toBeCloseTo(0.25);
	});

	it("bounds each attempt by the most it can cost, so a dear draw never passes the cap", async () => {
		// A draw at the engine's limits costs far more than a typical one; a $0.10 cap fits none.
		expect(attemptCeilingUsd(SONNET)).toBeGreaterThan(0.3);
		expect(attemptCeilingUsd(OPUS)).toBeGreaterThan(attemptCeilingUsd(SONNET));
		const store = new RunStore(root);
		let draws = 0;
		const outcome = await runBatch({
			marks: [icon("dear")],
			store,
			concurrency: 1,
			spendCapUsd: 0.1,
			authors,
			draw: async (_mark, author) => {
				draws += 1;
				return attempt(author, "recognized", 0.2);
			},
		});
		expect(draws).toBe(0);
		expect(outcome).toMatchObject({ settled: 0, pending: 1, capped: true, spentUsd: 0 });
	});

	it("waits for draws in flight to settle before deciding the cap is reached", async () => {
		const store = new RunStore(root);
		// Two $0.10 ceilings fill a $0.20 cap, but each draw costs a cent: all five fit.
		const outcome = await runBatch({
			marks: ["a", "b", "c", "d", "e"].map((slug) => icon(slug)),
			store,
			concurrency: 4,
			spendCapUsd: 0.2,
			authors,
			ceilingUsd: () => 0.1,
			draw: async (_mark, author) => {
				await new Promise((resolve) => setTimeout(resolve, 5));
				return attempt(author, "recognized", 0.01);
			},
		});
		expect(outcome).toMatchObject({ settled: 5, pending: 0, capped: false });
		expect(outcome.spentUsd).toBeCloseTo(0.05);
	});

	it("keeps a draw that throws as a failed attempt counted at its ceiling", async () => {
		const store = new RunStore(root);
		const outcome = await runBatch({
			marks: [icon("broken")],
			store,
			concurrency: 1,
			spendCapUsd: 10,
			authors,
			ceilingUsd: (author) => (author === SONNET ? 0.5 : 1),
			draw: async () => {
				throw new Error("logs unreachable");
			},
		});
		expect(outcome).toMatchObject({ settled: 1, capped: false });
		expect(outcome.spentUsd).toBeCloseTo(1.5);
		const [record] = await store.records();
		expect(record?.status).toBe("failed");
		expect(record?.attempts.map((done) => done.error)).toEqual([
			{ tag: "Defect", message: "logs unreachable" },
			{ tag: "Defect", message: "logs unreachable" },
		]);
	});

	it("leaves the first author to the source, holding the dearer model's ceiling, and retries with Opus", async () => {
		expect(attemptCeilingUsd("source")).toBe(attemptCeilingUsd(OPUS));
		const store = new RunStore(root);
		const calls: BatchAuthor[] = [];
		const held: BatchAuthor[] = [];
		const outcome = await runBatch({
			marks: [icon("missed")],
			store,
			concurrency: 1,
			spendCapUsd: 10,
			authors: { first: "source", retry: OPUS },
			ceilingUsd: (author) => {
				held.push(author);
				return 1;
			},
			draw: async (_mark, author) => {
				calls.push(author);
				return attempt(author, "missed");
			},
		});
		expect(outcome).toMatchObject({ settled: 1, capped: false });
		expect(calls).toEqual(["source", OPUS]);
		expect(held).toContain("source");
		const [record] = await store.records();
		// The attempt records the model the source chose.
		expect(record?.attempts.map((done) => done.author)).toEqual([SONNET, OPUS]);
	});

	it("counts a mark the cap left pending in spend and in the ledger", async () => {
		const store = new RunStore(root);
		// The Sonnet attempt fits; the Opus retry's ceiling does not.
		const outcome = await runBatch({
			marks: [icon("halfway")],
			store,
			concurrency: 1,
			spendCapUsd: 0.5,
			authors,
			ceilingUsd: (author) => (author === SONNET ? 0.1 : 1),
			draw: async (_mark, author) => attempt(author, "missed", 0.02),
		});
		expect(outcome).toMatchObject({ settled: 0, pending: 1, capped: true });
		const records = await store.records();
		expect(summarize(records)).toMatchObject({ settled: 0, pending: 1, attempts: 1 });
		expect(summarize(records).costUsd).toBeCloseTo(0.02);
		const [, row] = ledgerCsv(records).split("\n");
		expect(row).toMatch(/^halfway,HALFWAY,devtools-ci,pending,1,/u);
	});
});

describe("priceLogs", () => {
	const fast = { attempts: 2, waitMs: 1 };

	it("sums the gateway's prices once every log has one", async () => {
		const access = {
			accountId: "acct",
			token: "token",
			fetch: async (url: string | URL | Request) =>
				Response.json({
					result: {
						cost: (url instanceof Request ? url.url : url.toString()).endsWith("/a") ? 0.01 : 0.02,
					},
				}),
		};
		expect(await priceLogs(access, ["a", "b"], fast)).toBeCloseTo(0.03);
	});

	it("leaves the price unresolved, without throwing, when the logs cannot be read", async () => {
		const unreachable = {
			accountId: "acct",
			token: "token",
			fetch: async () => {
				throw new Error("network down");
			},
		};
		expect(await priceLogs(unreachable, ["a"], fast)).toBeUndefined();
		const malformed = {
			accountId: "acct",
			token: "token",
			fetch: async () => new Response("not json"),
		};
		expect(await priceLogs(malformed, ["a"], fast)).toBeUndefined();
	});
});

describe("writeSheets", () => {
	it("puts recognized marks and the rest on separate sheets", async () => {
		await initializeResvg();
		const png = Buffer.from(
			svgPng(
				'<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="#2496ed"/></svg>',
			),
		).toString("base64");
		const store = new RunStore(root);
		const plans: Record<string, Array<"recognized" | "missed" | "failed">> = {
			docker: ["recognized"],
			github: ["missed", "missed"],
			redis: ["failed", "failed"],
		};
		await runBatch({
			marks: Object.keys(plans).map((slug) => icon(slug)),
			store,
			concurrency: 1,
			spendCapUsd: 10,
			authors,
			draw: async (mark, author, index) => ({
				...attempt(author, plans[mark.slug]![index]!),
				previews: { png28: png, png112: png },
			}),
		});
		const records = Object.fromEntries(
			(await store.records()).map((record) => [record.slug, record]),
		);
		expect(verdictLine(records["docker"]!)).toBe("recognized | sonnet-5-5 r2 1p $0.020");
		expect(verdictLine(records["github"]!)).toBe("judge picked lookalike | opus-5-5 r2 1p $0.040");
		expect(verdictLine(records["redis"]!)).toBe("failed: IconRecipeError");
		const written = await writeSheets(store, async () => undefined, join(root, "sheets"));
		expect(written.map((path) => path.slice(root.length))).toEqual([
			"/sheets/recognized-01.png",
			"/sheets/review-01.png",
		]);
	});
});

describe("promote", () => {
	it("writes recognized, unrejected marks and never replaces a recipe", async () => {
		const store = new RunStore(root);
		const plans: Record<string, "recognized" | "missed"> = {
			kept: "recognized",
			rejected: "recognized",
			missed: "missed",
		};
		await runBatch({
			marks: Object.keys(plans).map((slug) => icon(slug)),
			store,
			concurrency: 1,
			spendCapUsd: 10,
			authors,
			draw: async (mark, author) => attempt(author, plans[mark.slug]!),
		});
		const records = await store.records();
		const first = await promote(records, root, new Set(["rejected"]));
		expect(first.written).toEqual(["kept"]);
		expect(first.skipped).toEqual([{ slug: "rejected", reason: "rejected in review" }]);
		const again = await promote(records, root, new Set(["rejected"]));
		expect(again.written).toEqual([]);
		expect(again.skipped).toContainEqual({ slug: "kept", reason: "already has a recipe" });
	});

	it("leaves out a recipe whose word would clip past the grid", async () => {
		const store = new RunStore(root);
		const wide: IconRecipe = {
			parts: [{ kind: "text", cx: 12, cy: 10.5, text: "tinyhttp", size: 8.5 }],
		};
		await runBatch({
			marks: [icon("tinyhttp")],
			store,
			concurrency: 1,
			spendCapUsd: 10,
			authors,
			draw: async (_mark, author) => ({ ...attempt(author, "recognized"), recipe: wide }),
		});
		const { written, skipped } = await promote(await store.records(), root, new Set());
		expect(written).toEqual([]);
		expect(skipped).toEqual([{ slug: "tinyhttp", reason: expect.stringContaining('"tinyhttp"') }]);
	});
});
