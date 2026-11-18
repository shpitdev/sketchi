import type { IconAuthorModel } from "@sketchi/icon-draw";
import { Data, Deferred, Effect, Result } from "effect";

import { attemptCeilingUsd, type BatchAuthor, type MarkAttempt } from "./draw-mark";
import type { CatalogMark } from "./selection";
import {
	attemptCost,
	type MarkRecord,
	recordCost,
	type RunStore,
	type StoredAttempt,
} from "./store";

export interface RunOptions {
	readonly marks: readonly CatalogMark[];
	readonly store: RunStore;
	/** Draws in flight at once. */
	readonly concurrency: number;
	/** No draw starts once spend, with what is in flight, could pass this. */
	readonly spendCapUsd: number;
	/** First author, then a separate stronger draw if the mark is not recognized. */
	readonly authors: { readonly first: BatchAuthor; readonly retry: IconAuthorModel };
	readonly draw: (mark: CatalogMark, author: BatchAuthor, attempt: number) => Promise<MarkAttempt>;
	readonly log?: (line: string) => void;
	/** The most one attempt by this author can cost; the cap holds as long as no attempt exceeds it. */
	readonly ceilingUsd?: (author: BatchAuthor) => number;
}

export interface RunOutcome {
	readonly settled: number;
	readonly pending: number;
	readonly spentUsd: number;
	/** True when the spend cap left a mark unsettled. */
	readonly capped: boolean;
}

export class BatchWriteError extends Data.TaggedError("BatchWriteError")<{
	readonly message: string;
	readonly spentUsd: number;
	/** Full replacements for mark records that could not be saved. */
	readonly unwritten: readonly MarkRecord[];
	readonly cause: unknown;
}> {}

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

const messageOf = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

const runWorkers = Effect.fn("sketchi.iconBatch.run")(function* (options: RunOptions) {
	const ceiling = options.ceilingUsd ?? attemptCeilingUsd;
	const records = yield* Effect.tryPromise(() => options.store.records());
	const existing = new Map(records.map((record) => [record.slug, record]));
	const queue = options.marks.filter((mark) => existing.get(mark.slug)?.status === undefined);
	let settled = options.marks.length - queue.length;
	let spent = records.reduce((sum, record) => sum + recordCost(record), 0);
	let held = 0;
	let capped = false;
	let changed = Deferred.makeUnsafe<void>();
	let firstFailure: { readonly operation: string; readonly cause: unknown } | undefined;
	const unwritten: MarkRecord[] = [];

	const wakeClaims = () => {
		const previous = changed;
		changed = Deferred.makeUnsafe();
		Deferred.doneUnsafe(previous, Effect.void);
	};
	const stop = (operation: string, cause: unknown) => {
		if (firstFailure !== undefined) return;
		firstFailure = { operation, cause };
		wakeClaims();
	};
	const claim = Effect.fnUntraced(function* (reservation: number) {
		while (!firstFailure) {
			if (spent + held + reservation <= options.spendCapUsd) {
				held += reservation;
				return true;
			}
			if (held === 0) {
				capped = true;
				return false;
			}
			yield* Deferred.await(changed);
		}
		return false;
	});
	const save = Effect.fnUntraced(function* (record: MarkRecord) {
		const saved = yield* Effect.result(Effect.tryPromise(() => options.store.save(record)));
		if (Result.isFailure(saved)) {
			unwritten.push(record);
			stop(`mark record for ${record.slug}`, saved.failure.cause);
		} else if (record.status !== undefined) {
			settled += 1;
		}
	});

	const plan: readonly BatchAuthor[] = [options.authors.first, options.authors.retry];
	const work = Effect.fnUntraced(function* (mark: CatalogMark) {
		if (firstFailure) return;
		let attempts = [...(existing.get(mark.slug)?.attempts ?? [])];
		if (attempts.length >= plan.length || attempts.some((done) => done.judge?.recognizable)) {
			yield* save(settle(mark, attempts, true));
			return;
		}
		for (const author of plan.slice(attempts.length)) {
			const reservation = ceiling(author);
			if (!(yield* claim(reservation))) return;
			const index = attempts.length;
			const startedAt = new Date().toISOString();
			const { previews, ...stored } = yield* Effect.tryPromise(() =>
				options.draw(mark, author, index),
			).pipe(
				Effect.orElseSucceed(({ cause }): MarkAttempt => ({
					...(author === "source" ? {} : { author }),
					startedAt,
					outcome: "failed",
					error: { tag: "Defect", message: messageOf(cause) },
					calls: 0,
					inputTokens: 0,
					outputTokens: 0,
					cacheReadTokens: 0,
					cacheWriteTokens: 0,
					ms: 0,
					// A callback that throws without reporting dispatch is an unknown outcome.
					estimatedCostUsd: reservation,
					logIds: [],
				})),
			);
			// Keep the reservation until the checkpoint finishes, even after this draw is priced.
			// Admissions see either the whole reservation or the charge, never a gap or both.
			if (previews) {
				const preview = yield* Effect.result(
					Effect.tryPromise(() => options.store.savePreviews(mark.slug, index, previews)),
				);
				if (Result.isFailure(preview)) stop(`previews for ${mark.slug}`, preview.failure.cause);
			}
			attempts = [...attempts, stored];
			const record = settle(mark, attempts, attempts.length >= plan.length);
			// The recipe and charge are still recoverable without its preview PNGs.
			yield* save(record);
			spent += attemptCost(stored);
			held -= reservation;
			wakeClaims();
			options.log?.(
				`${mark.slug} ${(stored.author ?? author).replace("anthropic/claude-", "")}: ${stored.outcome === "failed" ? `failed (${stored.error?.tag})` : stored.judge?.recognizable ? "recognized" : `judge picked ${stored.judge?.picked ?? "nothing"}`} $${attemptCost(stored).toFixed(4)} ${(stored.ms / 1000).toFixed(1)}s | spent $${spent.toFixed(2)}`,
			);
			if (record.status !== undefined) return;
		}
	});

	// A cap rejection doesn't stop other marks: a cheaper draw may still fit.
	// A write failure closes admissions instead of failing the traversal: already admitted
	// draws must finish and checkpoint their cost, not be interrupted as if that were a refund.
	yield* Effect.forEach(queue, work, {
		concurrency: Math.max(1, Math.floor(options.concurrency)),
		discard: true,
	});
	if (firstFailure !== undefined) {
		const { operation, cause } = firstFailure;
		const recovery =
			unwritten.length === 0 ? "" : " Reconcile unwritten mark records before resuming.";
		return yield* new BatchWriteError({
			message: `Could not save ${operation}: ${messageOf(cause)}. Accounted $${spent.toFixed(4)}.${recovery}`,
			spentUsd: spent,
			unwritten,
			cause,
		});
	}
	return {
		settled,
		pending: options.marks.length - settled,
		spentUsd: spent,
		capped: capped && settled < options.marks.length,
	} satisfies RunOutcome;
});

/** Own the worker traversal until every admitted draw has been accounted for. */
export function runBatch(options: RunOptions): Promise<RunOutcome> {
	return Effect.runPromise(runWorkers(options));
}
