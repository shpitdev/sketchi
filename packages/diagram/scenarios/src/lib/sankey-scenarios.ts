import { parseSankeyDiagram, sankeyNodeTotals, type SankeyDiagram } from "@sketchi/diagram-core";
import {
	layoutSankeyDiagram,
	readSankeyScene,
	SANKEY_MIN_BAND,
	sankeyFlowText,
	sankeyLayoutIssues,
	sankeyNodeText,
	sankeyWeightedCrossings,
	type RenderedDiagramScene,
} from "@sketchi/diagram-renderer";

import type { ScenarioCheck } from "./evaluate.js";
import type { DiagramScenarioDifficulty } from "./scenarios.js";

/** A node the prompt names, by every form its label may take. */
export interface SankeyScenarioNode {
	readonly labels: readonly string[];
	/**
	 * A drop-off the prompt does not pin down: one shared node ("Rejected") or
	 * one per stage ("Rejected at phone screen") both pass, counted once.
	 */
	readonly dropOff: boolean;
}

/** A flow the prompt states, between nodes by key, with its value in the stated unit. */
export interface SankeyScenarioFlow {
	readonly source: string;
	readonly target: string;
	readonly value: number;
}

export interface SankeyScenario {
	readonly assertions: {
		readonly nodes: Readonly<Record<string, SankeyScenarioNode>>;
		readonly flows: readonly SankeyScenarioFlow[];
		/**
		 * The stated unit's accepted forms, each with what one of it is worth in
		 * the stated unit: `$k` is 1 and `$` 0.001, so 310000 in dollars is 310 $k.
		 */
		readonly units?: Readonly<Record<string, number>>;
	};
	readonly description: string;
	readonly diagramType: "sankey";
	readonly difficulty: DiagramScenarioDifficulty;
	readonly expectedDiagram: SankeyDiagram;
	readonly id: string;
	readonly logos: readonly [];
	readonly prompt: string;
	readonly tags: readonly string[];
	readonly title: string;
}

/** Labels compare without case, spaces or punctuation: "Data Science" matches "data-science". */
const key = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
/** Units compare without case or spaces, keeping symbols: "$K" is "$k", "k$" stays "k$". */
const unitKey = (text: string) => text.toLowerCase().replace(/[\s-]+/gu, "");

function nodesFor(expected: SankeyScenarioNode, diagram: SankeyDiagram) {
	const accepted = expected.labels.map(key);
	return diagram.nodes.filter((node) =>
		expected.dropOff
			? accepted.some((label) => key(node.label).startsWith(label))
			: accepted.includes(key(node.label)),
	);
}

/**
 * Sankey checks score what the prompt states, each on its own: every node by
 * label, every flow from its stated source into its stated target with its
 * stated value, the unit, and no node or flow the prompt does not state. A
 * value in another accepted unit passes at its worth in the stated one.
 */
export function sankeyScenarioChecks(
	scenario: SankeyScenario,
	diagram: SankeyDiagram,
): ScenarioCheck[] {
	const { nodes, flows, units } = scenario.assertions;
	const matched = new Map(
		Object.entries(nodes).map(([nodeKey, expected]) => [nodeKey, nodesFor(expected, diagram)]),
	);
	const labelOf = (nodeKey: string) => nodes[nodeKey]!.labels[0]!;
	const unit = unitKey(diagram.unit ?? "");
	const worth = units && Object.hasOwn(units, unit) ? units[unit]! : 1;
	const sameValue = (value: number, stated: number) =>
		Math.abs(value * worth - stated) <= Math.abs(stated) * 1e-9;
	const nodeChecks = Object.entries(nodes).map(([nodeKey, expected]): ScenarioCheck => ({
		id: `node:${nodeKey}`,
		passed: matched.get(nodeKey)!.length > 0,
		message: `Expected a node labeled "${expected.labels.join('" or "')}".`,
	}));
	const flowChecks = flows.map((flow): ScenarioCheck => {
		const sources = new Set(matched.get(flow.source)!.map((node) => node.id));
		const targets = new Set(matched.get(flow.target)!.map((node) => node.id));
		const links = diagram.links.filter(
			(link) => sources.has(link.source) && targets.has(link.target),
		);
		return {
			id: `flow:${flow.source}->${flow.target}`,
			passed: links.some((link) => sameValue(link.value, flow.value)),
			message: `Expected a flow of ${flow.value} from "${labelOf(flow.source)}" into "${labelOf(flow.target)}"${links.length > 0 ? `; found ${links.map((link) => link.value).join(", ")}` : ""}.`,
		};
	});
	// Every node is a stated one; only a drop-off may take several nodes, one per stage.
	const claimed = new Map<string, string[]>();
	for (const [nodeKey, list] of matched)
		for (const node of list) claimed.set(node.id, [...(claimed.get(node.id) ?? []), nodeKey]);
	const unstated = diagram.nodes.filter((node) => !claimed.has(node.id));
	const repeated = [...matched].filter(
		([nodeKey, list]) => !nodes[nodeKey]!.dropOff && list.length > 1,
	);
	return [
		...nodeChecks,
		...flowChecks,
		...(units
			? [
					{
						id: "unit",
						passed: diagram.unit !== undefined && Object.hasOwn(units, unitKey(diagram.unit)),
						message: `Expected the unit ${Object.keys(units)
							.map((unit) => `"${unit}"`)
							.join(" or ")}${diagram.unit ? `; found "${diagram.unit}"` : ""}.`,
					},
				]
			: []),
		{
			id: "nodes-exact",
			passed: unstated.length === 0 && repeated.length === 0,
			message:
				unstated.length > 0
					? `Expected no node the prompt does not state; found ${unstated.map((node) => `"${node.label}"`).join(", ")}.`
					: repeated.length > 0
						? `Expected each stated node once; "${labelOf(repeated[0]![0])}" appears ${repeated[0]![1].length} times.`
						: "Every node is one the prompt states.",
		},
		{
			id: "flows-exact",
			passed: diagram.links.length === flows.length,
			message: `Expected exactly ${flows.length} flows; found ${diagram.links.length}.`,
		},
	];
}

const flat = (text: string | undefined) => (text ?? "").replace(/\s+/gu, " ").trim();

/**
 * The drawn scene says what the diagram says: a bar for every node labeled
 * with its name and total, a band for every flow from its source's bar into
 * its target's with its value written, band widths in proportion to their
 * values (apart from the documented minimum), and each bar as tall as its
 * fuller side.
 */
export function sankeyDrawnCheck(
	diagram: SankeyDiagram,
	scene: RenderedDiagramScene,
): ScenarioCheck {
	const { nodes, bands } = readSankeyScene(scene);
	const totals = sankeyNodeTotals(diagram);
	const bars = new Map(nodes.map((node) => [node.id, node]));
	const problems: string[] = [];
	for (const node of diagram.nodes) {
		const bar = bars.get(node.id);
		if (!bar) {
			problems.push(`${node.id} bar`);
			continue;
		}
		if (flat(bar.text) !== flat(sankeyNodeText(diagram, node.label, totals.get(node.id)!.total)))
			problems.push(`${node.id} label and total`);
		const height = bar.box.bottom - bar.box.top;
		const side = (end: "source" | "target") =>
			bands.filter((band) => band[end] === node.id).reduce((sum, band) => sum + band.width, 0);
		if (Math.abs(Math.max(side("source"), side("target")) - height) > 0.6)
			problems.push(`${node.id} height`);
	}
	// The widest band gives the scale; its 0.01 px rounding is negligible at its width.
	const widestBand = bands.reduce(
		(best, band) => (best === undefined || band.width > best.width ? band : best),
		undefined as (typeof bands)[number] | undefined,
	);
	const widestLink = diagram.links.find(
		(entry) => entry.source === widestBand?.source && entry.target === widestBand?.target,
	);
	const widest = widestBand && widestLink ? widestBand.width / widestLink.value : 0;
	for (const link of diagram.links) {
		const band = bands.find(
			(entry) => entry.source === link.source && entry.target === link.target,
		);
		const name = `${link.source}->${link.target}`;
		if (!band) {
			problems.push(`${name} band`);
			continue;
		}
		const source = bars.get(link.source);
		const target = bars.get(link.target);
		if (
			!source ||
			!target ||
			Math.abs(band.sourceEnd.x - source.box.right) > 0.6 ||
			Math.abs(band.targetEnd.x - target.box.left) > 0.6
		)
			problems.push(`${name} ends`);
		if (flat(band.text) !== flat(sankeyFlowText(diagram, link))) problems.push(`${name} value`);
		if (Math.abs(band.width - Math.max(link.value * widest, SANKEY_MIN_BAND)) > 0.6)
			problems.push(`${name} width`);
	}
	return {
		id: "sankey-drawn",
		passed: problems.length === 0,
		message:
			problems.length === 0
				? "Every node is a bar with its label and total, every flow a band between its nodes with its value written, widths in proportion."
				: `Drawn differently from the diagram: ${problems.slice(0, 8).join(", ")}.`,
	};
}

/**
 * No label over another or over a bar or another's band, bands within their
 * gaps, and crossings no heavier than the authored order's, each crossing
 * weighing the product of its two flows' values.
 */
export function sankeyLayoutCheck(
	diagram: SankeyDiagram,
	scene: RenderedDiagramScene,
): ScenarioCheck {
	const issues = sankeyLayoutIssues(scene).map((issue) => issue.message);
	// Each crossing weighs the product of its two flows' values, as a reader sees it.
	const valueOf = new Map(
		diagram.links.map((link) => [`${link.source}>${link.target}`, link.value]),
	);
	const crossings = sankeyWeightedCrossings(scene, (band) =>
		Number(valueOf.get(`${band.source}>${band.target}`)),
	);
	const baseline = layoutSankeyDiagram(diagram, { ordering: "authored" }).weightedCrossings;
	if (crossings > baseline * (1 + 1e-9))
		issues.push(`Crossing bands weigh ${crossings}, more than the authored order's ${baseline}.`);
	return {
		id: "sankey-layout",
		passed: issues.length === 0,
		message:
			issues.length === 0
				? `Labels stand clear, bands keep to their gaps, and crossing bands weigh ${crossings}, no more than the authored order's ${baseline}.`
				: issues.slice(0, 6).join(" "),
	};
}

type NodeDefinition = readonly [
	key: string,
	/** The label as stated, or every form it may take. */
	labels: string | readonly string[],
	extra?: { readonly dropOff?: true },
];

interface SankeyScenarioDefinition {
	readonly id: string;
	readonly title: string;
	readonly difficulty: DiagramScenarioDifficulty;
	readonly tags: readonly string[];
	readonly description: string;
	readonly prompt: string;
	readonly nodes: readonly NodeDefinition[];
	readonly flows: readonly (readonly [source: string, target: string, value: number])[];
	readonly unit?: { readonly label: string; readonly forms: Readonly<Record<string, number>> };
}

const list = (value: string | readonly string[]): readonly string[] =>
	typeof value === "string" ? [value] : value;

function defineSankeyScenario(definition: SankeyScenarioDefinition): SankeyScenario {
	const { nodes, flows, unit, ...scenario } = definition;
	return {
		...scenario,
		diagramType: "sankey",
		logos: [],
		assertions: {
			nodes: Object.fromEntries(
				nodes.map(([nodeKey, labels, extra]) => [
					nodeKey,
					{ labels: list(labels), dropOff: extra?.dropOff === true },
				]),
			),
			flows: flows.map(([source, target, value]) => ({ source, target, value })),
			...(unit ? { units: unit.forms } : {}),
		},
		expectedDiagram: parseSankeyDiagram({
			id: definition.id,
			title: definition.title,
			type: "sankey",
			...(unit ? { unit: unit.label } : {}),
			nodes: nodes.map(([id, labels]) => ({ id, label: list(labels)[0] })),
			links: flows.map(([source, target, value]) => ({ source, target, value })),
		}),
	};
}

/** Thousands of dollars, as the prompt states them, or the same amounts in dollars. */
const THOUSAND_DOLLARS = { $k: 1, k$: 1, thousanddollars: 1, $: 0.001 } as const;

const CLOUD_BUDGET_NODES: readonly NodeDefinition[] = [
	["engineering", "Engineering"],
	["data-science", "Data Science"],
	["marketing", "Marketing"],
	["sales", "Sales"],
	["finance", "Finance"],
	["compute", "Compute"],
	["managed-databases", "Managed databases"],
	["object-storage", "Object storage"],
	["observability", "Observability and logging"],
	["gpu-training", "GPU training clusters"],
	["cdn", "Content delivery network"],
	["crm-hosting", "Customer relationship management hosting"],
];

const CLOUD_BUDGET_FLOWS: SankeyScenarioDefinition["flows"] = [
	["engineering", "compute", 310],
	["engineering", "managed-databases", 120],
	["engineering", "object-storage", 45],
	["engineering", "observability", 38],
	["data-science", "compute", 140],
	["data-science", "gpu-training", 220],
	["data-science", "object-storage", 60],
	["marketing", "cdn", 25],
	["marketing", "compute", 4],
	["sales", "crm-hosting", 12],
	["sales", "compute", 2],
	["finance", "managed-databases", 3],
];

const WEBSITE_TRAFFIC_NODES: readonly NodeDefinition[] = [
	["organic-search", "Organic search"],
	["paid-ads", "Paid ads"],
	["social", "Social"],
	["home", "Home"],
	["pricing", "Pricing"],
	["blog", "Blog"],
	["signed-up", "Signed up"],
	["requested-demo", "Requested demo"],
	["bounced", "Bounced"],
];

const WEBSITE_TRAFFIC_FLOWS: SankeyScenarioDefinition["flows"] = [
	["organic-search", "home", 4_200],
	["organic-search", "pricing", 1_800],
	["organic-search", "blog", 3_000],
	["paid-ads", "pricing", 2_400],
	["paid-ads", "home", 600],
	["social", "blog", 1_500],
	["social", "home", 500],
	["home", "signed-up", 700],
	["home", "requested-demo", 200],
	["home", "bounced", 4_400],
	["pricing", "signed-up", 1_200],
	["pricing", "requested-demo", 400],
	["pricing", "bounced", 2_600],
	["blog", "signed-up", 300],
	["blog", "bounced", 4_200],
];

const HIRING_FUNNEL_NODES: readonly NodeDefinition[] = [
	["applicants", "Applicants"],
	["phone-screen", "Phone screen"],
	["onsite", "Onsite"],
	["offer", "Offer"],
	["hired", "Hired"],
	["declined", "Declined"],
	["rejected", "Rejected", { dropOff: true }],
	["withdrew", "Withdrew", { dropOff: true }],
];

const HIRING_FUNNEL_FLOWS: SankeyScenarioDefinition["flows"] = [
	["applicants", "phone-screen", 300],
	["applicants", "rejected", 900],
	["phone-screen", "onsite", 120],
	["phone-screen", "rejected", 150],
	["phone-screen", "withdrew", 30],
	["onsite", "offer", 40],
	["onsite", "rejected", 70],
	["onsite", "withdrew", 10],
	["offer", "hired", 32],
	["offer", "declined", 8],
];

const CITY_ENERGY_NODES: readonly NodeDefinition[] = [
	["solar-farms", "Solar farms"],
	["natural-gas-imports", "Natural gas imports"],
	["gas-plant", "Gas plant"],
	["grid-electricity", "Grid electricity"],
	["homes", "Homes"],
	["industry", "Industry"],
	["transport", "Transport"],
	["heat-losses", "Heat losses"],
	["line-losses", "Line losses"],
	["useful-energy", "Useful energy"],
	["waste-heat", "Waste heat"],
];

const CITY_ENERGY_FLOWS: SankeyScenarioDefinition["flows"] = [
	["solar-farms", "grid-electricity", 120],
	["natural-gas-imports", "gas-plant", 550],
	["natural-gas-imports", "homes", 260],
	["natural-gas-imports", "industry", 180],
	["gas-plant", "grid-electricity", 340],
	["gas-plant", "heat-losses", 210],
	["grid-electricity", "homes", 190],
	["grid-electricity", "industry", 150],
	["grid-electricity", "transport", 70],
	["grid-electricity", "line-losses", 50],
	["homes", "useful-energy", 300],
	["homes", "waste-heat", 150],
	["industry", "useful-energy", 240],
	["industry", "waste-heat", 90],
	["transport", "useful-energy", 25],
	["transport", "waste-heat", 45],
];

const sankeyScenarioDefinitions: readonly SankeyScenarioDefinition[] = [
	{
		id: "cloud-budget-sankey",
		title: "Monthly cloud budget",
		difficulty: "challenge",
		tags: ["sankey", "budget", "two-columns", "slivers", "long-labels"],
		description:
			"A monthly cloud budget from five departments to seven services: flows from 2 to 310 across two orders of magnitude, three slivers beside the largest flow, and long service names.",
		prompt:
			"Draw a Sankey diagram of our monthly cloud budget in $k, from departments to cloud services. Engineering: Compute 310, Managed databases 120, Object storage 45, Observability and logging 38. Data Science: Compute 140, GPU training clusters 220, Object storage 60. Marketing: Content delivery network 25, Compute 4. Sales: Customer relationship management hosting 12, Compute 2. Finance: Managed databases 3. Every flow keeps its own value, however small.",
		unit: { label: "$k", forms: THOUSAND_DOLLARS },
		nodes: CLOUD_BUDGET_NODES,
		flows: CLOUD_BUDGET_FLOWS,
	},
	{
		id: "cloud-budget-sankey-v2",
		title: "Monthly cloud budget",
		difficulty: "challenge",
		tags: ["sankey", "budget", "two-columns", "slivers", "long-labels", "real-voice"],
		description:
			"A monthly cloud budget from five departments to seven services: flows from 2 to 310 across two orders of magnitude, three slivers beside the largest flow, and long service names.",
		prompt: [
			"sankey of monthly cloud spend by dept → service ($k)",
			"",
			"dept,service,$k",
			"Engineering,Compute,310",
			"Engineering,Managed databases,120",
			"Engineering,Object storage,45",
			"Engineering,Observability and logging,38",
			"Data Science,Compute,140",
			"Data Science,GPU training clusters,220",
			"Data Science,Object storage,60",
			"Marketing,Content delivery network,25",
			"Marketing,Compute,4",
			"Sales,Customer relationship management hosting,12",
			"Sales,Compute,2",
			"Finance,Managed databases,3",
		].join("\n"),
		unit: { label: "$k", forms: THOUSAND_DOLLARS },
		nodes: CLOUD_BUDGET_NODES,
		flows: CLOUD_BUDGET_FLOWS,
	},
	{
		id: "website-traffic-sankey",
		title: "Website visits",
		difficulty: "standard",
		tags: ["sankey", "traffic", "three-columns", "crossings"],
		description:
			"Last month's website visits from three traffic sources through three landing pages to three outcomes, fifteen flows that cross.",
		prompt:
			"Draw a Sankey diagram of last month's website visits, from traffic source through landing page to outcome. Organic search: Home 4,200, Pricing 1,800, Blog 3,000. Paid ads: Pricing 2,400, Home 600. Social: Blog 1,500, Home 500. From Home: Signed up 700, Requested demo 200, Bounced 4,400. From Pricing: Signed up 1,200, Requested demo 400, Bounced 2,600. From Blog: Signed up 300, Bounced 4,200.",
		nodes: WEBSITE_TRAFFIC_NODES,
		flows: WEBSITE_TRAFFIC_FLOWS,
	},
	{
		id: "website-traffic-sankey-v2",
		title: "Website visits",
		difficulty: "standard",
		tags: ["sankey", "traffic", "three-columns", "crossings", "real-voice"],
		description:
			"Last month's website visits from three traffic sources through three landing pages to three outcomes, fifteen flows that cross.",
		prompt: [
			"sankey of last month's site visits, source → landing page → outcome",
			"",
			"from,to,visits",
			"Organic search,Home,4200",
			"Organic search,Pricing,1800",
			"Organic search,Blog,3000",
			"Paid ads,Pricing,2400",
			"Paid ads,Home,600",
			"Social,Blog,1500",
			"Social,Home,500",
			"Home,Signed up,700",
			"Home,Requested demo,200",
			"Home,Bounced,4400",
			"Pricing,Signed up,1200",
			"Pricing,Requested demo,400",
			"Pricing,Bounced,2600",
			"Blog,Signed up,300",
			"Blog,Bounced,4200",
		].join("\n"),
		nodes: WEBSITE_TRAFFIC_NODES,
		flows: WEBSITE_TRAFFIC_FLOWS,
	},
	{
		id: "hiring-funnel-sankey",
		title: "Engineering hiring funnel",
		difficulty: "standard",
		tags: ["sankey", "funnel", "drop-offs"],
		description:
			"A hiring funnel of five stages with rejections and withdrawals at every stage, drawn as one shared drop-off or one per stage.",
		prompt:
			"Draw a Sankey diagram of our 2026 engineering hiring funnel. Of 1,200 Applicants, 300 moved on to Phone screen and 900 were Rejected. From Phone screen, 120 moved on to Onsite, 150 were Rejected and 30 Withdrew. From Onsite, 40 moved on to Offer, 70 were Rejected and 10 Withdrew. From Offer, 32 were Hired and 8 Declined.",
		nodes: HIRING_FUNNEL_NODES,
		flows: HIRING_FUNNEL_FLOWS,
	},
	{
		id: "hiring-funnel-sankey-v2",
		title: "Engineering hiring funnel",
		difficulty: "standard",
		tags: ["sankey", "funnel", "drop-offs", "real-voice"],
		description:
			"A hiring funnel of five stages with rejections and withdrawals at every stage, drawn as one shared drop-off or one per stage.",
		prompt: [
			"sankey of our 2026 eng hiring funnel",
			"",
			"from,to,candidates",
			"Applicants,Phone screen,300",
			"Applicants,Rejected,900",
			"Phone screen,Onsite,120",
			"Phone screen,Rejected,150",
			"Phone screen,Withdrew,30",
			"Onsite,Offer,40",
			"Onsite,Rejected,70",
			"Onsite,Withdrew,10",
			"Offer,Hired,32",
			"Offer,Declined,8",
		].join("\n"),
		nodes: HIRING_FUNNEL_NODES,
		flows: HIRING_FUNNEL_FLOWS,
	},
	{
		id: "city-energy-sankey",
		title: "City energy flow",
		difficulty: "challenge",
		tags: ["sankey", "energy", "five-columns", "long-links"],
		description:
			"A city's yearly energy in GWh over five columns: sources, a gas plant, the grid, three sectors and what became useful or waste, with gas imports that skip to the sectors.",
		prompt:
			"Draw a Sankey diagram of our city's energy flow last year in GWh, from source through generation and the grid to end use and what it became. Solar farms: Grid electricity 120. Natural gas imports: Gas plant 550, Homes 260, Industry 180. Gas plant: Grid electricity 340, Heat losses 210. Grid electricity: Homes 190, Industry 150, Transport 70, Line losses 50. Homes: Useful energy 300, Waste heat 150. Industry: Useful energy 240, Waste heat 90. Transport: Useful energy 25, Waste heat 45.",
		unit: { label: "GWh", forms: { gwh: 1, gigawatthours: 1, mwh: 0.001 } },
		nodes: CITY_ENERGY_NODES,
		flows: CITY_ENERGY_FLOWS,
	},
	{
		id: "city-energy-sankey-v2",
		title: "City energy flow",
		difficulty: "challenge",
		tags: ["sankey", "energy", "five-columns", "long-links", "real-voice"],
		description:
			"A city's yearly energy in GWh over five columns: sources, a gas plant, the grid, three sectors and what became useful or waste, with gas imports that skip to the sectors.",
		prompt: [
			"sankey of the city's energy flows last year, in GWh",
			"",
			"from,to,GWh",
			"Solar farms,Grid electricity,120",
			"Natural gas imports,Gas plant,550",
			"Natural gas imports,Homes,260",
			"Natural gas imports,Industry,180",
			"Gas plant,Grid electricity,340",
			"Gas plant,Heat losses,210",
			"Grid electricity,Homes,190",
			"Grid electricity,Industry,150",
			"Grid electricity,Transport,70",
			"Grid electricity,Line losses,50",
			"Homes,Useful energy,300",
			"Homes,Waste heat,150",
			"Industry,Useful energy,240",
			"Industry,Waste heat,90",
			"Transport,Useful energy,25",
			"Transport,Waste heat,45",
		].join("\n"),
		unit: { label: "GWh", forms: { gwh: 1, gigawatthours: 1, mwh: 0.001 } },
		nodes: CITY_ENERGY_NODES,
		flows: CITY_ENERGY_FLOWS,
	},
];

export const sankeyScenarios: readonly SankeyScenario[] =
	sankeyScenarioDefinitions.map(defineSankeyScenario);
