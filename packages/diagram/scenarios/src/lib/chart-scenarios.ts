import {
	estimateTextWidth,
	parseChartDiagram,
	type ChartDiagram,
	type ChartKind,
} from "@sketchi/diagram-core";
import {
	formatValue,
	readChartMarks,
	unitParts,
	type RenderedDiagramScene,
} from "@sketchi/diagram-renderer";
import type { DiagramScenarioDifficulty } from "./scenarios.js";
import type { ScenarioCheck } from "./evaluate.js";

export interface ChartScenarioSeries {
	/** Accepted series names; empty for a lone series the prompt does not name. */
	readonly names: readonly string[];
	readonly values: readonly number[];
}

export interface ChartScenario {
	readonly id: string;
	readonly title: string;
	readonly description: string;
	readonly difficulty: DiagramScenarioDifficulty;
	readonly diagramType: "chart";
	readonly prompt: string;
	readonly tags: readonly string[];
	readonly logos: readonly [];
	readonly expectedDiagram: ChartDiagram;
	readonly assertions: {
		readonly kind: ChartKind;
		readonly categories: readonly string[];
		readonly series: readonly ChartScenarioSeries[];
		/** Accepted spellings of the prompt's unit. */
		readonly units?: readonly string[];
		readonly categoryAxisTitle?: string;
		readonly valueAxisTitle?: string;
		readonly stacked?: boolean;
		readonly donut?: boolean;
	};
}

interface ScenarioInput {
	readonly kind: ChartKind;
	readonly categories: readonly string[];
	readonly series: readonly { readonly name?: string; readonly values: readonly number[] }[];
	readonly unit?: string;
	/** Other spellings of the unit that read the same. */
	readonly unitAliases?: readonly string[];
	readonly categoryAxisTitle?: string;
	readonly valueAxisTitle?: string;
	readonly stacked?: boolean;
	readonly donut?: boolean;
	readonly tags?: readonly string[];
	readonly difficulty?: DiagramScenarioDifficulty;
}

function scenario(id: string, title: string, prompt: string, input: ScenarioInput): ChartScenario {
	const { unitAliases, tags, difficulty, ...chart } = input;
	return {
		id,
		title,
		prompt,
		description: title,
		difficulty: difficulty ?? "standard",
		diagramType: "chart",
		tags: ["chart", chart.kind, ...(tags ?? [])],
		logos: [],
		expectedDiagram: parseChartDiagram({ id, title, type: "chart", ...chart }),
		assertions: {
			kind: chart.kind,
			categories: chart.categories,
			series: chart.series.map((series) => ({
				names: series.name ? [series.name] : [],
				values: series.values,
			})),
			...(chart.unit ? { units: [chart.unit, ...(unitAliases ?? [])] } : {}),
			...(chart.categoryAxisTitle ? { categoryAxisTitle: chart.categoryAxisTitle } : {}),
			...(chart.valueAxisTitle ? { valueAxisTitle: chart.valueAxisTitle } : {}),
			...(chart.kind === "bar" ? { stacked: chart.stacked === true } : {}),
			...(chart.kind === "pie" ? { donut: chart.donut === true } : {}),
		},
	};
}

export const chartScenarios: readonly ChartScenario[] = [
	scenario(
		"quarterly-revenue-bar-chart",
		"Quarterly revenue",
		'Draw a bar chart of quarterly revenue in $M for 2025 and 2026, with the two years side by side in each quarter: Q1 42 (2025) and 48 (2026), Q2 51 and 57, Q3 47 and 61, Q4 63 and 72. Title the x-axis "Quarter" and the y-axis "Revenue".',
		{
			kind: "bar",
			categories: ["Q1", "Q2", "Q3", "Q4"],
			series: [
				{ name: "2025", values: [42, 51, 47, 63] },
				{ name: "2026", values: [48, 57, 61, 72] },
			],
			unit: "$M",
			categoryAxisTitle: "Quarter",
			valueAxisTitle: "Revenue",
			tags: ["grouped"],
		},
	),
	scenario(
		"support-tickets-stacked-bar-chart",
		"Support tickets by channel",
		'Make a stacked bar chart of support tickets per weekday, stacking the three channels in each day. Mon: Email 30, Chat 55, Phone 12. Tue: Email 42, Chat 61, Phone 15. Wed: Email 38, Chat 58, Phone 9. Thu: Email 45, Chat 70, Phone 18. Fri: Email 28, Chat 49, Phone 11. Title the value axis "Tickets".',
		{
			kind: "bar",
			stacked: true,
			categories: ["Mon", "Tue", "Wed", "Thu", "Fri"],
			series: [
				{ name: "Email", values: [30, 42, 38, 45, 28] },
				{ name: "Chat", values: [55, 61, 58, 70, 49] },
				{ name: "Phone", values: [12, 15, 9, 18, 11] },
			],
			valueAxisTitle: "Tickets",
			tags: ["stacked"],
		},
	),
	scenario(
		"net-income-bar-chart",
		"Net income by quarter",
		'Bar chart of our net income by quarter, in $M: Q1 12, Q2 -8, Q3 -3.5, Q4 20. Losses must show below zero. Title the y-axis "Net income".',
		{
			kind: "bar",
			categories: ["Q1", "Q2", "Q3", "Q4"],
			series: [{ name: "Net income", values: [12, -8, -3.5, 20] }],
			unit: "$M",
			valueAxisTitle: "Net income",
			tags: ["negative"],
		},
	),
	scenario(
		"product-line-revenue-bar-chart",
		"Revenue by product line",
		"Chart 2026 revenue by product line as a bar chart, in $M: Enterprise analytics platform 4.2, Self-serve dashboards 2.8, Professional services and onboarding 1.9, Marketplace integrations 1.1, Data warehouse connectors 0.6. Keep each product line's full name.",
		{
			kind: "bar",
			categories: [
				"Enterprise analytics platform",
				"Self-serve dashboards",
				"Professional services and onboarding",
				"Marketplace integrations",
				"Data warehouse connectors",
			],
			series: [{ name: "Revenue", values: [4.2, 2.8, 1.9, 1.1, 0.6] }],
			unit: "$M",
			tags: ["long-labels"],
		},
	),
	scenario(
		"monthly-signups-bar-chart",
		"Monthly signups",
		'Bar chart of 2026 signups by month: Jan 1200, Feb 1350, Mar 1610, Apr 1580, May 1920, Jun 2240, Jul 2190, Aug 2460, Sep 2710, Oct 2650, Nov 2980, Dec 3100. Title the x-axis "Month" and the y-axis "Signups".',
		{
			kind: "bar",
			categories: [
				"Jan",
				"Feb",
				"Mar",
				"Apr",
				"May",
				"Jun",
				"Jul",
				"Aug",
				"Sep",
				"Oct",
				"Nov",
				"Dec",
			],
			series: [
				{
					name: "Signups",
					values: [1200, 1350, 1610, 1580, 1920, 2240, 2190, 2460, 2710, 2650, 2980, 3100],
				},
			],
			categoryAxisTitle: "Month",
			valueAxisTitle: "Signups",
			tags: ["many-categories"],
		},
	),
	scenario(
		"weekly-active-users-line-chart",
		"Weekly active users",
		'Line chart of weekly active users in thousands (k) for three platforms over weeks W1 to W8. iOS: 120, 135, 150, 160, 158, 172, 180, 195. Android: 100, 110, 108, 125, 140, 138, 150, 162. Web: 80, 82, 90, 88, 95, 99, 104, 101. Title the x-axis "Week" and the y-axis "Active users".',
		{
			kind: "line",
			categories: ["W1", "W2", "W3", "W4", "W5", "W6", "W7", "W8"],
			series: [
				{ name: "iOS", values: [120, 135, 150, 160, 158, 172, 180, 195] },
				{ name: "Android", values: [100, 110, 108, 125, 140, 138, 150, 162] },
				{ name: "Web", values: [80, 82, 90, 88, 95, 99, 104, 101] },
			],
			unit: "k",
			unitAliases: ["thousand", "thousands", "K"],
			categoryAxisTitle: "Week",
			valueAxisTitle: "Active users",
			tags: ["multi-series"],
		},
	),
	scenario(
		"api-latency-line-chart",
		"API p50 latency",
		'Line chart of our API p50 latency in ms for one week: Mon 182, Tue 175, Wed 190, Thu 240, Fri 210, Sat 160, Sun 150. Title the y-axis "Latency".',
		{
			kind: "line",
			categories: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
			series: [{ name: "p50", values: [182, 175, 190, 240, 210, 160, 150] }],
			unit: "ms",
			valueAxisTitle: "Latency",
			tags: ["single-series"],
		},
	),
	scenario(
		"temperature-anomaly-line-chart",
		"Temperature anomaly",
		"Line chart of the yearly temperature anomaly in °C: 2019 -0.4, 2020 -0.1, 2021 0.2, 2022 -0.2, 2023 0.5, 2024 0.8. Negative anomalies must sit below zero.",
		{
			kind: "line",
			categories: ["2019", "2020", "2021", "2022", "2023", "2024"],
			series: [{ name: "Anomaly", values: [-0.4, -0.1, 0.2, -0.2, 0.5, 0.8] }],
			unit: "°C",
			unitAliases: ["C", "degrees C", "deg C"],
			tags: ["negative"],
		},
	),
	scenario(
		"revenue-cost-line-chart",
		"Revenue and cost",
		"Line chart comparing monthly revenue and cost in $k for the first half of 2026. Revenue: Jan 310, Feb 335, Mar 362, Apr 351, May 398, Jun 420. Cost: Jan 280, Feb 290, Mar 305, Apr 318, May 322, Jun 340.",
		{
			kind: "line",
			categories: ["Jan", "Feb", "Mar", "Apr", "May", "Jun"],
			series: [
				{ name: "Revenue", values: [310, 335, 362, 351, 398, 420] },
				{ name: "Cost", values: [280, 290, 305, 318, 322, 340] },
			],
			unit: "$k",
			unitAliases: ["$K"],
			tags: ["multi-series"],
		},
	),
	scenario(
		"browser-share-pie-chart",
		"Browser share",
		"Pie chart of browser market share in %: Chrome 64, Safari 19, Edge 5, Firefox 3, Other 9.",
		{
			kind: "pie",
			categories: ["Chrome", "Safari", "Edge", "Firefox", "Other"],
			series: [{ values: [64, 19, 5, 3, 9] }],
			unit: "%",
			tags: ["percent"],
		},
	),
	scenario(
		"cloud-spend-pie-chart",
		"Cloud spend",
		"Pie chart of last month's cloud spend in $k by category: Compute 920, Storage 40, Networking 22, Support 11, Licenses 7. Every small slice must stay readable.",
		{
			kind: "pie",
			categories: ["Compute", "Storage", "Networking", "Support", "Licenses"],
			series: [{ values: [920, 40, 22, 11, 7] }],
			unit: "$k",
			unitAliases: ["$K"],
			tags: ["tiny-slices"],
			difficulty: "challenge",
		},
	),
	scenario(
		"traffic-sources-donut-chart",
		"Traffic sources",
		"Donut chart of website visits by traffic source: Organic search 4200, Direct 2600, Referral 1300, Social 900, Email 500.",
		{
			kind: "pie",
			donut: true,
			categories: ["Organic search", "Direct", "Referral", "Social", "Email"],
			series: [{ values: [4200, 2600, 1300, 900, 500] }],
			tags: ["donut"],
		},
	),
];

const normalize = (text: string) =>
	text
		.toLowerCase()
		.replace(/[^\p{L}\p{N}$€£%°.-]+/gu, " ")
		.trim();

const unitKey = (unit: string) => unit.replace(/\s+/gu, "").toLowerCase();

/** A title passes when it contains the prompt's words. */
function titleMatches(actual: string | undefined, expected: string): boolean {
	return actual !== undefined && normalize(actual).includes(normalize(expected));
}

function sameValues(actual: readonly number[], expected: readonly number[]): boolean {
	return (
		actual.length === expected.length &&
		expected.every(
			(value, index) => Math.abs(actual[index]! - value) <= 1e-9 * Math.max(1, Math.abs(value)),
		)
	);
}

/**
 * Score the model's chart against the prompt: its kind, every category in
 * order, every series and value, the unit, axis titles, and the stacked or
 * donut choice.
 */
export function chartScenarioChecks(
	scenario: ChartScenario,
	diagram: ChartDiagram,
): ScenarioCheck[] {
	const expected = scenario.assertions;
	const order = expected.categories.map((category) =>
		diagram.categories.findIndex((actual) => normalize(actual) === normalize(category)),
	);
	const used = new Set<number>();
	const seriesChecks = expected.series.map((series, index) => {
		// A lone series matches whatever the model named it.
		const lone = expected.series.length === 1;
		const matched = diagram.series.findIndex(
			(actual, position) =>
				!used.has(position) &&
				(lone ||
					series.names.some(
						(name) => actual.name !== undefined && normalize(actual.name) === normalize(name),
					)),
		);
		if (matched >= 0) used.add(matched);
		const actual = diagram.series[matched];
		const values = actual
			? order.map((position) => (position < 0 ? Number.NaN : actual.values[position]!))
			: [];
		return {
			id: `chart-series:${index + 1}`,
			passed: Boolean(actual) && sameValues(values, series.values),
			message: `Expected series ${series.names.join("|") || "(the only series)"} with values ${series.values.join(", ")} in category order.`,
		};
	});
	return [
		{
			id: "chart-kind",
			passed: diagram.kind === expected.kind,
			message: `Expected a ${expected.kind} chart; got ${diagram.kind}.`,
		},
		{
			id: "chart-category-count",
			passed: diagram.categories.length === expected.categories.length,
			message: `Expected exactly ${expected.categories.length} categories.`,
		},
		...expected.categories.map((category, index) => ({
			id: `chart-category:${index + 1}`,
			passed: order[index] === index,
			message: `Expected category "${category}" at position ${index + 1}.`,
		})),
		{
			id: "chart-series-count",
			passed: diagram.series.length === expected.series.length,
			message: `Expected exactly ${expected.series.length} series.`,
		},
		...seriesChecks,
		...(expected.units
			? [
					{
						id: "chart-unit",
						passed:
							diagram.unit !== undefined &&
							expected.units.some((unit) => unitKey(unit) === unitKey(diagram.unit!)),
						message: `Expected unit ${expected.units.join(" or ")}.`,
					},
				]
			: []),
		...(expected.categoryAxisTitle
			? [
					{
						id: "chart-category-axis-title",
						passed: titleMatches(diagram.categoryAxisTitle, expected.categoryAxisTitle),
						message: `Expected category axis title "${expected.categoryAxisTitle}".`,
					},
				]
			: []),
		...(expected.valueAxisTitle
			? [
					{
						id: "chart-value-axis-title",
						passed: titleMatches(diagram.valueAxisTitle, expected.valueAxisTitle),
						message: `Expected value axis title "${expected.valueAxisTitle}".`,
					},
				]
			: []),
		...(expected.stacked === undefined
			? []
			: [
					{
						id: "chart-stacked",
						passed: (diagram.stacked === true) === expected.stacked,
						message: expected.stacked
							? "Expected stacked bars."
							: "Expected grouped, unstacked bars.",
					},
				]),
		...(expected.donut === undefined
			? []
			: [
					{
						id: "chart-donut",
						passed: (diagram.donut === true) === expected.donut,
						message: expected.donut ? "Expected a donut." : "Expected a full pie, not a donut.",
					},
				]),
	];
}

/** Drawn marks may differ from the values' proportions by this much. */
const BAR_TOLERANCE_PX = 0.6;
const SLICE_TOLERANCE_DEGREES = 0.1;

/** The drawn chart is to scale: bar lengths follow |value| and slice angles follow share. */
export function chartGeometryCheck(
	diagram: ChartDiagram,
	scene: RenderedDiagramScene,
): ScenarioCheck {
	const marks = readChartMarks(scene);
	if (diagram.kind === "pie") {
		const values = diagram.series[0]?.values ?? [];
		const total = values.reduce((sum, value) => sum + value, 0);
		const worst = Math.max(
			0,
			...marks.slices.map((slice) =>
				Math.abs(slice.degrees - (values[slice.index]! / total) * 360),
			),
		);
		return {
			id: "chart-geometry",
			passed: worst <= SLICE_TOLERANCE_DEGREES,
			message: `Slice angles follow each value's share within ${worst.toFixed(3)}°.`,
		};
	}
	if (diagram.kind === "line" || marks.bars.length === 0)
		return { id: "chart-geometry", passed: true, message: "No bars to measure." };
	const rated = marks.bars.map((bar) => ({
		...bar,
		value: Math.abs(diagram.series[bar.series]!.values[bar.category]!),
	}));
	const reference = rated.toSorted((a, b) => b.length - a.length)[0]!;
	const rate = reference.length / reference.value;
	const worst = Math.max(...rated.map((bar) => Math.abs(bar.length - bar.value * rate)));
	return {
		id: "chart-geometry",
		passed: worst <= BAR_TOLERANCE_PX,
		message: `Bar lengths follow their values within ${worst.toFixed(2)}px.`,
	};
}

/** The share a slice label states, from its "42%" or "<0.1%" line. */
function statedShare(
	text: string,
): { value: number; below: boolean; decimals: number } | undefined {
	const match = /(<)?(\d+(?:\.(\d+))?)%/u.exec(text.split("\n").at(-1) ?? "");
	if (!match) return undefined;
	return { value: Number(match[2]), below: match[1] === "<", decimals: match[3]?.length ?? 0 };
}

/**
 * Pie labels state each slice's share of the total at the chart's precision,
 * and slices with different values never share a label.
 */
export function chartPieLabelCheck(
	diagram: ChartDiagram,
	scene: RenderedDiagramScene,
): ScenarioCheck {
	if (diagram.kind !== "pie")
		return { id: "chart-pie-labels", passed: true, message: "Not a pie." };
	const values = diagram.series[0]?.values ?? [];
	const total = values.reduce((sum, value) => sum + value, 0);
	const stated = values.map((_, index) => {
		const element = scene.elements.find((entry) => entry.id === `chart:slice-label:${index}`);
		return element?.type === "text" ? statedShare(element.text) : undefined;
	});
	const decimals = Math.max(0, ...stated.map((entry) => entry?.decimals ?? 0));
	const tolerance = 0.5 * 10 ** -decimals + 1e-9;
	const wrong = values.flatMap((value, index) => {
		const label = stated[index];
		const share = (value / total) * 100;
		if (!label) return [diagram.categories[index]!];
		const off = label.below
			? !(share > 0 && share < label.value)
			: Math.abs(label.value - share) > tolerance;
		const shared = values.some((other, later) => {
			const otherLabel = stated[later];
			return (
				later > index &&
				other !== value &&
				otherLabel !== undefined &&
				otherLabel.value === label.value &&
				otherLabel.below === label.below
			);
		});
		return off || shared ? [diagram.categories[index]!] : [];
	});
	return {
		id: "chart-pie-labels",
		passed: wrong.length === 0,
		message:
			wrong.length === 0
				? `Every slice states its share at ${decimals} decimal(s), each distinct value with its own label.`
				: `Slice labels misstate or share a percentage: ${wrong.join(", ")}.`,
	};
}

type SceneText = Extract<RenderedDiagramScene["elements"][number], { type: "text" }>;

function sceneTexts(scene: RenderedDiagramScene): SceneText[] {
	return scene.elements.filter((element): element is SceneText => element.type === "text");
}

/** Value-bearing text: bar and point values, data-table cells and pie labels. */
const VALUE_TEXT = /^chart:(value|table|slice-label):/u;

/**
 * Data fidelity graded on what is drawn: every prompt value, formatted as the
 * renderer formats it, appears in value text as often as the prompt gives it,
 * and every category, series name and axis title appears in the scene's text.
 */
export function chartDrawnDataCheck(
	scenario: ChartScenario,
	diagram: ChartDiagram,
	scene: RenderedDiagramScene,
): ScenarioCheck {
	const texts = sceneTexts(scene);
	const drawn = texts.map((element) => normalize(element.text.replace(/\n/gu, " ")));
	const counts = new Map<string, number>();
	for (const element of texts.filter((entry) => VALUE_TEXT.test(entry.id)))
		for (const line of element.text.split("\n"))
			for (const segment of line.split(" · ")) counts.set(segment, (counts.get(segment) ?? 0) + 1);
	const parts = unitParts(diagram.unit);
	const missing: string[] = [];
	for (const series of scenario.assertions.series)
		for (const value of series.values) {
			const text = formatValue(value, parts);
			const left = counts.get(text) ?? 0;
			if (left > 0) counts.set(text, left - 1);
			else missing.push(text);
		}
	const names = [
		...scenario.assertions.categories,
		...diagram.series.flatMap((series) => (series.name ? [series.name] : [])),
		...(scenario.assertions.categoryAxisTitle ? [scenario.assertions.categoryAxisTitle] : []),
		...(scenario.assertions.valueAxisTitle ? [scenario.assertions.valueAxisTitle] : []),
	];
	for (const name of names)
		if (!drawn.some((text) => text.includes(normalize(name)))) missing.push(`"${name}"`);
	return {
		id: "chart-drawn-data",
		passed: missing.length === 0,
		message:
			missing.length === 0
				? "Every value, category, series name and axis title is drawn as text."
				: `Not drawn: ${missing.slice(0, 8).join(", ")}${missing.length > 8 ? ", …" : ""}.`,
	};
}

/** Gridlines, the zero baseline and the axis never run through text. */
export function chartClearRulesCheck(scene: RenderedDiagramScene): ScenarioCheck {
	const boxes = sceneTexts(scene).map((element) => {
		const width = element.maxWidth ?? estimateTextWidth(element.text, element.fontSize);
		const height = element.text.split("\n").length * element.fontSize * 1.35;
		return {
			id: element.id,
			left: element.x - width / 2,
			right: element.x + width / 2,
			top: element.y - height / 2,
			bottom: element.y + height / 2,
		};
	});
	const crossings = scene.elements.flatMap((element) => {
		if (element.type !== "line" || !/^chart:(grid|baseline|axis|category-tick)/u.test(element.id))
			return [];
		const [a, b] = element.points;
		const horizontal = Math.abs(a.y - b.y) < 0.01;
		return boxes
			.filter((box) =>
				horizontal
					? a.y > box.top + 0.5 &&
						a.y < box.bottom - 0.5 &&
						Math.max(a.x, b.x) > box.left + 0.5 &&
						Math.min(a.x, b.x) < box.right - 0.5
					: a.x > box.left + 0.5 &&
						a.x < box.right - 0.5 &&
						Math.max(a.y, b.y) > box.top + 0.5 &&
						Math.min(a.y, b.y) < box.bottom - 0.5,
			)
			.map((box) => `${element.id} × ${box.id}`);
	});
	return {
		id: "chart-clear-rules",
		passed: crossings.length === 0,
		message:
			crossings.length === 0
				? "No gridline, baseline or axis crosses text."
				: `Rules cross text: ${crossings.slice(0, 5).join(", ")}.`,
	};
}
