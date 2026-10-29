import { DIAGRAM_TYPES, type DiagramTypeValue } from "@sketchi/diagram-core";
import { Schema } from "effect";

import { DiagramGenerationTypeSchema, UnsupportedDiagramIntentKindSchema } from "./intent.js";

/** `a, b, or c` for a list of alternatives. */
export function listAlternatives(values: readonly string[]): string {
	return values.length < 2
		? values.join("")
		: `${values.slice(0, -1).join(", ")}, or ${values.at(-1)}`;
}

const NATIVE_KINDS = DIAGRAM_TYPES.map((type) => `"${type}"`);
const UNSUPPORTED_KINDS: readonly string[] = UnsupportedDiagramIntentKindSchema.literals;

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
	`Set intent.requestedKind to the diagram kind the scenario actually requests: ${listAlternatives([...NATIVE_KINDS, ...UNSUPPORTED_KINDS.map((kind) => `"${kind}"`)])}.`,
	`Sketchi supports only nativeKind ${listAlternatives(NATIVE_KINDS)}. If the requested kind is ${listAlternatives(UNSUPPORTED_KINDS)}, set nativeKind to null, omit diagram, and never coerce it into a supported kind.`,
	"When nativeKind is null, return an empty requirements array because there is no native artifact to validate.",
	"List every measurable scenario requirement once in intent.requirements. Convert counts and minimums into count requirements, hierarchy depth into topic_levels, and required names or branch/message text into label requirements.",
	'Count requirement target must be exactly one of "nodes", "decision_nodes", "terminal_nodes", "topics", "participants", "messages", "events", "categories", "states", "transitions", "tasks", "entities", "classes", "people", "sets", "items", "relationships", "links", "screens", or "cycles". Use "cycles" for loops and retry cycles; never invent another target name.',
	'Depth requirement target must be exactly "topic_levels". Label requirement target must be exactly one of "node", "branch", "topic", "participant", "message", "event", "category", "series", "state", "transition", "task", "phase", "entity", "field", "class", "member", "person", "set", "item", "screen", or "component".',
	'Use comparator "minimum" for phrases such as "at least" and "exact" for exact counts. Do not invent measurable requirements that the scenario did not request.',
	"The diagram must satisfy every requirement in the plan. Sketchi deterministically checks the plan against the artifact.",
];

const FLOWCHART_IR_INSTRUCTIONS = [
	'Use diagram type "flowchart".',
	'Every node must have id, label, and kind: "start", "process", "decision", or "end".',
	"Use exactly one start node and at least one end node.",
	"Every non-end node must have at least one outgoing edge; every end node must have zero outgoing edges.",
	"Every decision node must have at least two outgoing edges with non-empty unique labels.",
	"For each retry, return, or feedback loop, include a real back-edge to an earlier distinct process or decision. Never target start and never use a self-loop.",
	"Edges must use existing node ids.",
	'Only when the scenario groups steps (teams, zones, phases), add groups [{ "id", "label" }] and set each member node\'s group to its innermost group id; leave other nodes ungrouped. A group inside another (a subnet in a VPC) sets "parent", and "kind" (cloud, datacenter, region, zone, vpc, subnet, cluster or namespace) when the scenario names what a zone is. Set "shape", also on a start or end: "database" for databases, "document" for files, archives and reports, "queue" for queues, streams and topics, "storage" for buckets and object stores; only users stay ellipses. In an architecture the entry is the start and each sink an end.',
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
	"Every message source and target must reference a participant; a message from a participant to itself draws as a self-message loop.",
	"Use at most 12 participants and 40 messages.",
];

/** Model-facing IR rules for each canonical family, in registry order. */
const IR_INSTRUCTIONS = {
	timeline: {
		title: "Timeline IR rules",
		rules: [
			'Use diagram type "timeline".',
			"Return events with unique stable id, label, optional concise description, and either date or order.",
			"Keep each date at the source's precision: YYYY, YYYY-MM, YYYY-MM-DD, or YYYY-MM-DDTHH:mm[:ss] with Z or the stated ±HH:MM offset. Never invent dates or events.",
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
			"Copy every number, category, series name, unit, and axis title from the source; never invent or round data.",
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
			'Every state has a unique id without ":". A regular state label defaults to its id verbatim; explicit labels must not be blank. kind "final" ends the machine: name it when it is a named outcome (for example Failed); generic ends need no name; kind "choice" is a branch point whose outgoing transitions each carry a guard; one may be "else".',
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
			"Copy every task, date, duration, dependency, milestone, phase and percent from the source; invent none. Compute a date only from a stated start plus a stated duration.",
			"Optional: dependsOn lists the ids of tasks that must finish first; phase names a header for every task (phases sets their order); progress is percent complete; today only when stated.",
			"Use 1–60 tasks, at most 12 phases, and no dependency cycles.",
		],
	},
	er: {
		title: "ER IR rules",
		rules: [
			'Use diagram type "er".',
			"Use it for database schemas and entity-relationship diagrams; never supply coordinates.",
			'Return entities: [{ id, name?, fields }]. Ids hold no dot or space; name defaults to the id. Each field is one string "name type markers": "id uuid PK", "customer_id uuid FK", "email text UK", "note text?" (nullable), with type optional.',
			'Return relationships: [{ id, from, to, fromCardinality, toCardinality, label? }]. from and to name an entity, or "entity.field" for the key column at each end: "orders.customer_id" to "customers.id".',
			'Each cardinality is "one", "zero-or-one", "many", "one-or-many" or "zero-or-many": how many rows of that end relate to one row of the other end.',
			"Copy every entity, field, type, key, nullable marker and cardinality the source states; invent none. Mark every key column PK, FK or UK as stated.",
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
			"Copy every class, member, relationship, multiplicity and role the source states; invent none.",
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
			"Copy every person, title, department, reporting line and dotted line the source states; invent none.",
		],
	},
	venn: {
		title: "Venn diagram IR rules",
		rules: [
			'Use diagram type "venn".',
			"Use it for Venn diagrams: what two or three overlapping sets share; never supply coordinates or sizes.",
			'Return sets: [{ id, label }] and regions: [{ sets, items?, count?, label? }]. A region\'s sets are the ids it lies in, and it excludes every other set: ["a"] is a only, ["a", "b"] is a and b but not c.',
			"Give a region items (short phrases) or a count, never both. Omit a region the source leaves empty; label names an overlap only when the source does.",
			"Copy every set and item the source states, each once and in exactly its region; invent none.",
		],
	},
	journey: {
		title: "Journey map IR rules",
		rules: [
			'Use diagram type "journey".',
			"Use it for user or customer journey maps: stages of steps, each scored for sentiment; never supply coordinates.",
			"Return stages: [{ name, steps: [{ label, score, actor?, touchpoint? }], painPoints?, opportunities? }] in the order the source gives them. score is a whole number from 1 (very negative) to 5 (very positive); 3 is neutral.",
			'actor is who acts (several who share a step: "Customer, Agent") and touchpoint is the channel (Email, Website, Phone); set the one the source states for each step. persona names whose journey it is; actors lists them when the source names several.',
			"painPoints and opportunities are short phrases under the stage the source puts them in.",
			"Copy every stage, step, score, actor, touchpoint, pain point and opportunity the source states; invent none.",
		],
	},
	sankey: {
		title: "Sankey IR rules",
		rules: [
			'Use diagram type "sankey".',
			"Use it for weighted flows between stages: budgets, traffic, funnels, energy or material flows; never supply coordinates.",
			"Return nodes: [{ id, label }] and links: [{ source, target, value, label? }]: value is the stated amount, greater than 0. Links run one way; no cycles or self-links.",
			'Optional: unit ("$k", "%", "visits"). Copy every stated node, flow and value; invent no balancing node such as Other.',
		],
	},
	wireframe: {
		title: "Wireframe IR rules",
		rules: [
			'Use diagram type "wireframe".',
			"Use it for UI wireframes, mockups and screen layouts; never supply coordinates or sizes.",
			'Return screens: [{ id, name, device: "desktop" | "tablet" | "mobile", children }]. Every component sits under a screen\'s children, in reading order.',
			"Containers hold children: header (top), footer (bottom, a save bar), sidebar (side: left or right), main, section and card (title?), modal, row, column, and grid (columns: n).",
			"Widgets: heading (text, level 1-3), text (text, or lines for placeholder copy), link, badge and button (text; variant primary or secondary), input, textarea, select and search (label?, placeholder or value), checkbox, radio and toggle (label, checked), tabs, nav and breadcrumbs (items, active), list (items), avatar, icon, image and chart (label?), table (columns: headers, rows?), divider.",
			"State: variant primary on the screen's main button, checked: true on what is on or selected, active on the selected tab or nav item, value on a field showing one.",
			"Copy every screen, component, text and state the source states, in order; invent no controls or copy.",
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
		requirements: [
			{ kind: "count", target: "events", comparator: "exact", value: 2 },
			{ kind: "label", target: "event", value: "Beta" },
		],
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
		requirements: [
			{ kind: "count", target: "categories", comparator: "exact", value: 2 },
			{ kind: "label", target: "category", value: "Q1" },
		],
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
		requirements: [
			{ kind: "count", target: "nodes", comparator: "minimum", value: 8 },
			{ kind: "label", target: "branch", value: "retry" },
		],
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
		requirements: [
			{ kind: "count", target: "topics", comparator: "minimum", value: 8 },
			{ kind: "label", target: "topic", value: "Operations" },
		],
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
		requirements: [
			{ kind: "count", target: "messages", comparator: "minimum", value: 4 },
			{ kind: "label", target: "participant", value: "Service" },
		],
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
		requirements: [
			{ kind: "count", target: "states", comparator: "minimum", value: 3 },
			{ kind: "label", target: "transition", value: "pay" },
		],
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
		requirements: [
			{ kind: "count", target: "tasks", comparator: "exact", value: 3 },
			{ kind: "label", target: "task", value: "Design" },
		],
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
		requirements: [
			{ kind: "count", target: "entities", comparator: "exact", value: 2 },
			{ kind: "label", target: "entity", value: "orders" },
		],
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
		requirements: [
			{ kind: "count", target: "classes", comparator: "exact", value: 3 },
			{ kind: "label", target: "class", value: "Circle" },
		],
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
		requirements: [
			{ kind: "count", target: "people", comparator: "exact", value: 5 },
			{ kind: "label", target: "person", value: "Alan Turing" },
		],
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
		requirements: [
			{ kind: "count", target: "items", comparator: "exact", value: 4 },
			{ kind: "label", target: "item", value: "Apple Pay" },
		],
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
		requirements: [
			{ kind: "count", target: "tasks", comparator: "exact", value: 3 },
			{ kind: "label", target: "phase", value: "Buy" },
		],
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
		requirements: [
			{ kind: "count", target: "links", comparator: "exact", value: 2 },
			{ kind: "label", target: "node", value: "Compute" },
		],
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
		requirements: [
			{ kind: "count", target: "screens", comparator: "exact", value: 1 },
			{ kind: "label", target: "component", value: "Sign in" },
		],
	},
} as const satisfies Record<DiagramTypeValue, { diagram: object; requirements: readonly object[] }>;

function expectedJsonShape(prompt: DiagramGenerationPrompt): string {
	const selectedType = prompt.requestedType;
	if (!selectedType) {
		const supportedExample = {
			title: "Release approval",
			intent: {
				requestedKind: "flowchart",
				nativeKind: "flowchart",
				requirements: [
					{
						kind: "count",
						target: "nodes",
						comparator: "minimum",
						value: 4,
					},
					{ kind: "label", target: "branch", value: "revise" },
				],
			},
			diagram: {
				id: "release-approval",
				type: "flowchart",
				nodes: [
					{ id: "start", label: "Start", kind: "start" },
					{ id: "draft", label: "Prepare release", kind: "process" },
					{ id: "review", label: "Approved?", kind: "decision" },
					{ id: "end", label: "Release approved", kind: "end" },
				],
				edges: [
					{ id: "begin", source: "start", target: "draft" },
					{ id: "submit", source: "draft", target: "review" },
					{
						id: "approve",
						source: "review",
						target: "end",
						label: "approve",
					},
					{
						id: "revise",
						source: "review",
						target: "draft",
						label: "revise",
					},
				],
				layout: { direction: "TB", edgeRouting: "orthogonal" },
			},
		};
		const unsupportedExample = {
			title: "Order service architecture",
			intent: {
				requestedKind: "architecture",
				nativeKind: null,
				requirements: [],
			},
		};
		return [
			`Supported response example: ${JSON.stringify(supportedExample)}`,
			`Unsupported response example: ${JSON.stringify(unsupportedExample)}`,
		].join("\n");
	}
	const { diagram, requirements } = FAMILY_EXAMPLES[selectedType];
	return JSON.stringify({
		title: "Concise model-authored title",
		intent: {
			requestedKind: selectedType,
			nativeKind: selectedType,
			requirements,
		},
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
	const typeAuthority = explicitType
		? `The caller explicitly requires ${explicitType}. Set both intent.requestedKind and intent.nativeKind to ${explicitType}, and return that diagram type.`
		: "The caller omitted type. Select the scenario's requested kind; generate it only when it is natively supported.";
	const user = [
		"Scenario:",
		prompt.request,
		"",
		"Type authority:",
		typeAuthority,
		"",
		"Expected JSON shape (adapt the intent plan and diagram to the scenario):",
		expectedJsonShape(prompt),
		...logoSection(prompt),
	].join("\n");

	return { system, user };
}
