import type { IconAuthorModel } from "@sketchi/icon-draw";

import { attemptCeilingUsd, type MarkAttempt } from "./draw-mark.js";
import type { CatalogMark } from "./selection.js";
import {
	attemptCost,
	type MarkRecord,
	recordCost,
	type RunStore,
	type StoredAttempt,
} from "./store.js";

export interface RunOptions {
	readonly marks: readonly CatalogMark[];
	readonly store: RunStore;
	/** Draws in flight at once. */
	readonly concurrency: number;
	/** No draw starts once spend, with what is in flight, could pass this. */
	readonly spendCapUsd: number;
	/** The service's author; then one retry with the stronger one for a mark the judge did not recognize. */
	readonly authors: { readonly first: IconAuthorModel; readonly retry: IconAuthorModel };
	readonly draw: (
		mark: CatalogMark,
		author: IconAuthorModel,
		attempt: number,
	) => Promise<MarkAttempt>;
	readonly log?: (line: string) => void;
	/** The most one attempt by this author can cost; the cap holds as long as no attempt exceeds it. */
	readonly ceilingUsd?: (author: IconAuthorModel) => number;
}

export interface RunOutcome {
	readonly settled: number;
	readonly pending: number;
	readonly spentUsd: number;
	/** True when the spend cap left a mark unsettled. */
	readonly capped: boolean;
}

function settle(mark: CatalogMark, attempts: readonly StoredAttempt[], final: boolean): MarkRecord {
	const recognized = attempts.findIndex((attempt) => attempt.judge?.recognizable === true);
	const drawn = attempts.map((attempt) => attempt.outcome === "drawn");
	const lastDrawn = drawn.lastIndexOf(true);
	const chosen = recognized >= 0 ? recognized : lastDrawn >= 0 ? lastDrawn : undefined;
	const status =
		recognized >= 0
			? "recognized"
			: !final
				? undefined
				: lastDrawn >= 0
					? "unrecognized"
					: "failed";
	return {
		...mark,
		attempts,
		...(status === undefined ? {} : { status }),
		...(chosen === undefined ? {} : { chosen }),
	};
}

/**
 * Draw every mark that is not settled yet, a few at a time: the first author,
 * then one retry with the stronger author when the judge did not recognize the
 * drawing or no drawing came back. Each attempt is saved as it finishes, and
 * no draw starts that could take spend past the cap.
 */
export async function runBatch(options: RunOptions): Promise<RunOutcome> {
	const log = options.log ?? (() => undefined);
	const ceiling = options.ceilingUsd ?? attemptCeilingUsd;
	const existing = new Map((await options.store.records()).map((record) => [record.slug, record]));
	let spent = [...existing.values()].reduce((sum, record) => sum + recordCost(record), 0);
	let inFlight = 0;
	let capped = false;
	let waiting: Array<() => void> = [];
	/**
	 * Claim room under the cap for one attempt at its most: wait while attempts in
	 * flight hold the room it needs, and give up only when nothing is in flight.
	 */
	const claim = async (author: IconAuthorModel) => {
		for (;;) {
			if (spent + inFlight + ceiling(author) <= options.spendCapUsd) {
				inFlight += ceiling(author);
				return true;
			}
			if (inFlight === 0) {
				capped = true;
				return false;
			}
			await new Promise<void>((resolve) => waiting.push(resolve));
		}
	};
	const release = (held: number) => {
		inFlight -= held;
		const woken = waiting;
		waiting = [];
		for (const wake of woken) wake();
	};

	const queue = options.marks.filter((mark) => existing.get(mark.slug)?.status === undefined);
	let settled = options.marks.length - queue.length;
	let next = 0;

	const attempt = async (
		mark: CatalogMark,
		author: IconAuthorModel,
		index: number,
	): Promise<StoredAttempt> => {
		const held = ceiling(author);
		const startedAt = new Date().toISOString();
		try {
			const { previews, ...stored } = await options
				.draw(mark, author, index)
				.catch((cause: unknown): MarkAttempt => ({
					author,
					startedAt,
					outcome: "failed",
					error: {
						tag: "Defect",
						message: cause instanceof Error ? cause.message : String(cause),
					},
					calls: 0,
					inputTokens: 0,
					outputTokens: 0,
					cacheReadTokens: 0,
					cacheWriteTokens: 0,
					ms: 0,
					// Whether it reached a model is unknown, so it counts at its most.
					estimatedCostUsd: held,
					logIds: [],
				}));
			if (previews) await options.store.savePreviews(mark.slug, index, previews);
			spent += attemptCost(stored);
			return stored;
		} finally {
			release(held);
		}
	};

	/** Settle one mark; false when the cap left it pending. */
	const work = async (mark: CatalogMark) => {
		let attempts = [...(existing.get(mark.slug)?.attempts ?? [])];
		const plan = [options.authors.first, options.authors.retry];
		while (attempts.length < plan.length) {
			if (attempts.some((done) => done.judge?.recognizable === true)) break;
			const author = plan[attempts.length]!;
			if (!(await claim(author))) return false;
			attempts = [...attempts, await attempt(mark, author, attempts.length)];
			const final = attempts.length >= plan.length || attempts.at(-1)?.judge?.recognizable === true;
			await options.store.save(settle(mark, attempts, final));
			const last = attempts.at(-1)!;
			log(
				`${mark.slug} ${author.replace("anthropic/claude-", "")}: ${last.outcome === "failed" ? `failed (${last.error?.tag})` : last.judge?.recognizable ? "recognized" : `judge picked ${last.judge?.picked ?? "nothing"}`} $${attemptCost(last).toFixed(4)} ${(last.ms / 1000).toFixed(1)}s | spent $${spent.toFixed(2)}`,
			);
		}
		await options.store.save(settle(mark, attempts, true));
		settled += 1;
		return true;
	};

	// A mark the cap leaves pending does not stop the others: a cheaper attempt may still fit.
	const worker = async () => {
		while (next < queue.length) {
			const mark = queue[next]!;
			next += 1;
			await work(mark);
		}
	};
	await Promise.all(Array.from({ length: Math.max(1, options.concurrency) }, worker));
	return {
		settled,
		pending: options.marks.length - settled,
		spentUsd: spent,
		capped: capped && settled < options.marks.length,
	};
}
