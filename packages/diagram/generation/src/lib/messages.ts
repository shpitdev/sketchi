import {
	CHART_RULES,
	CLASS_RULES,
	DIAGRAM_TYPES,
	type DiagramTypeValue,
	ER_RULES,
	FLOWCHART_RULES,
	GANTT_RULES,
	JOURNEY_RULES,
	MINDMAP_RULES,
	ORG_CHART_RULES,
	QUADRANT_RULES,
	SANKEY_RULES,
	SEQUENCE_RULES,
	STATE_MACHINE_RULES,
	TIMELINE_RULES,
	VENN_RULES,
	WIREFRAME_RULES,
} from "@sketchi/diagram-core";
import { Schema } from "effect";

import { DiagramGenerationTypeSchema } from "./intent.js";

/** `a, b, or c` for a list of alternatives. */
export function listAlternatives(values: readonly string[]): string {
	return values.length < 2
		? values.join("")
		: `${values.slice(0, -1).join(", ")}, or ${values.at(-1)}`;
}

const NATIVE_KINDS = DIAGRAM_TYPES.map((type) => `"${type}"`);

/** A catalog logo the prompt names; the only slugs a node icon may use. */
export class DiagramGenerationLogo extends Schema.Class<DiagramGenerationLogo>(
	"DiagramGenerationLogo",
)({
	aliases: Schema.optionalKey(Schema.Array(Schema.String)),
	/** The catalog collection, which marks cloud vendors. */
	collection: Schema.optionalKey(Schema.String),
	name: Schema.String,
	slug: Schema.String,
}) {}

export class DiagramGenerationPrompt extends Schema.Class<DiagramGenerationPrompt>(
	"DiagramGenerationPrompt",
)({
	id: Schema.String,
	/** Logos for technologies the prompt names, in order of mention. */
	logos: Schema.optionalKey(Schema.Array(DiagramGenerationLogo)),
	request: Schema.String,
	requestedType: Schema.optionalKey(DiagramGenerationTypeSchema),
	/**
	 * The diagram a revision starts from, as canonical diagram JSON ({ type, id, title, ... }).
	 * The request then says what to change.
	 */
	base: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
}) {}

/** Provider adapters map these onto their own system and user channels. */
export class DiagramGenerationMessages extends Schema.Class<DiagramGenerationMessages>(
	"DiagramGenerationMessages",
)({
	system: Schema.String,
	user: Schema.String,
}) {}

const COMMON_INSTRUCTIONS = [
	"Return only compact, minified JSON on one line. Do not use markdown.",
	"Author one concise title of at most 60 characters. Do not copy the whole scenario into the title.",
	'Return one object: { "title", "diagram" }.',
	"Copy everything the scenario states, in full and in its order: every item, name, role, detail, number, key and connection. Add nothing it does not state: no step, decision, branch, loop, outcome, group, phase, field, item, connection or value.",
	"The limits below are what Sketchi can draw, not targets: never drop, merge or summarize stated content to fit one. Sketchi reports a diagram that is too large.",
	`Set diagram.type to the kind the scenario requests: ${listAlternatives(NATIVE_KINDS)}. A swimlane or architecture request is a "flowchart" with lanes or zone groups. Anything else uses the closest kind.`,
];

/**
 * Generation names the text a diagram comes from "the scenario", as its user message labels it,
 * and "the source" in the families whose rules were graded with that word.
 */
const SCENARIO = "the scenario";
const SOURCE = "the source";
const typeRule = (value: DiagramTypeValue) => `Use diagram type "${value}".`;

const FLOWCHART_IR_INSTRUCTIONS = [
	typeRule("flowchart"),
	'Every node must have id, label, and kind: "start", "process", "decision", or "end", and may have a description.',
	FLOWCHART_RULES.singleStart,
	FLOWCHART_RULES.edgesByKind,
	FLOWCHART_RULES.actionNodes(SCENARIO),
	FLOWCHART_RULES.statedChecks,
	FLOWCHART_RULES.technologyLabels,
	FLOWCHART_RULES.noBranchBorrowing(SCENARIO),
	FLOWCHART_RULES.statedEnd(SCENARIO),
	FLOWCHART_RULES.branchNames(SCENARIO),
	FLOWCHART_RULES.decisionEdges,
	FLOWCHART_RULES.backEdges,
	`${FLOWCHART_RULES.groups(SCENARIO)} ${FLOWCHART_RULES.zonesOutside}`,
	FLOWCHART_RULES.lanes(SCENARIO),
	[
		FLOWCHART_RULES.limits,
		FLOWCHART_RULES.summarize,
		FLOWCHART_RULES.summarizeOnlyUnnamed,
		FLOWCHART_RULES.keepNamed(SCENARIO),
	].join(" "),
	FLOWCHART_RULES.direction(SCENARIO),
];

const MINDMAP_IR_INSTRUCTIONS = [
	typeRule("mindmap"),
	"Return one nested root topic with label and children. Every child also has label and children; use an empty children array for a leaf.",
	"Return the diagram id. Do not return flat nodes, edges, derived ids, depth, sibling indexes, or parent references; Sketchi derives them deterministically.",
	`${MINDMAP_RULES.order} Use layout { "direction": "LR", "edgeRouting": "curved" } unless the scenario says right-to-left.`,
];

const SEQUENCE_IR_INSTRUCTIONS = [
	typeRule("sequence"),
	"Return ordered participants with stable ids and human labels.",
	"Return chronological messages with stable ids, participant source and target ids, and concise labels.",
	SEQUENCE_RULES.messageTypes,
	`${SEQUENCE_RULES.replies(SCENARIO)} ${SEQUENCE_RULES.fireAndForget}`,
	`${SEQUENCE_RULES.keepOrder(SCENARIO)} ${SEQUENCE_RULES.selfStep}`,
	`Use ${SEQUENCE_RULES.limits}.`,
];

/** Model-facing IR rules for each canonical family, in registry order. */
const IR_INSTRUCTIONS = {
	timeline: {
		title: "Timeline IR rules",
		rules: [
			typeRule("timeline"),
			"Return events with unique stable id, label, optional concise description, and either date or order.",
			TIMELINE_RULES.precision(SOURCE),
			TIMELINE_RULES.mode,
			TIMELINE_RULES.optional(SOURCE),
			TIMELINE_RULES.ties,
		],
	},
	chart: {
		title: "Chart IR rules",
		rules: [
			typeRule("chart"),
			'Set kind to "bar", "line", or "pie". Use a chart only for numeric data; never supply coordinates.',
			CHART_RULES.categories,
			CHART_RULES.noRounding,
			`Optional: unit ("$", "$M", "%", "ms"), categoryAxisTitle and valueAxisTitle (bar and line), stacked: true (bar), orientation "horizontal" (bar), donut: true (pie). ${CHART_RULES.unit}`,
			CHART_RULES.limits,
		],
	},
	flowchart: { title: "Flowchart IR rules", rules: FLOWCHART_IR_INSTRUCTIONS },
	mindmap: { title: "Mindmap IR rules", rules: MINDMAP_IR_INSTRUCTIONS },
	sequence: { title: "Sequence IR rules", rules: SEQUENCE_IR_INSTRUCTIONS },
	"state-machine": {
		title: "State machine IR rules",
		rules: [
			typeRule("state-machine"),
			"Return initial (the id of the top-level state the machine starts in), states, and transitions.",
			`${STATE_MACHINE_RULES.ids} ${STATE_MACHINE_RULES.label} ${STATE_MACHINE_RULES.kinds(SOURCE)}`,
			STATE_MACHINE_RULES.composite,
			STATE_MACHINE_RULES.transitions,
			`${STATE_MACHINE_RULES.reachable} ${STATE_MACHINE_RULES.endsLifecycle}`,
			`Optional: layout { "direction": "LR" | "TB" } when the source states one. ${STATE_MACHINE_RULES.layout}`,
		],
	},
	gantt: {
		title: "Gantt IR rules",
		rules: [
			typeRule("gantt"),
			GANTT_RULES.tasks,
			GANTT_RULES.duration,
			GANTT_RULES.optional(SOURCE),
			GANTT_RULES.limits,
		],
	},
	er: {
		title: "ER IR rules",
		rules: [
			typeRule("er"),
			`Return entities: [{ id, name?, fields }]. ${ER_RULES.ids} ${ER_RULES.fields}`,
			`Return relationships: [{ id, from, to, fromCardinality, toCardinality, label? }]. ${ER_RULES.direction(SOURCE)}`,
			`${ER_RULES.cardinalities} ${ER_RULES.cardinalityFromKeys(SOURCE)}`,
			ER_RULES.keys,
		],
	},
	class: {
		title: "Class diagram IR rules",
		rules: [
			typeRule("class"),
			"Use it for UML class diagrams and object-oriented designs; never supply coordinates.",
			`Return classes: [{ id, name?, kind?, stereotype?, attributes, methods }]. ${CLASS_RULES.kinds} ${CLASS_RULES.ids} ${CLASS_RULES.stereotype(SOURCE)}`,
			CLASS_RULES.members,
			`Return relationships: [{ id, kind, from, to, fromMultiplicity?, toMultiplicity?, fromRole?, toRole?, navigable?, label? }]. ${CLASS_RULES.relationships}`,
			`${CLASS_RULES.multiplicities} ${CLASS_RULES.hierarchy}`,
			`${CLASS_RULES.typedFields(SOURCE)} ${CLASS_RULES.onlyStated(SOURCE)}`,
		],
	},
	"org-chart": {
		title: "Org chart IR rules",
		rules: [
			typeRule("org-chart"),
			"Use it for org charts and team structures: who reports to whom; never supply coordinates.",
			`Return people: [{ id, name, title?, department?, manager?, assistant?, avatar? }]. ${ORG_CHART_RULES.manager(SOURCE)} ${ORG_CHART_RULES.ids}`,
			`${ORG_CHART_RULES.assistant} ${ORG_CHART_RULES.avatar}`,
			ORG_CHART_RULES.dottedLines(SOURCE),
			ORG_CHART_RULES.groupOnlyWhenAsked(SOURCE),
		],
	},
	venn: {
		title: "Venn diagram IR rules",
		rules: [
			typeRule("venn"),
			"Use it for Venn diagrams: what two or three overlapping sets share; never supply coordinates or sizes.",
			`Return sets: [{ id, label, color? }] and regions: [{ sets, items?, count?, label? }]. ${VENN_RULES.regions}`,
			VENN_RULES.contents(SOURCE),
			VENN_RULES.placement,
			VENN_RULES.colorWhenStated(SOURCE),
		],
	},
	journey: {
		title: "Journey map IR rules",
		rules: [
			typeRule("journey"),
			"Use it for user or customer journey maps: stages of steps, each scored for sentiment; never supply coordinates.",
			`${JOURNEY_RULES.stages(SOURCE)} ${JOURNEY_RULES.score}`,
			JOURNEY_RULES.actors(SOURCE),
			JOURNEY_RULES.notes(SOURCE),
		],
	},
	sankey: {
		title: "Sankey IR rules",
		rules: [
			typeRule("sankey"),
			"Use it for weighted flows between stages: budgets, traffic, funnels, energy or material flows; never supply coordinates.",
			SANKEY_RULES.links,
			`${SANKEY_RULES.optional} ${SANKEY_RULES.color(SOURCE)} ${SANKEY_RULES.dropOff(SOURCE)}`,
		],
	},
	wireframe: {
		title: "Wireframe IR rules",
		rules: [
			typeRule("wireframe"),
			"Use it for UI wireframes, mockups and screen layouts; never supply coordinates or sizes.",
			`Return screens: [{ id, name, device: "desktop" | "tablet" | "mobile", children }]. ${WIREFRAME_RULES.readingOrder}`,
			`${WIREFRAME_RULES.containers(SOURCE)} ${WIREFRAME_RULES.rows}`,
			`${WIREFRAME_RULES.widgets} ${WIREFRAME_RULES.nav} ${WIREFRAME_RULES.target}`,
			`${WIREFRAME_RULES.state} ${WIREFRAME_RULES.disabled(SOURCE)}`,
			WIREFRAME_RULES.screens,
		],
	},
	quadrant: {
		title: "Quadrant chart IR rules",
		rules: [
			typeRule("quadrant"),
			"Use it for quadrant charts and 2×2 matrices that place items by two measures (effort vs impact, Eisenhower, positioning); never supply coordinates.",
			QUADRANT_RULES.axisEnds(SOURCE),
			QUADRANT_RULES.names,
			QUADRANT_RULES.points,
			QUADRANT_RULES.axes(SOURCE),
			`${QUADRANT_RULES.groups(SOURCE)} ${QUADRANT_RULES.limits}`,
		],
	},
} as const satisfies Record<DiagramTypeValue, { title: string; rules: readonly string[] }>;

/** The JSON shape shown for an explicitly requested family. */
const FAMILY_EXAMPLES = {
	timeline: {
		diagram: {
			id: "release",
			type: "timeline",
			events: [
				{ id: "beta", label: "Beta", date: "2026-09-15" },
				{ id: "ship", label: "Ship", date: "2026-10-01" },
			],
		},
	},
	chart: {
		diagram: {
			id: "quarterly-revenue",
			type: "chart",
			kind: "bar",
			categories: ["Q1", "Q2"],
			series: [{ name: "Revenue", values: [42, 51] }],
			unit: "$M",
		},
	},
	flowchart: {
		diagram: {
			id: "short-kebab-case-id",
			type: "flowchart",
			nodes: [
				{ id: "start-id", label: "Human label", kind: "start" },
				{ id: "decision-id", label: "Question?", kind: "decision" },
			],
			edges: [
				{
					id: "edge-id",
					source: "decision-id",
					target: "target-id",
					label: "yes",
				},
			],
			layout: { direction: "TB", edgeRouting: "orthogonal" },
		},
	},
	mindmap: {
		diagram: {
			id: "short-kebab-case-id",
			type: "mindmap",
			root: {
				label: "Root topic",
				children: [{ label: "Child topic", children: [] }],
			},
			layout: { direction: "LR", edgeRouting: "curved" },
		},
	},
	sequence: {
		diagram: {
			id: "short-kebab-case-id",
			type: "sequence",
			participants: [
				{ id: "client", label: "Client" },
				{ id: "service", label: "Service" },
			],
			messages: [
				{
					id: "request",
					source: "client",
					target: "service",
					label: "Request",
					type: "message",
				},
			],
		},
	},
	"state-machine": {
		diagram: {
			id: "short-kebab-case-id",
			type: "state-machine",
			initial: "pending",
			states: [
				{ id: "pending", label: "Pending" },
				{ id: "paid", label: "Paid" },
				{ id: "done", kind: "final" },
			],
			transitions: [
				{
					id: "pay",
					source: "pending",
					target: "paid",
					event: "pay",
					guard: "card valid",
					action: "charge",
				},
				{ id: "remind", source: "pending", target: "pending", event: "timeout" },
				{ id: "close", source: "paid", target: "done" },
			],
		},
	},
	gantt: {
		diagram: {
			id: "short-kebab-case-id",
			type: "gantt",
			tasks: [
				{ id: "design", label: "Design", start: "2026-03-02", end: "2026-03-06", phase: "Build" },
				{
					id: "api",
					label: "API",
					start: "2026-03-09",
					duration: 10,
					phase: "Build",
					dependsOn: ["design"],
				},
				{
					id: "launch",
					label: "Launch",
					start: "2026-03-19",
					milestone: true,
					phase: "Ship",
					dependsOn: ["api"],
				},
			],
		},
	},
	er: {
		diagram: {
			id: "short-kebab-case-id",
			type: "er",
			entities: [
				{ id: "customers", fields: ["id uuid PK", "email text UK"] },
				{ id: "orders", fields: ["id uuid PK", "customer_id uuid FK", "shipped_at date?"] },
			],
			relationships: [
				{
					id: "placed-by",
					from: "orders.customer_id",
					to: "customers.id",
					fromCardinality: "zero-or-many",
					toCardinality: "one",
					label: "placed by",
				},
			],
		},
	},
	class: {
		diagram: {
			id: "short-kebab-case-id",
			type: "class",
			classes: [
				{ id: "Shape", kind: "abstract", methods: ["+ area(): double {abstract}"] },
				{ id: "Circle", attributes: ["- radius: double"], methods: ["+ area(): double"] },
				{ id: "Canvas", methods: ["+ add(shape: Shape): void"] },
			],
			relationships: [
				{ id: "circle-is-shape", kind: "inheritance", from: "Circle", to: "Shape" },
				{
					id: "canvas-holds",
					kind: "aggregation",
					from: "Canvas",
					to: "Shape",
					fromMultiplicity: "1",
					toMultiplicity: "0..*",
					toRole: "shapes",
				},
			],
		},
	},
	"org-chart": {
		diagram: {
			id: "short-kebab-case-id",
			type: "org-chart",
			people: [
				{ id: "ceo", name: "Ada Lovelace", title: "CEO" },
				{
					id: "ea",
					name: "Grace Hopper",
					title: "Executive Assistant",
					manager: "ceo",
					assistant: true,
				},
				{ id: "cto", name: "Alan Turing", title: "CTO", department: "Engineering", manager: "ceo" },
				{ id: "cpo", name: "Radia Perlman", title: "CPO", department: "Product", manager: "ceo" },
				{ id: "ux", name: "Don Norman", title: "Designer", department: "Product", manager: "cpo" },
			],
			dottedLines: [{ id: "ux-cto", report: "ux", manager: "cto", label: "design system" }],
		},
	},
	venn: {
		diagram: {
			id: "short-kebab-case-id",
			type: "venn",
			sets: [
				{ id: "ios", label: "iOS" },
				{ id: "android", label: "Android" },
			],
			regions: [
				{ sets: ["ios"], items: ["Apple Pay"] },
				{ sets: ["android"], items: ["Google Pay"] },
				{ sets: ["ios", "android"], items: ["Push notifications", "Dark mode"] },
			],
		},
	},
	journey: {
		diagram: {
			id: "short-kebab-case-id",
			type: "journey",
			persona: "Maya, a first-time buyer",
			stages: [
				{
					name: "Discover",
					steps: [{ label: "Sees an ad", score: 4, touchpoint: "Instagram" }],
				},
				{
					name: "Buy",
					steps: [
						{ label: "Creates an account", score: 2, touchpoint: "Website" },
						{ label: "Pays by card", score: 3, touchpoint: "Website" },
					],
					painPoints: ["Forced account creation"],
					opportunities: ["Offer guest checkout"],
				},
			],
		},
	},
	sankey: {
		diagram: {
			id: "cloud-budget",
			type: "sankey",
			unit: "$k",
			nodes: [
				{ id: "eng", label: "Engineering" },
				{ id: "compute", label: "Compute" },
				{ id: "storage", label: "Storage" },
			],
			links: [
				{ source: "eng", target: "compute", value: 310 },
				{ source: "eng", target: "storage", value: 45 },
			],
		},
	},
	wireframe: {
		diagram: {
			id: "short-kebab-case-id",
			type: "wireframe",
			screens: [
				{
					id: "login",
					name: "Login",
					device: "mobile",
					children: [
						{ type: "heading", text: "Welcome back" },
						{ type: "input", label: "Email", placeholder: "you@example.com" },
						{ type: "toggle", label: "Remember me", checked: true },
						{ type: "button", text: "Sign in", variant: "primary" },
						{ type: "link", text: "Forgot password?" },
					],
				},
			],
		},
	},
	quadrant: {
		diagram: {
			id: "effort-impact",
			type: "quadrant",
			xAxis: { title: "Effort", low: "Low effort", high: "High effort" },
			yAxis: { title: "Impact", low: "Low impact", high: "High impact" },
			quadrants: {
				topLeft: "Quick wins",
				topRight: "Major projects",
				bottomLeft: "Fill-ins",
				bottomRight: "Thankless tasks",
			},
			points: [
				{ label: "Dark mode", x: 0.2, y: 0.75 },
				{ label: "Billing rewrite", x: 0.9, y: 0.3 },
			],
		},
	},
} as const satisfies Record<DiagramTypeValue, { diagram: object }>;

function expectedJsonShape(prompt: DiagramGenerationPrompt): string {
	const selectedType = prompt.requestedType;
	if (!selectedType) {
		const supportedExample = {
			title: "Release approval",
			diagram: {
				id: "release-approval",
				type: "flowchart",
				nodes: [
					{ id: "start", label: "Start", kind: "start" },
					{ id: "draft", label: "Prepare release", kind: "process" },
					{ id: "review", label: "Approved?", kind: "decision" },
					{ id: "publish", label: "Publish release", kind: "end" },
					{ id: "cancel", label: "Cancel release", kind: "end" },
				],
				edges: [
					{ id: "begin", source: "start", target: "draft" },
					{ id: "submit", source: "draft", target: "review" },
					{ id: "approve", source: "review", target: "publish", label: "approve" },
					{ id: "reject", source: "review", target: "cancel", label: "reject" },
				],
				layout: { direction: "TB", edgeRouting: "orthogonal" },
			},
		};
		return `Response example: ${JSON.stringify(supportedExample)}`;
	}
	const { diagram } = FAMILY_EXAMPLES[selectedType];
	return JSON.stringify({
		title: "Concise model-authored title",
		diagram,
	});
}

/** Families that draw catalog logos, and which element carries them. */
const LOGO_TARGETS = {
	flowchart: { element: "flowchart node", owner: "node" },
	sequence: { element: "sequence participant", owner: "participant" },
} as const;

function logoSection(prompt: DiagramGenerationPrompt): string[] {
	const logos = prompt.logos ?? [];
	const targets =
		prompt.requestedType === undefined
			? Object.values(LOGO_TARGETS)
			: prompt.requestedType === "flowchart" || prompt.requestedType === "sequence"
				? [LOGO_TARGETS[prompt.requestedType]]
				: [];
	if (logos.length === 0 || targets.length === 0) {
		return [];
	}
	const element = targets.map((target) => target.element).join(" or ");
	const owner = targets.map((target) => target.owner).join(" or ");
	return [
		"",
		"Available logos:",
		...logos.map(
			(logo) =>
				`- ${logo.slug}: ${logo.name}${logo.aliases?.length ? ` (also ${logo.aliases.join(", ")})` : ""}`,
		),
		`A ${element} about one of these technologies may set "icon": { "slug": "<slug>" } using a slug from this list exactly. Put each logo on the ${owner} whose label names that technology, and keep that name in the label. Omit icon on every other ${owner}. Never invent a slug.`,
	];
}

/** A revision starts from the current diagram; the request says what to change. */
const REVISION_INSTRUCTIONS = [
	"The scenario is a revision: the current diagram with the request applied.",
	"Return the complete revised diagram, not only what changed. Keep diagram.id, and return the current title unless the request changes it.",
	"Keep every element the request does not change, with its id, label, details and order. Change, add or remove only what the request asks.",
];

/** The current diagram as the model reads it: its content, without the fixed palette. */
function baseDiagramJson(base: Readonly<Record<string, unknown>>): string {
	const { style: _style, ...content } = base;
	return JSON.stringify(content);
}

/**
 * A ceiling, not a target: billing counts only the tokens written, though the
 * provider's output rate limit reserves the whole ceiling while a call runs.
 * Haiku 5.5 wrote the ten large scenarios in 1,062 to 4,092 tokens (a 60-task
 * Gantt the most, a 60-step flowchart 3,525), so an answer that reaches this is
 * too large for one diagram; it fails as such instead of being repaired.
 */
export const DEFAULT_MAX_OUTPUT_TOKENS = 16_384;
export const DEFAULT_TEMPERATURE = 0.1;

export function buildDiagramGenerationMessages(
	prompt: DiagramGenerationPrompt,
): DiagramGenerationMessages {
	const explicitType = prompt.requestedType;
	const system = [
		"You are creating one typed Sketchi generation response.",
		"",
		"Response contract:",
		...COMMON_INSTRUCTIONS.map((instruction) => `- ${instruction}`),
		...(prompt.base
			? ["", "Revision:", ...REVISION_INSTRUCTIONS.map((instruction) => `- ${instruction}`)]
			: []),
		// A caller that names the family gets only that family's rules; otherwise the model picks.
		...(explicitType ? [explicitType] : DIAGRAM_TYPES).flatMap((type) => [
			"",
			`${IR_INSTRUCTIONS[type].title}:`,
			...IR_INSTRUCTIONS[type].rules.map((instruction) => `- ${instruction}`),
		]),
	].join("\n");
	const user = [
		...(prompt.base
			? ["Current diagram:", baseDiagramJson(prompt.base), "", "Revision request:"]
			: ["Scenario:"]),
		prompt.request,
		"",
		...(explicitType
			? [
					"Type authority:",
					`The caller explicitly requires ${explicitType}. Set diagram.type to ${explicitType}.`,
					"",
				]
			: []),
		...(prompt.base
			? []
			: ["Expected JSON shape (adapt the diagram to the scenario):", expectedJsonShape(prompt)]),
		...logoSection(prompt),
	].join("\n");

	return { system, user };
}
