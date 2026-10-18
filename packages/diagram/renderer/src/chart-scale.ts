/** Value scales, tick choice and number formatting for native charts. */

export interface ValueScale {
	readonly min: number;
	readonly max: number;
	readonly step: number;
	/** Every tick from min to max, rounded to the step's precision. */
	readonly ticks: readonly number[];
	/** Fraction digits a tick needs. */
	readonly decimals: number;
}

const STEP_MULTIPLIERS = [1, 2, 5] as const;

/** Fraction digits of a 1, 2 or 5 × 10^k step. */
function stepDecimals(step: number): number {
	return Math.max(0, -Math.floor(Math.log10(step) + 1e-9));
}

function roundTo(value: number, decimals: number): number {
	const rounded = Number(value.toFixed(decimals));
	return Object.is(rounded, -0) ? 0 : rounded;
}

/**
 * A scale whose ticks are 1, 2 or 5 × 10^n apart and cover [low, high], with
 * about `targetIntervals` intervals and never more than `maxIntervals`.
 */
export function niceScale(
	low: number,
	high: number,
	targetIntervals = 5,
	maxIntervals = 8,
): ValueScale {
	let lo = Math.min(low, high);
	let hi = Math.max(low, high);
	if (lo === hi) {
		if (lo === 0) hi = 1;
		else if (lo > 0) lo = 0;
		else hi = 0;
	}
	const span = hi - lo;
	const rough = span / Math.max(1, targetIntervals);
	const exponent = Math.floor(Math.log10(rough));
	let best: { step: number; min: number; max: number; intervals: number } | undefined;
	for (let power = exponent - 1; power <= exponent + 1; power += 1)
		for (const multiplier of STEP_MULTIPLIERS) {
			const step = multiplier * 10 ** power;
			const decimals = stepDecimals(step);
			const min = roundTo(Math.floor(lo / step + 1e-9) * step, decimals);
			const max = roundTo(Math.ceil(hi / step - 1e-9) * step, decimals);
			const intervals = Math.round((max - min) / step);
			if (intervals < 1 || intervals > maxIntervals) continue;
			const score = Math.abs(intervals - targetIntervals);
			const bestScore = best ? Math.abs(best.intervals - targetIntervals) : Infinity;
			if (score < bestScore || (score === bestScore && best && step > best.step))
				best = { step, min, max, intervals };
		}
	if (!best) {
		// Unreachable for finite input: a 10^(exponent+1) step spans at most two intervals.
		throw new Error(`No tick step covers ${lo}..${hi}.`);
	}
	const decimals = stepDecimals(best.step);
	const ticks = Array.from({ length: best.intervals + 1 }, (_, index) =>
		roundTo(best.min + index * best.step, decimals),
	);
	return { min: best.min, max: best.max, step: best.step, ticks, decimals };
}

/** Grow a scale by one step on either side, keeping its step. */
export function extendScale(scale: ValueScale, below: boolean, above: boolean): ValueScale {
	const min = below ? roundTo(scale.min - scale.step, scale.decimals) : scale.min;
	const max = above ? roundTo(scale.max + scale.step, scale.decimals) : scale.max;
	const intervals = Math.round((max - min) / scale.step);
	return {
		...scale,
		min,
		max,
		ticks: Array.from({ length: intervals + 1 }, (_, index) =>
			roundTo(min + index * scale.step, scale.decimals),
		),
	};
}

/**
 * The value range a chart's axis must show. Bars always keep zero. Lines keep
 * zero unless the data sits in a band narrower than a sixth of its magnitude,
 * where a zero baseline would flatten every change.
 */
export function valueDomain(
	values: readonly number[],
	includeZero: boolean,
): { low: number; high: number } {
	const low = Math.min(...values);
	const high = Math.max(...values);
	if (includeZero || low <= 0 !== high <= 0)
		return { low: Math.min(0, low), high: Math.max(0, high) };
	const magnitude = Math.max(Math.abs(low), Math.abs(high));
	if (high - low > magnitude / 6) return { low: Math.min(0, low), high: Math.max(0, high) };
	return { low, high };
}

export interface UnitParts {
	readonly prefix: string;
	readonly suffix: string;
}

const CURRENCY_PREFIX = /^[$€£¥₹₩₽₺₪₦฿]+/u;
const TIGHT_SUFFIX = /^(?:[%‰°]|(?:[kKMBT]|bn|MM|x)(?!\p{L}))/u;

/** Currency symbols lead the number; %, ° and scale letters follow it tightly; words follow a space. */
export function unitParts(unit: string | undefined): UnitParts {
	if (!unit) return { prefix: "", suffix: "" };
	const currency = CURRENCY_PREFIX.exec(unit)?.[0] ?? "";
	const rest = unit.slice(currency.length);
	if (currency) return { prefix: currency, suffix: rest };
	return { prefix: "", suffix: TIGHT_SUFFIX.test(rest) ? rest : ` ${rest}` };
}

/**
 * Fraction digits an authored value carries, read from its shortest
 * round-trip form, so 12345.01 keeps its cents and 0.00001 its five places.
 */
export function valueDecimals(value: number): number {
	const [mantissa = "", exponent = "0"] = Math.abs(value).toString().split("e");
	return Math.max(0, (mantissa.split(".")[1]?.length ?? 0) - Number(exponent));
}

/** Past this many fraction digits a value reads in exponent form (1.5e-9). */
const MAX_FIXED_DECIMALS = 6;

const groupedFormats = new Map<number, Intl.NumberFormat>();
function grouped(value: number, decimals: number): string {
	let format = groupedFormats.get(decimals);
	if (!format) {
		format = new Intl.NumberFormat("en-US", {
			minimumFractionDigits: decimals,
			maximumFractionDigits: decimals,
		});
		groupedFormats.set(decimals, format);
	}
	return format.format(value);
}

const COMPACT_STEPS = [
	{ size: 1e12, letter: "T" },
	{ size: 1e9, letter: "B" },
	{ size: 1e6, letter: "M" },
	{ size: 1e3, letter: "k" },
] as const;

function withUnit(magnitude: string, negative: boolean, parts: UnitParts): string {
	return `${negative ? "-" : ""}${parts.prefix}${magnitude}${parts.suffix}`;
}

/** A scale letter after another scale letter ($M → $2kM) would misstate the value. */
function compactable(parts: UnitParts): boolean {
	return !/^(?:[kKMBT]|bn|MM)/u.test(parts.suffix);
}

/**
 * A tick label. Ticks from 10,000 up drop to k/M/B/T, keeping the step's
 * precision at that scale.
 */
export function formatTick(value: number, scale: ValueScale, parts: UnitParts): string {
	const largest = Math.max(Math.abs(scale.min), Math.abs(scale.max));
	const negative = value < 0;
	const magnitude = Math.abs(value);
	// A bare scale letter on zero ("0k") reads as a typo.
	if (magnitude === 0)
		return withUnit("0", false, compactable(parts) ? parts : { ...parts, suffix: "" });
	if (largest >= 1e4 && compactable(parts)) {
		const step = COMPACT_STEPS.find((entry) => largest >= entry.size)!;
		const decimals = Math.max(0, stepDecimals(scale.step / step.size));
		return withUnit(`${grouped(magnitude / step.size, decimals)}${step.letter}`, negative, parts);
	}
	return withUnit(grouped(magnitude, scale.decimals), negative, parts);
}

/**
 * A value label that keeps every authored digit: thousands separators, k/M/B/T
 * only when the short form loses nothing ($2.5M, never 1.23M for 1,234,567),
 * and exponent form for values finer than a millionth, never a false zero.
 */
export function formatValue(
	value: number,
	parts: UnitParts,
	decimals = valueDecimals(value),
): string {
	const negative = value < 0;
	const magnitude = Math.abs(value);
	if (magnitude >= 1e6 && decimals === 0 && compactable(parts)) {
		const step = COMPACT_STEPS.find((entry) => magnitude >= entry.size)!;
		const scaled = Number((magnitude / step.size).toPrecision(12));
		if (Number(scaled.toPrecision(3)) === scaled)
			return withUnit(`${grouped(scaled, valueDecimals(scaled))}${step.letter}`, negative, parts);
	}
	if (magnitude > 0 && decimals > MAX_FIXED_DECIMALS)
		return withUnit(magnitude.toExponential(), negative, parts);
	return withUnit(grouped(magnitude, decimals), negative, parts);
}

/** Most fraction digits a pie percentage shows. */
export const PIE_MAX_DECIMALS = 2;

/**
 * Each slice's share, rounded on its own so a label always equals value ÷ total
 * at the precision it shows. Charts with a slice under 10% show one decimal,
 * and a chart takes another (up to two) while slices with different values
 * would share a label or a positive slice would read 0%. Trailing zeros drop,
 * so 92.0% reads 92%; labels may total 99.9–100.1%.
 */
export function piePercentages(values: readonly number[]): {
	labels: string[];
	shares: number[];
	decimals: number;
} {
	const total = values.reduce((sum, value) => sum + value, 0);
	const shares = values.map((value) => (total > 0 ? (value / total) * 100 : 0));
	const roundedAt = (decimals: number) =>
		shares.map((share) => Math.round(share * 10 ** decimals) / 10 ** decimals);
	const clashes = (rounded: readonly number[]) =>
		values.some(
			(value, index) =>
				(value > 0 && rounded[index] === 0) ||
				values.some(
					(other, later) => later > index && other !== value && rounded[later] === rounded[index],
				),
		);
	let decimals = shares.some((share) => share > 0 && share < 10) ? 1 : 0;
	while (decimals < PIE_MAX_DECIMALS && clashes(roundedAt(decimals))) decimals += 1;
	const rounded = roundedAt(decimals);
	return {
		shares,
		decimals,
		// A positive slice too thin for the finest precision still reads as present.
		labels: rounded.map((share, index) =>
			share === 0 && values[index]! > 0
				? `<${(10 ** -decimals).toFixed(decimals)}%`
				: `${Number(share.toFixed(decimals))}%`,
		),
	};
}
