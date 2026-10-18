import { describe, expect, it } from "vitest";

import {
	extendScale,
	formatTick,
	formatValue,
	niceScale,
	PIE_MAX_DECIMALS,
	piePercentages,
	unitParts,
	valueDomain,
} from "./chart-scale.js";

function random(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let value = state;
		value = Math.imul(value ^ (value >>> 15), value | 1);
		value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
		return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
	};
}

/** Whether a step is 1, 2 or 5 × 10^n. */
function isNiceStep(step: number): boolean {
	const exponent = Math.floor(Math.log10(step) + 1e-9);
	const mantissa = Number((step / 10 ** exponent).toPrecision(6));
	return [1, 2, 5].includes(mantissa);
}

describe("chart value scales", () => {
	it("picks 1/2/5 × 10^n steps whose ticks cover the data, across a fuzz of ranges", () => {
		const next = random(424);
		for (let run = 0; run < 2000; run += 1) {
			const magnitude = 10 ** Math.floor(next() * 14 - 6);
			const a = (next() * 2 - 1) * magnitude;
			const b = next() < 0.2 ? a : (next() * 2 - 1) * magnitude;
			const scale = niceScale(Math.min(a, b), Math.max(a, b));
			expect(isNiceStep(scale.step), `${a}..${b} step ${scale.step}`).toBe(true);
			expect(scale.min).toBeLessThanOrEqual(Math.min(a, b) + 1e-12 * magnitude);
			expect(scale.max).toBeGreaterThanOrEqual(Math.max(a, b) - 1e-12 * magnitude);
			expect(scale.ticks.length - 1).toBeGreaterThanOrEqual(1);
			expect(scale.ticks.length - 1).toBeLessThanOrEqual(8);
			scale.ticks.forEach((tick, index) => {
				expect(tick).toBeCloseTo(scale.min + index * scale.step, 9);
				expect(Math.abs(tick / scale.step - Math.round(tick / scale.step))).toBeLessThan(1e-6);
			});
		}
	});

	it("keeps zero for bars and drops it only for a narrow line band", () => {
		expect(valueDomain([42, 63], true)).toEqual({ low: 0, high: 63 });
		expect(valueDomain([150, 240], false)).toEqual({ low: 0, high: 240 });
		expect(valueDomain([98, 102], false)).toEqual({ low: 98, high: 102 });
		expect(valueDomain([-102, -98], false)).toEqual({ low: -102, high: -98 });
		expect(valueDomain([-3, 5], false)).toEqual({ low: -3, high: 5 });
	});

	it("covers all-zero, single-value and all-negative data", () => {
		expect(niceScale(0, 0).ticks).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1]);
		expect(niceScale(0, 63).ticks).toEqual([0, 20, 40, 60, 80]);
		expect(niceScale(-30, 0).ticks.at(0)).toBe(-30);
		expect(niceScale(-30, 0).ticks.at(-1)).toBe(0);
		expect(extendScale(niceScale(0, 63), false, true).ticks).toEqual([0, 20, 40, 60, 80, 100]);
	});
});

describe("chart number formatting", () => {
	it.each([
		["$", 12, "$12"],
		["$M", 42, "$42M"],
		["€bn", 1.5, "€1.5bn"],
		["%", 64, "64%"],
		["°C", -0.4, "-0.4°C"],
		["ms", 182, "182 ms"],
		["users", 1200, "1,200 users"],
		["k", 120, "120k"],
		["$", -8, "-$8"],
		["$", 2500000, "$2.5M"],
	])("formats %s values: %s → %s", (unit, value, expected) => {
		expect(formatValue(value, unitParts(unit))).toBe(expected);
	});

	it("keeps every authored digit, whatever the value's magnitude", () => {
		expect(formatValue(12345.01, unitParts("$"))).toBe("$12,345.01");
		expect(formatValue(600000.25, unitParts("$"))).toBe("$600,000.25");
		expect(formatValue(0.00001, unitParts("s"))).toBe("0.00001 s");
		expect(formatValue(0.00002, unitParts("s"))).toBe("0.00002 s");
		expect(formatValue(1.5e-9, unitParts("s"))).toBe("1.5e-9 s");
		expect(formatValue(1234567, unitParts(undefined))).toBe("1,234,567");
		expect(formatValue(2500000, unitParts("$"))).toBe("$2.5M");
		const next = random(31);
		for (let run = 0; run < 3000; run += 1) {
			const decimals = Math.floor(next() * 7);
			const magnitude = 10 ** Math.floor(next() * 12 - 6);
			const value = Number((next() * 10 * magnitude * (next() < 0.3 ? -1 : 1)).toFixed(decimals));
			const text = formatValue(value, unitParts(undefined));
			const digits = text.replace(/,/gu, "");
			const multiplier = { k: 1e3, M: 1e6, B: 1e9, T: 1e12 }[digits.at(-1) ?? ""] ?? 1;
			const read = Number(multiplier === 1 ? digits : digits.slice(0, -1)) * multiplier;
			expect(Math.abs(read - value), `${value} → ${text}`).toBeLessThanOrEqual(
				Math.abs(value) * 1e-12,
			);
			if (value !== 0) expect(read, `${value} → ${text}`).not.toBe(0);
		}
	});

	it("compacts large ticks to the step's precision and never doubles a scale letter", () => {
		const scale = niceScale(0, 1_200_000);
		expect(scale.ticks.map((tick) => formatTick(tick, scale, unitParts("$")))).toEqual([
			"$0",
			"$0.2M",
			"$0.4M",
			"$0.6M",
			"$0.8M",
			"$1.0M",
			"$1.2M",
		]);
		const scaled = niceScale(0, 60_000);
		expect(formatTick(20_000, scaled, unitParts("$M"))).toBe("$20,000M");
		expect(formatTick(0, niceScale(0, 200), unitParts("k"))).toBe("0");
	});

	it("labels each slice with its own rounded share, never one label for two different values", () => {
		const next = random(7);
		for (let run = 0; run < 2000; run += 1) {
			const count = 1 + Math.floor(next() * 8);
			const values = Array.from({ length: count }, () =>
				next() < 0.2 ? next() * 0.01 : Math.round(next() * 1000),
			);
			if (!values.some((value) => value > 0)) continue;
			const { labels, shares, decimals } = piePercentages(values);
			expect(decimals).toBeLessThanOrEqual(PIE_MAX_DECIMALS);
			labels.forEach((label, index) => {
				const value = values[index]!;
				if (label.startsWith("<")) {
					expect(value).toBeGreaterThan(0);
					expect(decimals).toBe(PIE_MAX_DECIMALS);
					return;
				}
				// The label is value ÷ total at the precision the chart shows.
				expect(Math.abs(Number.parseFloat(label) - shares[index]!)).toBeLessThanOrEqual(
					0.5 * 10 ** -decimals + 1e-9,
				);
				if (value > 0) expect(Number.parseFloat(label)).toBeGreaterThan(0);
				if (decimals < PIE_MAX_DECIMALS)
					values.forEach((other, later) => {
						if (later > index && other !== value) expect(labels[later]).not.toBe(label);
					});
			});
			if (shares.some((share) => share > 0 && share < 10)) expect(decimals).toBeGreaterThan(0);
		}
		expect(piePercentages([1, 1, 1]).labels).toEqual(["33%", "33%", "33%"]);
		expect(piePercentages([920, 40, 22, 11, 7]).labels).toEqual([
			"92%",
			"4%",
			"2.2%",
			"1.1%",
			"0.7%",
		]);
		expect(piePercentages([960, 10, 12, 8, 10]).labels).toEqual([
			"96%",
			"1%",
			"1.2%",
			"0.8%",
			"1%",
		]);
		expect(piePercentages([64, 19, 5, 3, 9]).labels).toEqual(["64%", "19%", "5%", "3%", "9%"]);
		expect(piePercentages([60, 40]).labels).toEqual(["60%", "40%"]);
		expect(piePercentages([1001, 1000, 1]).labels).toEqual(["50%", "49.95%", "0.05%"]);
		expect(piePercentages([996, 4]).labels).toEqual(["99.6%", "0.4%"]);
	});
});
