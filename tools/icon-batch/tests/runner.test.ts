// @effect-diagnostics nodeBuiltinImport:off -- The resume harness uses real temporary run files and Node timers at the Promise adapter boundary.

import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setImmediate } from "node:timers/promises";

import { type IconRecipe } from "@sketchi/drawing";
import { type SketchiIcon } from "@sketchi/icon-catalog";
import { type IconAuthorModel } from "@sketchi/icon-draw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { attemptCeilingUsd, type BatchAuthor, drawMark, type MarkAttempt } from "../src/draw-mark";
import { initializeResvg, svgPng } from "../src/excalidraw-export";
import { promote } from "../src/promote";
import { BatchWriteError, runBatch } from "../src/runner";
import { marksToDraw } from "../src/selection";
import { verdictLine, writeSheets } from "../src/sheets";
import { RunStore } from "../src/store";
import { ledgerCsv, summarize, summaryMarkdown } from "../src/summary";

const SONNET: IconAuthorModel = "anthropic/claude-sonnet-5-5";
const OPUS: IconAuthorModel = "anthropic/claude-opus-5-5";
const authors = { first: SONNET, retry: OPUS };
const validSvg =
	'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" fill="#2496ed"/></svg>';

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
		const twoStarted = Promise.withResolvers<void>();
		const release = Promise.withResolvers<void>();
		let started = 0;
		const batch = runBatch({
			marks: ["a", "b", "c", "d", "e"].map((slug) => icon(slug)),
			store,
			concurrency: 4,
			spendCapUsd: 0.2,
			authors,
			ceilingUsd: () => 0.1,
			draw: async (_mark, author) => {
				if (++started === 2) twoStarted.resolve();
				await release.promise;
				return attempt(author, "recognized", 0.01);
			},
		});
		await twoStarted.promise;
		await setImmediate();
		const admitted = started;
		release.resolve();
		const outcome = await batch;
		expect(admitted).toBe(2);
		expect(started).toBe(5);
		expect(outcome).toMatchObject({ settled: 5, pending: 0, capped: false });
		expect(outcome.spentUsd).toBeCloseTo(0.05);
	});

	it("does not strand a waiter when settled draws spend the exact cap", async () => {
		const store = new RunStore(root);
		const ceiling = attemptCeilingUsd(OPUS);
		const draw = vi.fn(async () => attempt(OPUS, "recognized", ceiling));
		const outcome = await runBatch({
			marks: ["a", "b", "c", "d", "e"].map((slug) => icon(slug)),
			store,
			concurrency: 4,
			spendCapUsd: 4 * ceiling,
			authors: { first: OPUS, retry: OPUS },
			draw,
		});
		expect(outcome).toMatchObject({ settled: 4, pending: 1, capped: true, spentUsd: 4 * ceiling });
		expect(draw).toHaveBeenCalledTimes(4);
	}, 5_000);

	it("keeps a failed checkpoint's reservation across restart without replaying the draw", async () => {
		const store = new RunStore(root);
		const tmp = join(store.marksDir, "charged.json.tmp");
		const ceiling = attemptCeilingUsd(OPUS);
		const draw = vi
			.fn(async () => attempt(OPUS, "recognized", ceiling))
			.mockImplementationOnce(async () => {
				await mkdir(tmp);
				return attempt(OPUS, "recognized", ceiling);
			});
		const options = {
			marks: [icon("charged")],
			concurrency: 1,
			spendCapUsd: ceiling,
			authors: { first: OPUS, retry: OPUS },
		};
		const failure = await runBatch({ ...options, store, draw }).catch((error: unknown) => error);
		expect(failure).toMatchObject({ spentUsd: ceiling });
		await rm(tmp, { recursive: true });
		const restart = new RunStore(root);
		for (const spendCapUsd of [ceiling, 2 * ceiling]) {
			const outcome = await runBatch({ ...options, store: restart, spendCapUsd, draw });
			expect(outcome).toMatchObject({
				settled: 0,
				pending: 1,
				spentUsd: ceiling,
				unresolved: ["charged"],
			});
		}
		const unresolved = await restart.records();
		expect(summarize(unresolved)).toMatchObject({ attempts: 0, unresolved: 1, costUsd: ceiling });
		expect(ledgerCsv(unresolved)).toContain("charged,CHARGED,devtools-ci,unresolved,0,");
		if (!(failure instanceof BatchWriteError)) throw new Error("Expected a write failure");
		for (const replacement of failure.unwritten) await restart.save(replacement);
		const reconciled = await runBatch({ ...options, store: restart, draw });
		expect(reconciled).toMatchObject({ settled: 1, pending: 0, spentUsd: ceiling, unresolved: [] });
		expect(draw).toHaveBeenCalledTimes(1);
	});

	it("does not dispatch if the reservation cannot be written", async () => {
		const store = new RunStore(root);
		await mkdir(join(store.marksDir, "blocked.json.tmp"), { recursive: true });
		const draw = vi.fn(async () => attempt(SONNET, "recognized"));
		await expect(
			runBatch({
				marks: [icon("blocked")],
				store,
				concurrency: 1,
				spendCapUsd: 2,
				authors,
				draw,
			}),
		).rejects.toMatchObject({ spentUsd: 0 });
		expect(draw).not.toHaveBeenCalled();
		expect(await store.records()).toEqual([]);
	});

	it.each(["preview", "record"] as const)(
		"closes admissions on a failed %s write, then drains and charges the live draw",
		async (step) => {
			const writing = Promise.withResolvers<void>();
			const failWrite = Promise.withResolvers<void>();
			const finishLive = Promise.withResolvers<void>();
			const liveStarted = Promise.withResolvers<void>();
			const writeEnded = Promise.withResolvers<void>();
			const fail = async (write: () => Promise<void>) => {
				writing.resolve();
				await failWrite.promise;
				try {
					await write();
				} finally {
					writeEnded.resolve();
				}
			};
			const store = new RunStore(root);
			const broken = icon("broken");
			const { previews: _, ...previous } = attempt(SONNET, "missed", 0.125);
			const checkpoint = { ...broken, attempts: [previous] };
			await store.save(checkpoint);
			if (step === "preview") {
				const savePreviews = store.savePreviews.bind(store);
				vi.spyOn(store, "savePreviews").mockImplementation((slug, index, previews) => {
					if (slug !== broken.slug) return savePreviews(slug, index, previews);
					return fail(async () => {
						await mkdir(store.previewPath(slug, index, 28), { recursive: true });
						await savePreviews(slug, index, previews);
					});
				});
			} else {
				const save = store.save.bind(store);
				vi.spyOn(store, "save").mockImplementation((record) => {
					if (record.slug !== broken.slug || record.reservation) return save(record);
					return fail(async () => {
						await mkdir(join(store.marksDir, `${broken.slug}.json.tmp`));
						await save(record);
					});
				});
			}

			const draws: string[] = [];
			const marks = [broken, icon("live"), icon("waiting"), icon("queued")];
			const options = {
				store,
				marks,
				authors,
				concurrency: 3,
				ceilingUsd: () => 1,
				spendCapUsd: 2.125,
			};
			let finished = false;
			const failure = runBatch({
				...options,
				draw: async (mark, author, index) => {
					draws.push(`${mark.slug}:${index}`);
					if (mark.slug === "live") {
						liveStarted.resolve();
						await finishLive.promise;
					}
					return attempt(author, "recognized", mark.slug === "live" ? 0.25 : 0.5);
				},
			}).catch((error: unknown) => {
				finished = true;
				return error;
			});
			await Promise.all([liveStarted.promise, writing.promise]);
			await setImmediate();
			const beforeFailure = [...draws].sort();
			failWrite.resolve();
			await writeEnded.promise;
			await setImmediate();
			const finishedBeforeDrain = finished;
			finishLive.resolve();
			const error = await failure;
			expect({ beforeFailure, draws: draws.sort(), finishedBeforeDrain }).toEqual({
				beforeFailure: ["broken:1", "live:0"],
				draws: ["broken:1", "live:0"],
				finishedBeforeDrain: false,
			});
			expect(error).toMatchObject({ spentUsd: step === "record" ? 1.375 : 0.875 });
			const records = await store.records();
			expect(records.find((record) => record.slug === "live")).toMatchObject({
				status: "recognized",
				attempts: [{ costUsd: 0.25 }],
			});
			const saved = records.find((record) => record.slug === "broken");
			if (step === "record") {
				expect(saved).toMatchObject({
					...checkpoint,
					reservation: { author: OPUS, ceilingUsd: 1 },
				});
				expect(saved).not.toHaveProperty("status");
				expect(error).toMatchObject({
					unwritten: [{ slug: "broken", attempts: [previous, { costUsd: 0.5, logIds: ["log"] }] }],
				});
			} else {
				expect(saved).toMatchObject({
					status: "recognized",
					attempts: [previous, { costUsd: 0.5 }],
				});
				expect(error).toMatchObject({ unwritten: [] });
				const resumed: string[] = [];
				const outcome = await runBatch({
					...options,
					draw: async (mark, author) => {
						resumed.push(mark.slug);
						return attempt(author, "recognized", 0.125);
					},
				});
				expect(resumed).toEqual(["waiting", "queued"]);
				expect(outcome).toMatchObject({ settled: 4, spentUsd: 1.125 });
			}
		},
	);

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

it("charges the failed draw's ceiling when its log never prices and does not replay the POST", async () => {
	await initializeResvg();
	vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
	try {
		const store = new RunStore(root);
		const reading = Promise.withResolvers<void>();
		let posts = 0;
		const fetch: typeof globalThis.fetch = async (_input, init) => {
			if (init?.method === "POST") {
				posts++;
				return Response.json(
					{ type: "error", error: { type: "invalid_request_error", message: "refused" } },
					{ status: 400, headers: { "cf-aig-log-id": "log-1" } },
				);
			}
			reading.resolve();
			return Response.json({ result: {} });
		};
		const ceiling = attemptCeilingUsd(SONNET);
		const batch = runBatch({
			marks: [icon("unpriced"), icon("next")],
			store,
			concurrency: 1,
			spendCapUsd: ceiling,
			authors: { first: SONNET, retry: SONNET },
			draw: (mark, author) =>
				drawMark(
					{ accountId: "acct", token: "token", fetch },
					{
						slug: mark.slug,
						name: mark.name,
						author,
						traceId: "unpriced-draw",
						loadCatalogSvg: async (slug) => (slug === mark.slug ? validSvg : undefined),
					},
				),
		});
		expect(await Promise.race([reading.promise, batch])).toBeUndefined();
		await vi.advanceTimersByTimeAsync(30_000);
		expect(await batch).toMatchObject({ capped: true, pending: 2, spentUsd: ceiling });
		expect(posts).toBe(1);
		const [record] = await store.records();
		expect(record?.attempts).toMatchObject([
			{ outcome: "failed", estimatedCostUsd: ceiling, logIds: ["log-1"] },
		]);
		expect(record?.attempts[0]).not.toHaveProperty("costUsd");
	} finally {
		vi.useRealTimers();
	}
});

it.each(["disconnect", "refusal", "invalid SVG", "missing source", "oversized note"] as const)(
	"distinguishes an unpriced model POST from pre-dispatch failure: %s",
	async (failure) => {
		await initializeResvg();
		const requests: (string | undefined)[] = [];
		const fetch: typeof globalThis.fetch = async (_input, init) => {
			requests.push(init?.method);
			if (failure === "disconnect") throw new TypeError("connection lost after sending");
			return Response.json(
				{ type: "error", error: { type: "invalid_request_error", message: "refused" } },
				{ status: 400 },
			);
		};
		const mark = await drawMark(
			{ accountId: "acct", token: "token", fetch },
			{
				slug: "source",
				name: "Source",
				author: SONNET,
				traceId: "dispatch-proof",
				// 257 characters, 1028 UTF-8 bytes.
				...(failure === "oversized note" ? { note: "🖍".repeat(257) } : {}),
				loadCatalogSvg: async (slug) => {
					if (slug !== "source") return undefined;
					if (failure === "missing source") throw new Error("source unreadable");
					return failure === "invalid SVG" ? "not an SVG" : validSvg;
				},
			},
		);
		const sent = failure === "disconnect" || failure === "refusal";
		expect({ requests, mark }).toMatchObject({
			requests: sent ? ["POST"] : [],
			mark: {
				outcome: "failed",
				logIds: [],
				estimatedCostUsd: sent ? attemptCeilingUsd(SONNET) : 0,
			},
		});
		expect(mark).not.toHaveProperty("costUsd");
	},
);

it.each(["missing", "reported"] as const)(
	"accounts for a successful draw with %s judge usage",
	async (usage) => {
		const dispatches: string[] = [];
		let authors = 0;
		const fetch: typeof globalThis.fetch = async (_url, init) => {
			const operation = JSON.parse(new Headers(init?.headers).get("cf-aig-metadata") ?? "{}") as {
				sketchiOperation?: string;
			};
			dispatches.push(`${init?.method}:${operation.sketchiOperation}`);
			if (operation.sketchiOperation === "icon-author") {
				const reply = authors++ === 0 ? { accept: false, recipe } : { accept: true, recipe: null };
				return Response.json({
					id: "msg_test",
					type: "message",
					role: "assistant",
					model: "claude-sonnet-5-5",
					content: [{ type: "text", text: JSON.stringify(reply) }],
					stop_reason: "end_turn",
					stop_sequence: null,
					usage: { input_tokens: 1, output_tokens: 1 },
				});
			}
			if (usage === "missing") return Response.json({});
			return Response.json({
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
						content: [{ type: "output_text", annotations: [], text: '{"logo":0}' }],
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
		};
		const result = await drawMark(
			{ accountId: "acct", token: "token", fetch },
			{
				slug: "docker",
				name: "Docker",
				author: SONNET,
				traceId: "judge-usage",
				loadCatalogSvg: async () => validSvg,
			},
		);
		expect(dispatches).toEqual(["POST:icon-author", "POST:icon-author", "POST:icon-judge"]);
		expect(result).toMatchObject({ outcome: "drawn", logIds: [] });
		expect(result.estimatedCostUsd).toBeCloseTo(
			usage === "missing" ? attemptCeilingUsd(SONNET) : 0.000844,
			9,
		);
	},
);

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
