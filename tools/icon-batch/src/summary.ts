import { type MarkRecord, recordCost } from "./store.js";

export interface BatchSummary {
	readonly settled: number;
	/** Marks with an attempt that the spend cap left unsettled. */
	readonly pending: number;
	readonly recognized: number;
	/** Recognized on the service's own author, without a retry. */
	readonly recognizedFirst: number;
	/** Recognized only after the retry with the stronger author. */
	readonly rescued: number;
	readonly unrecognized: number;
	readonly failed: number;
	readonly attempts: number;
	readonly costUsd: number;
	/** Of the attempts, how many the gateway's logs priced; the rest count at their estimate. */
	readonly pricedAttempts: number;
	readonly perMark: {
		readonly costUsd: Stats;
		readonly seconds: Stats;
		readonly rounds: Stats;
		readonly parts: Stats;
		readonly recipeBytes: Stats;
		readonly calls: Stats;
		readonly inputTokens: Stats;
		readonly outputTokens: Stats;
	};
}

export interface Stats {
	readonly mean: number;
	readonly p50: number;
	readonly p90: number;
	readonly max: number;
}

function stats(values: readonly number[]): Stats {
	if (values.length === 0) return { mean: 0, p50: 0, p90: 0, max: 0 };
	const sorted = [...values].sort((left, right) => left - right);
	const at = (share: number) =>
		sorted[Math.min(sorted.length - 1, Math.floor(share * sorted.length))]!;
	return {
		mean: sorted.reduce((sum, value) => sum + value, 0) / sorted.length,
		p50: at(0.5),
		p90: at(0.9),
		max: sorted.at(-1)!,
	};
}

const chosenAttempt = (record: MarkRecord) =>
	record.chosen === undefined ? undefined : record.attempts[record.chosen];

function sumAttempts(
	record: MarkRecord,
	pick: (attempt: MarkRecord["attempts"][number]) => number,
) {
	return record.attempts.reduce((sum, attempt) => sum + pick(attempt), 0);
}

/**
 * Recognition counts settled marks only; spend, time, tokens and drawings
 * count every mark with an attempt, so a mark the cap left pending still
 * shows what it cost.
 */
export function summarize(records: readonly MarkRecord[]): BatchSummary {
	const settled = records.filter((record) => record.status !== undefined);
	const spent = records.filter((record) => record.attempts.length > 0);
	const recognized = settled.filter((record) => record.status === "recognized");
	const drawn = spent.flatMap((record) => {
		const chosen = chosenAttempt(record);
		return chosen?.recipe ? [chosen] : [];
	});
	const attempts = spent.flatMap((record) => record.attempts);
	return {
		settled: settled.length,
		pending: spent.length - settled.length,
		recognized: recognized.length,
		recognizedFirst: recognized.filter((record) => record.chosen === 0).length,
		rescued: recognized.filter((record) => (record.chosen ?? 0) > 0).length,
		unrecognized: settled.filter((record) => record.status === "unrecognized").length,
		failed: settled.filter((record) => record.status === "failed").length,
		attempts: attempts.length,
		costUsd: spent.reduce((sum, record) => sum + recordCost(record), 0),
		pricedAttempts: attempts.filter((attempt) => attempt.costUsd !== undefined).length,
		perMark: {
			costUsd: stats(spent.map(recordCost)),
			seconds: stats(spent.map((record) => sumAttempts(record, (attempt) => attempt.ms) / 1000)),
			rounds: stats(drawn.map((attempt) => attempt.rounds ?? 0)),
			parts: stats(drawn.map((attempt) => attempt.recipe?.parts.length ?? 0)),
			recipeBytes: stats(drawn.map((attempt) => JSON.stringify(attempt.recipe).length)),
			calls: stats(spent.map((record) => sumAttempts(record, (attempt) => attempt.calls))),
			inputTokens: stats(
				spent.map((record) => sumAttempts(record, (attempt) => attempt.inputTokens)),
			),
			outputTokens: stats(
				spent.map((record) => sumAttempts(record, (attempt) => attempt.outputTokens)),
			),
		},
	};
}

const CSV_COLUMNS = [
	"slug",
	"name",
	"collection",
	"status",
	"attempts",
	"author",
	"judge_picked",
	"rounds",
	"parts",
	"recipe_bytes",
	"calls",
	"input_tokens",
	"output_tokens",
	"cost_usd",
	"cost_priced",
	"seconds",
	"error",
] as const;

function csvField(value: string | number): string {
	const text = String(value);
	return /[",\n]/u.test(text) ? `"${text.replace(/"/gu, '""')}"` : text;
}

/** One row per mark with an attempt, attempts summed; a mark the cap left unsettled is `pending`. */
export function ledgerCsv(records: readonly MarkRecord[]): string {
	const rows = records
		.filter((record) => record.attempts.length > 0)
		.map((record) => {
			const chosen = chosenAttempt(record);
			const row: Record<(typeof CSV_COLUMNS)[number], string | number> = {
				slug: record.slug,
				name: record.name,
				collection: record.collection,
				status: record.status ?? "pending",
				attempts: record.attempts.length,
				author: chosen?.author ?? record.attempts.at(-1)?.author ?? "",
				judge_picked: chosen?.judge?.picked ?? "",
				rounds: chosen?.rounds ?? "",
				parts: chosen?.recipe?.parts.length ?? "",
				recipe_bytes: chosen?.recipe ? JSON.stringify(chosen.recipe).length : "",
				calls: sumAttempts(record, (attempt) => attempt.calls),
				input_tokens: sumAttempts(record, (attempt) => attempt.inputTokens),
				output_tokens: sumAttempts(record, (attempt) => attempt.outputTokens),
				cost_usd: recordCost(record).toFixed(5),
				cost_priced: record.attempts.every((attempt) => attempt.costUsd !== undefined)
					? "yes"
					: "estimate",
				seconds: (sumAttempts(record, (attempt) => attempt.ms) / 1000).toFixed(1),
				error: record.attempts.at(-1)?.error?.message ?? "",
			};
			return CSV_COLUMNS.map((column) => csvField(row[column])).join(",");
		});
	return `${[CSV_COLUMNS.join(","), ...rows].join("\n")}\n`;
}

const money = (value: number) => `$${value.toFixed(4)}`;

/** The ledger's totals as Markdown, with the marks that stay out listed. */
export function summaryMarkdown(
	records: readonly MarkRecord[],
	context: { readonly remaining: number },
): string {
	const summary = summarize(records);
	const { perMark } = summary;
	const percent = (count: number) =>
		summary.settled === 0 ? "0%" : `${Math.round((100 * count) / summary.settled)}%`;
	const row = (label: string, value: Stats, format: (value: number) => string) =>
		`| ${label} | ${format(value.mean)} | ${format(value.p50)} | ${format(value.p90)} | ${format(value.max)} |`;
	const fixed = (digits: number) => (value: number) => value.toFixed(digits);
	const out = records.filter(
		(record) => record.status === "unrecognized" || record.status === "failed",
	);
	return [
		`# Icon batch ledger`,
		"",
		`| Marks settled | Recognized | First author | After retry | Unrecognized | Failed | Pending (cap) |`,
		`| --- | --- | --- | --- | --- | --- | --- |`,
		`| ${summary.settled} | ${summary.recognized} (${percent(summary.recognized)}) | ${summary.recognizedFirst} | ${summary.rescued} | ${summary.unrecognized} | ${summary.failed} | ${summary.pending} |`,
		"",
		`Spend: ${money(summary.costUsd)} over ${summary.attempts} attempts (${summary.pricedAttempts} priced by the gateway's logs, the rest estimated). Marks not yet settled: ${context.remaining}, about ${money(perMark.costUsd.mean * context.remaining)} at this mean.`,
		"",
		`| Per mark | mean | p50 | p90 | max |`,
		`| --- | --- | --- | --- | --- |`,
		row("cost", perMark.costUsd, money),
		row("seconds", perMark.seconds, fixed(1)),
		row("model calls", perMark.calls, fixed(1)),
		row("input tokens", perMark.inputTokens, fixed(0)),
		row("output tokens", perMark.outputTokens, fixed(0)),
		row("author rounds (kept drawing)", perMark.rounds, fixed(1)),
		row("parts (kept drawing)", perMark.parts, fixed(1)),
		row("recipe bytes (kept drawing)", perMark.recipeBytes, fixed(0)),
		"",
		`## Staying out (${out.length})`,
		"",
		...out.map((record) => {
			const last = record.attempts.at(-1);
			return `- \`${record.slug}\` (${record.collection}): ${record.status === "failed" ? `failed, ${last?.error?.tag}: ${last?.error?.message}` : `judge picked ${last?.judge?.picked ?? "nothing"}`}`;
		}),
		"",
	].join("\n");
}
