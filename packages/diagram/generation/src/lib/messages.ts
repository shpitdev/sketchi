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

import { CURATED_EXAMPLES } from "./examples.js";
import { DiagramGenerationTypeSchema } from "./intent.js";

/** `a or b`, or `a, b, or c`, for a list of alternatives. */
export function listAlternatives(values: readonly string[]): string {
	if (values.length < 3) return values.join(" or ");
	return `${values.slice(0, -1).join(", ")}, or ${values.at(-1)}`;
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
	 * The one family an untyped request names (see routeDiagramFamilies). Its prompt is built as
	 * for that type, without requiring it: the model still sets diagram.type.
	 */
	routedType: Schema.optionalKey(DiagramGenerationTypeSchema),
	/**
	 * The two or three families an untyped request could mean (see narrowDiagramFamilies). Its
	 * prompt carries only their rules and asks the model to choose among them.
	 */
	routedTypes: Schema.optionalKey(Schema.Array(DiagramGenerationTypeSchema)),
	/**
	 * The diagram a revision starts from, as canonical diagram JSON ({ type, id, title, ... }).
	 * The request then says what to change.
	 */
	base: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
	/** The request asks for colors or shapes (see asksForStyling), so the prompt says how to return them. */
	styling: Schema.optionalKey(Schema.Boolean),
}) {}

/** Provider adapters map these onto their own system and user channels. */
export class DiagramGenerationMessages extends Schema.Class<DiagramGenerationMessages>(
	"DiagramGenerationMessages",
)({
	system: Schema.String,
	user: Schema.String,
}) {}

const SWIMLANE_KIND =
	'A swimlane or architecture request is a "flowchart" with lanes or zone groups.';

/** Which kinds diagram.type may take: every kind, or the few a narrowed prompt carries. */
function typeInstruction(families: readonly DiagramTypeValue[] | undefined): string {
	if (!families) {
		return `Set diagram.type to the kind the scenario requests: ${listAlternatives(NATIVE_KINDS)}. ${SWIMLANE_KIND} Anything else uses the closest kind.`;
	}
	const kinds = listAlternatives(families.map((type) => `"${type}"`));
	return `Set diagram.type to whichever of ${kinds} the scenario requests, or the closest of them.${families.includes("flowchart") ? ` ${SWIMLANE_KIND}` : ""}`;
}

const commonInstructions = (narrowedTo?: readonly DiagramTypeValue[]) => [
	"Return only compact, minified JSON on one line. Do not use markdown.",
	"Author one concise title of at most 60 characters. Do not copy the whole scenario into the title.",
	'Return one object: { "title", "diagram" }.',
	"Copy everything the scenario states, in full and in its order: every item, name, role, detail, number, key and connection. Add nothing it does not state: no step, decision, branch, loop, outcome, group, phase, field, item, connection or value.",
	"The limits below are what Sketchi can draw, not targets: never drop, merge or summarize stated content to fit one. Sketchi reports a diagram that is too large.",
	typeInstruction(narrowedTo),
];

/**
 * Rules every family needs that the full prompt states only in some families' sections (the id
 * in mindmap's, rounding in chart's, order in sequence's). A prompt that carries one family's
 * rules, or a narrowed few, gets them here; the full prompt already has them and stays as graded.
 */
const ONE_FAMILY_INSTRUCTIONS = [
	"Return diagram.id, a short kebab-case id. Never supply coordinates or sizes: Sketchi lays the diagram out.",
	"Never round a number the scenario states, and keep its order even where another order seems more natural.",
];

/**
 * Generation names the text a diagram comes from "the scenario", as its user message labels it,
 * and "the source" in the families whose rules were graded with that word.
 */
const SCENARIO = "the scenario";
const SOURCE = "the source";
const typeRule = (value: DiagramTypeValue) => `Use diagram type "${value}".`;

const FLOWCHART_INSTRUCTIONS = [
	typeRule("flowchart"),
	`Return diagram as the flowchart document: { "type": "flowchart", "id", "direction"?, "logos"?, "nodes", "edges", "groups"?, "lanes"? }. ${FLOWCHART_RULES.documentShape} A node's details are { "label", "note"?, "shape"? }.`,
	FLOWCHART_RULES.documentRoles(SCENARIO),
	FLOWCHART_RULES.actionNodes(SCENARIO),
	FLOWCHART_RULES.statedChecks,
	FLOWCHART_RULES.technologyLabels,
	FLOWCHART_RULES.noBranchBorrowing(SCENARIO),
	FLOWCHART_RULES.namedOutcomes(SCENARIO),
	FLOWCHART_RULES.branchNames(SCENARIO),
	FLOWCHART_RULES.documentBranches(SCENARIO),
	FLOWCHART_RULES.documentLoops,
	FLOWCHART_RULES.documentNoInventedSteps(SCENARIO),
	`${FLOWCHART_RULES.documentGroups(SCENARIO)} ${FLOWCHART_RULES.zonesOutside}`,
	FLOWCHART_RULES.documentLanes(SCENARIO),
	[
		FLOWCHART_RULES.limits,
		FLOWCHART_RULES.summarize,
		FLOWCHART_RULES.summarizeOnlyUnnamed,
		FLOWCHART_RULES.keepNamed(SCENARIO),
	].join(" "),
	FLOWCHART_RULES.documentDirection(SCENARIO),
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
	flowchart: { title: "Flowchart document rules", rules: FLOWCHART_INSTRUCTIONS },
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
			`${CLASS_RULES.multiplicities} ${CLASS_RULES.navigableWhen(SOURCE)} ${CLASS_RULES.hierarchy}`,
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
			`${WIREFRAME_RULES.widgets} ${WIREFRAME_RULES.titledTable(SOURCE)} ${WIREFRAME_RULES.nav} ${WIREFRAME_RULES.target}`,
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

/** The JSON shape shown for an explicitly requested family that has no curated example. */
const FAMILY_EXAMPLES: Partial<Readonly<Record<DiagramTypeValue, { readonly diagram: object }>>> = {
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
};

/** The family a prompt is built for: the caller's type, or the one an untyped request names. */
export function promptFamily(prompt: DiagramGenerationPrompt): DiagramTypeValue | undefined {
	return prompt.requestedType ?? prompt.routedType;
}

/**
 * The families whose rules a prompt carries: its one family, the few an untyped request was
 * narrowed to, or undefined for every family.
 */
export function promptFamilies(
	prompt: DiagramGenerationPrompt,
): readonly DiagramTypeValue[] | undefined {
	const family = promptFamily(prompt);
	if (family) return [family];
	const narrowed = prompt.routedTypes;
	return narrowed && narrowed.length > 0 && narrowed.length < DIAGRAM_TYPES.length
		? DIAGRAM_TYPES.filter((type) => narrowed.includes(type))
		: undefined;
}

function expectedJsonShape(prompt: DiagramGenerationPrompt): string {
	const family = promptFamily(prompt);
	const curated = family ? CURATED_EXAMPLES[family] : undefined;
	if (curated) {
		return [
			"Worked example: a different request and a correct answer. Follow its approach; draw only what the scenario states.",
			`Request: ${curated.request}`,
			`Answer: ${curated.answer}`,
		].join("\n");
	}
	const shape = family ? FAMILY_EXAMPLES[family] : undefined;
	if (!shape) {
		const supportedExample = {
			title: "Release approval",
			diagram: {
				type: "flowchart",
				id: "release-approval",
				nodes: {
					draft: "Prepare release",
					review: "Approved?",
					publish: "Publish release",
					cancel: "Cancel release",
				},
				edges: [
					["draft", "review"],
					["review", "publish", "approve"],
					["review", "cancel", "reject"],
				],
			},
		};
		return `Response example: ${JSON.stringify(supportedExample)}`;
	}
	return JSON.stringify({
		title: "Concise model-authored title",
		diagram: shape.diagram,
	});
}

/** Families that draw catalog logos, and which element carries them. */
const LOGO_TARGETS = {
	flowchart: {
		rule: 'In a flowchart, set "logos": true and keep each technology\'s name in the label of the node about it; its logo follows the label.',
	},
	sequence: {
		rule: 'A sequence participant about one of these technologies may set "icon": { "slug": "<slug>" } using a slug from this list exactly, and keeps that name in its label. Omit icon on every other participant. Never invent a slug.',
	},
} as const;

function logoSection(prompt: DiagramGenerationPrompt): string[] {
	const logos = prompt.logos ?? [];
	const families = promptFamilies(prompt);
	const targets = (["flowchart", "sequence"] as const)
		.filter((family) => families === undefined || families.includes(family))
		.map((family) => LOGO_TARGETS[family]);
	if (logos.length === 0 || targets.length === 0) {
		return [];
	}
	return [
		"",
		"Available logos:",
		...logos.map(
			(logo) =>
				`- ${logo.slug}: ${logo.name}${logo.aliases?.length ? ` (also ${logo.aliases.join(", ")})` : ""}`,
		),
		...targets.map((target) => target.rule),
	];
}

/** A revision starts from the current diagram; the request says what to change. */
const REVISION_INSTRUCTIONS = [
	"The scenario is a revision: the current diagram with the request applied.",
	"Return the complete revised diagram, not only what changed. Keep diagram.id, and return the current title unless the request changes it.",
	"Keep every element the request does not change, with its id, label, details and order. Change, add or remove only what the request asks.",
];

/** Colors and shapes, sent only to a request that asks for them, so other requests pay nothing. */
const STYLING_INSTRUCTIONS = [
	'When the scenario asks for colors or shapes, also return styles: [{ "targets", "fillColor"?, "strokeColor"?, "textColor"?, "shape"? }] beside diagram, and nothing else when it does not.',
	'targets lists the ids or labels of the nodes and edges a style applies to; a flowchart edge\'s id is "from->to". Colors are #rrggbb: a colored node takes the color as strokeColor and its pale tint as fillColor, so its label stays readable (red #dc2626 on #fee2e2, orange #ea580c on #ffedd5, yellow #ca8a04 on #fef9c3, green #16a34a on #dcfce7, blue #2563eb on #dbeafe, purple #7c3aed on #ede9fe, gray #6b7280 on #f3f4f6); a colored edge takes strokeColor alone. shape is "rectangle", "diamond", "ellipse" or "circle".',
	"Style exactly what the scenario asks for; the diagram's content stays as the other rules say.",
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
	const family = promptFamily(prompt);
	const families = promptFamilies(prompt);
	// A one-family prompt keeps the full type list it was graded with; a narrowed few name theirs.
	const narrowedTo = family ? undefined : families;
	const system = [
		"You are creating one typed Sketchi generation response.",
		"",
		"Response contract:",
		...commonInstructions(narrowedTo).map((instruction) => `- ${instruction}`),
		...(families ? ONE_FAMILY_INSTRUCTIONS.map((instruction) => `- ${instruction}`) : []),
		...(prompt.base
			? ["", "Revision:", ...REVISION_INSTRUCTIONS.map((instruction) => `- ${instruction}`)]
			: []),
		...(prompt.styling
			? ["", "Styling:", ...STYLING_INSTRUCTIONS.map((instruction) => `- ${instruction}`)]
			: []),
		// A request whose family is known gets only that family's rules, a narrowed request only
		// its few families'; otherwise every family's, and the model picks.
		...(families ?? DIAGRAM_TYPES).flatMap((type) => [
			"",
			`${IR_INSTRUCTIONS[type].title}:`,
			...IR_INSTRUCTIONS[type].rules.map((instruction) => `- ${instruction}`),
			...(family && type === "quadrant" ? [`- ${QUADRANT_RULES.usualNames(SOURCE)}`] : []),
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
