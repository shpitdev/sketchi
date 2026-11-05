import { DIAGRAM_TYPES, type DiagramTypeValue } from "@sketchi/diagram-core";
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
	`Set diagram.type to the kind the scenario requests: ${listAlternatives(NATIVE_KINDS)}. A swimlane or architecture request is a "flowchart" with lanes or zone groups. Anything else uses the closest kind.`,
];

const FLOWCHART_IR_INSTRUCTIONS = [
	'Use diagram type "flowchart".',
	'Every node must have id, label, and kind: "start", "process", "decision", or "end".',
	"Use exactly one start node and at least one end node.",
	"Every non-end node must have at least one outgoing edge; every end node must have zero outgoing edges.",
	"Give every action the scenario states its own node; never fold one into an edge label, another node, or a check. A return path that names an action passes through a node for it before it rejoins.",
	"Add no next step the scenario gives only to other branches.",
	"If the scenario says where the flow ends, every branch leads to that node. Otherwise a branch with no stated next step stops at its last step: mark that step as the end node, never a new result after it.",
	"Every decision node must have at least two outgoing edges with non-empty unique labels.",
	"For each retry, return, or feedback loop, include a real back-edge to an earlier distinct process or decision. Never target start and never use a self-loop.",
	'Only when the scenario groups steps (teams, zones, phases), add groups [{ "id", "label" }] and set each member node\'s group to its innermost group id; leave other nodes ungrouped. Every zone the scenario names is its own group. One inside another sets "parent" to the zone that holds it, wherever the scenario says so, and "kind" (cloud, datacenter, region, zone, vpc, subnet, cluster or namespace) when the scenario names what a zone is. Set "shape", also on a start or end: "database" for databases, "document" for files, archives and reports, "queue" for queues, streams and topics, "storage" for buckets and object stores; only users stay ellipses. In an architecture the entry is the start and each sink an end.',
	'For swimlanes, a process across actors or roles, add lanes [{ "id", "label" }] in the scenario\'s order and set every node\'s lane to its actor; lanes take no groups.',
	'Use layout { "direction": "TB", "edgeRouting": "orthogonal" } unless the scenario says otherwise.',
];

const MINDMAP_IR_INSTRUCTIONS = [
	'Use diagram type "mindmap".',
	"Return one nested root topic with label and children. Every child also has label and children; use an empty children array for a leaf.",
	"Return the diagram id. Do not return flat nodes, edges, derived ids, depth, sibling indexes, or parent references; Sketchi derives them deterministically.",
	"Unless the scenario is intentionally tiny, create 2-4 children per major topic and 2-3 meaningful levels.",
	'Use layout { "direction": "LR", "edgeRouting": "curved" } unless the scenario says right-to-left.',
];

const SEQUENCE_IR_INSTRUCTIONS = [
	'Use diagram type "sequence".',
	"Return ordered participants with stable ids and human labels.",
	"Return chronological messages with stable ids, participant source and target ids, and concise labels.",
	'Use message type "message" for calls and "return" for responses; dashed style is appropriate for responses.',
	"Answer a call with a later return from the callee back to the caller; Sketchi draws the callee's activation bar from the call to its return. Leave fire-and-forget events unanswered.",
	"A message from a participant to itself draws as a self-message loop.",
	"Use at most 12 participants and 40 messages.",
];

/** Model-facing IR rules for each canonical family, in registry order. */
const IR_INSTRUCTIONS = {
	timeline: {
		title: "Timeline IR rules",
		rules: [
			'Use diagram type "timeline".',
			"Return events with unique stable id, label, optional concise description, and either date or order.",
			"Keep each date at the source's precision: YYYY, YYYY-MM, YYYY-MM-DD, or YYYY-MM-DDTHH:mm[:ss] with Z or the stated ±HH:MM offset.",
			"Use dates for every event, or numeric order for every event when no calendar dates are supplied. Never mix modes or add resources or dependencies.",
			'Optional: end (inclusive) makes a dated phase; kind "milestone" marks key moments; lane names a track for every event (lanes sets their order); today only when the source states it.',
			"Equal dates or orders retain input order. Use 1–60 events and at most 6 lanes.",
		],
	},
	chart: {
		title: "Chart IR rules",
		rules: [
			'Use diagram type "chart".',
			'Set kind to "bar", "line", or "pie". Use a chart only for numeric data; never supply coordinates.',
			"Return categories (x-axis labels, or pie slice names) and series: [{ name, values }] with exactly one value per category, in category order. Name every series when there are several.",
			"Never round data.",
			'Optional: unit ("$", "$M", "%", "ms"), categoryAxisTitle and valueAxisTitle (bar and line), stacked: true (bar), orientation "horizontal" (bar), donut: true (pie).',
			"A pie has exactly one series of non-negative values and at most 8 slices. Bars and lines allow negative values, up to 40 categories and 6 series.",
		],
	},
	flowchart: { title: "Flowchart IR rules", rules: FLOWCHART_IR_INSTRUCTIONS },
	mindmap: { title: "Mindmap IR rules", rules: MINDMAP_IR_INSTRUCTIONS },
	sequence: { title: "Sequence IR rules", rules: SEQUENCE_IR_INSTRUCTIONS },
	"state-machine": {
		title: "State machine IR rules",
		rules: [
			'Use diagram type "state-machine".',
			"Return initial (the id of the top-level state the machine starts in), states, and transitions.",
			'Every state has a unique id without ":". A regular state label defaults to its id verbatim; explicit labels must not be blank. kind "final" ends the machine: name it when it is a named outcome (for example Failed); generic ends need no name; kind "choice" is a branch point whose outgoing transitions each carry a guard: copy each guard the source states; use "else" only for a branch the source gives no condition.',
			"A composite state is a state other states name as parent; give it initial, the substate it starts in. Composites do not nest.",
			"Every transition has a unique id, source, target, and optional event, guard (the condition, without brackets) and action. A transition may leave or enter a composite, or return to its own state.",
			"Every state must be reachable from initial. Final states have no outgoing transitions.",
		],
	},
	gantt: {
		title: "Gantt IR rules",
		rules: [
			'Use diagram type "gantt".',
			"Return tasks with unique id, label, start (YYYY-MM-DD), and end (last day, inclusive) or duration (calendar days counting start). A milestone is milestone: true with start only. Never supply coordinates.",
			"Compute a date only from a stated start plus a stated duration.",
			"Optional: dependsOn lists the ids of tasks that must finish first; phase names a header for every task only when the source itself names phases; otherwise omit it (phases sets their order); progress is percent complete; today only when stated.",
			"Use 1–60 tasks, at most 12 phases, and no dependency cycles.",
		],
	},
	er: {
		title: "ER IR rules",
		rules: [
			'Use diagram type "er".',
			'Return entities: [{ id, name?, fields }]. Ids hold no dot or space; name defaults to the id. Each field is one string "name type markers": "id uuid PK", "order_id uuid PK FK" (composite), "email text UK", "note text?" (nullable), "parent_id int? FK", with type optional.',
			'Return relationships: [{ id, from, to, fromCardinality, toCardinality, label? }]. from is the end holding the foreign key and to the end it points at, as "entity.field" when the source states the key columns ("orders.customer_id" to "customers.id"), otherwise the entity id alone.',
			'Each cardinality is "one", "zero-or-one", "many", "one-or-many" or "zero-or-many": how many rows of that end relate to one row of the other end. fromCardinality is one-or-many if the source says no row of the other side goes without one, zero-or-one if the key is unique or the sole primary key, otherwise zero-or-many. toCardinality is zero-or-one if the key is nullable, otherwise one.',
			"Mark every key column PK, FK or UK as stated.",
		],
	},
	class: {
		title: "Class diagram IR rules",
		rules: [
			'Use diagram type "class".',
			"Use it for UML class diagrams and object-oriented designs; never supply coordinates.",
			'Return classes: [{ id, name?, kind?, stereotype?, attributes, methods }]. kind is "abstract", "interface" or "enum" (its values are attributes), or omitted for a class. Ids hold no colon or space; name defaults to the id.',
			'Write each member as UML does: attributes "- radius: double", "+ count: int {static}"; methods "+ area(): double", "+ draw(ctx: Canvas): void {abstract}". Visibility is +, -, # or ~.',
			'Return relationships: [{ id, kind, from, to, fromMultiplicity?, toMultiplicity?, fromRole?, toRole?, navigable?, label? }]. kind "inheritance" or "realization": from extends or implements to; "composition" or "aggregation": from is the whole; "association"; "dependency": from uses to.',
			'Multiplicities ("1", "0..1", "*", "1..*"), roles and navigable (an open arrow at to) go on compositions, aggregations and associations only; a composition\'s whole is "1" or "0..1". Interfaces extend only interfaces, and inheritance never cycles.',
			"A field typed as another class stays in attributes and also draws a relationship whose toRole is the field's name: an association unless the source says composed or aggregated. A cast to or call on another class inside a method body draws a dependency.",
		],
	},
	"org-chart": {
		title: "Org chart IR rules",
		rules: [
			'Use diagram type "org-chart".',
			"Use it for org charts and team structures: who reports to whom; never supply coordinates.",
			"Return people: [{ id, name, title?, department?, manager?, assistant?, avatar? }]. manager is the id of the person they report to; exactly one person, the top, has none, unless the source states separate trees (then set forest: true). Ids hold no colon.",
			"assistant: true places an assistant beside their manager; an assistant has no reports.",
			'Return dottedLines: [{ id, report, manager, label? }] for each dotted-line or matrix report the source states: report also answers to manager, outside the solid line. Put the scope or reason the source gives for it ("for clinical systems") in label.',
			"Set groupByDepartment: true only when the source asks to group departments into regions.",
		],
	},
	venn: {
		title: "Venn diagram IR rules",
		rules: [
			'Use diagram type "venn".',
			"Use it for Venn diagrams: what two or three overlapping sets share; never supply coordinates or sizes.",
			'Return sets: [{ id, label }] and regions: [{ sets, items?, count?, label? }]. A region\'s sets are the ids it lies in, and it excludes every other set: ["a"] is a only, ["a", "b"] is a and b but not c.',
			"Give a region items (short phrases) or a count, never both. Omit a region the source leaves empty; label names an overlap only when the source does.",
			"Put each item once, in exactly its region.",
		],
	},
	journey: {
		title: "Journey map IR rules",
		rules: [
			'Use diagram type "journey".',
			"Use it for user or customer journey maps: stages of steps, each scored for sentiment; never supply coordinates.",
			"Return stages: [{ name, steps: [{ label, score, actor?, touchpoint? }], painPoints?, opportunities? }] in the order the source gives them. score is a whole number from 1 (very negative) to 5 (very positive); 3 is neutral.",
			'actor is who acts (several who share a step: "Customer, Agent") and touchpoint is the channel (Email, Website, Phone); set the one the source states for each step. persona is whose journey it is, with any role the source gives; actors lists them when the source names several.',
			"painPoints and opportunities are short phrases under the stage the source puts them in.",
		],
	},
	sankey: {
		title: "Sankey IR rules",
		rules: [
			'Use diagram type "sankey".',
			"Use it for weighted flows between stages: budgets, traffic, funnels, energy or material flows; never supply coordinates.",
			"Return nodes: [{ id, label }] and links: [{ source, target, value, label? }]: value is the stated amount, greater than 0. Links run one way; no cycles or self-links.",
			'Optional: unit ("$k", "%", "visits"). Add no balancing node such as Other.',
		],
	},
	wireframe: {
		title: "Wireframe IR rules",
		rules: [
			'Use diagram type "wireframe".',
			"Use it for UI wireframes, mockups and screen layouts; never supply coordinates or sizes.",
			'Return screens: [{ id, name, device: "desktop" | "tablet" | "mobile", children }]. Every component sits under a screen\'s children, in reading order.',
			"Containers hold children: header (top), footer (holds whatever the source puts at the bottom), sidebar (side: left or right), main, section and card (title?), grid (columns: n), modal, row and column.",
			"Widgets: heading (text, level 1-3), text (text, or lines for placeholder copy), badge (text), link (text; target: the id of the screen it opens), button (text; variant primary or secondary; target), input, textarea, select and search (label?, placeholder or value), checkbox, radio and toggle (label, checked), tabs and nav (items, active), breadcrumbs and list (items), avatar, icon, image and chart (label?), table (columns: an array of header strings, rows?), divider.",
			"State: variant primary on the screen's main button, checked: true on what is on or selected, active on the selected tab or nav item, value on a field showing one.",
		],
	},
	quadrant: {
		title: "Quadrant chart IR rules",
		rules: [
			'Use diagram type "quadrant".',
			"Use it for quadrant charts and 2×2 matrices that place items by two measures (effort vs impact, Eisenhower, positioning); never supply coordinates.",
			"Return xAxis and yAxis: { title, low, high }, where low and high label the axis ends (left or bottom, then right or top) as the source words them.",
			"Return quadrants: { topLeft, topRight, bottomLeft, bottomRight }, each name in the corner its two conditions describe through those end labels.",
			"Return points: [{ label, x, y, group? }] with x and y from 0 (low end) to 1 (high end): a score out of 100 is score / 100, and 0.5 sits on a middle line. Place an item given only its quadrant well inside it (0.25 or 0.75).",
			"group colors points the source sets apart and adds a legend. At most 30 points.",
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
					id: "places",
					from: "customers.id",
					to: "orders.customer_id",
					fromCardinality: "one",
					toCardinality: "zero-or-many",
					label: "places",
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
		`A ${element} about one of these technologies may set "icon": { "slug": "<slug>" } using a slug from this list exactly. Put each logo on the ${owner} whose label names that technology. Omit icon on every other ${owner}. Never invent a slug.`,
	];
}

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
		...DIAGRAM_TYPES.flatMap((type) => [
			"",
			`${IR_INSTRUCTIONS[type].title}:`,
			...IR_INSTRUCTIONS[type].rules.map((instruction) => `- ${instruction}`),
		]),
	].join("\n");
	const user = [
		"Scenario:",
		prompt.request,
		"",
		...(explicitType
			? [
					"Type authority:",
					`The caller explicitly requires ${explicitType}. Set diagram.type to ${explicitType}.`,
					"",
				]
			: []),
		"Expected JSON shape (adapt the diagram to the scenario):",
		expectedJsonShape(prompt),
		...logoSection(prompt),
	].join("\n");

	return { system, user };
}
