import type { IconAuthorModel } from "@sketchi/icon-draw";

import type { MarkAttempt } from "./draw-mark.js";
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
}

export interface RunOutcome {
	readonly settled: number;
	readonly pending: number;
	readonly spentUsd: number;
	/** True when the spend cap stopped the run before every mark settled. */
	readonly capped: boolean;
}

/** What a draw is assumed to cost before any has finished, by author. */
const DEFAULT_RESERVE_USD: Readonly<Record<string, number>> = {
	"anthropic/claude-sonnet-5-5": 0.06,
	"anthropic/claude-opus-5-5": 0.15,
};

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
	const existing = new Map((await options.store.records()).map((record) => [record.slug, record]));
	let spent = [...existing.values()].reduce((sum, record) => sum + recordCost(record), 0);
	const highest = new Map<string, number>();
	for (const record of existing.values()) {
		for (const attempt of record.attempts) {
			highest.set(attempt.author, Math.max(highest.get(attempt.author) ?? 0, attemptCost(attempt)));
		}
	}
	const reserve = (author: string) =>
		Math.max(DEFAULT_RESERVE_USD[author] ?? 0.15, highest.get(author) ?? 0);
	let inFlight = 0;
	let capped = false;
	/** Claim room under the cap for one draw; false once there is none. */
	const claim = (author: string) => {
		if (capped || spent + inFlight + reserve(author) > options.spendCapUsd) {
			capped = true;
			return false;
		}
		inFlight += reserve(author);
		return true;
	};

	const queue = options.marks.filter((mark) => existing.get(mark.slug)?.status === undefined);
	let settled = options.marks.length - queue.length;
	let next = 0;

	const attempt = async (mark: CatalogMark, author: IconAuthorModel, index: number) => {
		const held = reserve(author);
		try {
			const result = await options.draw(mark, author, index);
			const { previews, ...stored } = result;
			if (previews) await options.store.savePreviews(mark.slug, index, previews);
			spent += attemptCost(stored);
			highest.set(author, Math.max(highest.get(author) ?? 0, attemptCost(stored)));
			return stored;
		} finally {
			inFlight -= held;
		}
	};

	const work = async (mark: CatalogMark) => {
		let attempts = [...(existing.get(mark.slug)?.attempts ?? [])];
		const plan = [options.authors.first, options.authors.retry];
		while (attempts.length < plan.length) {
			if (attempts.some((done) => done.judge?.recognizable === true)) break;
			const author = plan[attempts.length]!;
			if (!claim(author)) return false;
			attempts = [...attempts, await attempt(mark, author, attempts.length)];
			const final = attempts.length >= plan.length || attempts.at(-1)?.judge?.recognizable === true;
			const record = settle(mark, attempts, final);
			await options.store.save(record);
			const last = attempts.at(-1)!;
			log(
				`${mark.slug} ${author.replace("anthropic/claude-", "")}: ${last.outcome === "failed" ? `failed (${last.error?.tag})` : last.judge?.recognizable ? "recognized" : `judge picked ${last.judge?.picked ?? "nothing"}`} $${attemptCost(last).toFixed(4)} ${(last.ms / 1000).toFixed(1)}s | spent $${spent.toFixed(2)}`,
			);
		}
		const record = settle(mark, attempts, true);
		await options.store.save(record);
		settled += 1;
		return true;
	};

	const worker = async () => {
		while (next < queue.length && !capped) {
			const mark = queue[next]!;
			next += 1;
			if (!(await work(mark))) return;
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
