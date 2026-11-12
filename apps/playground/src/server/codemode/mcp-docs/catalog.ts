import { DIAGRAM_PATCH_OPERATION_NAMES } from "@sketchi/diagram-agent";
import {
	CANVAS_ICON_ELEMENT,
	CANVAS_LIMITS,
	CHART_RULES,
	CLASS_RULES,
	DIAGRAM_NODE_COLOR_NAMES,
	ER_RULES,
	FLOWCHART_MAX_EDGES,
	FLOWCHART_MAX_ISSUES,
	FLOWCHART_MAX_NODES,
	FLOWCHART_EDIT_RULES,
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
import SKETCHI_CODE_MODE_TYPES from "./code-mode-types.generated.txt?raw";
import type { CodeModeOperation } from "./types";
import type { CodeExample, DocsResult, SearchHit } from "../mcp-docs.server";

export interface CatalogEntry {
	id: string;
	kind: SearchHit["kind"];
	title: string;
	topic: DocsResult["topic"];
	keywords: string[];
	snippet: string;
	content: string;
	examples?: CodeExample[];
}

/** Family summaries shared by the docs index and the execute code parameter. */
const BUILDERS = {
	buildFlowchart:
		"process steps and decisions, how systems or packages interact, and nested architecture zones",
	buildMindmap: "a nested topic hierarchy",
	buildSequenceDiagram: "time-ordered messages between participants",
	buildTimeline: "dated or ordered events, milestones and phases",
	buildChart: "bar, line or pie charts of numbers across categories",
	buildStateMachine: "states and the events, guards and actions that move between them",
	buildGantt: "Gantt charts of dated tasks, durations, dependencies and milestones",
	buildErDiagram: "database schemas: tables, fields, keys and relationships",
	buildClassDiagram: "UML classes, members and relationships",
	buildOrgChart: "org charts of people, titles and reporting lines",
	buildVennDiagram: "Venn diagrams of what overlapping sets share",
	buildJourneyMap: "user journey maps: stages of steps scored for sentiment",
	buildSankey: "Sankey diagrams of weighted flows between stages",
	buildWireframe: "UI wireframes and mockups: screens of components",
	buildQuadrantChart: "quadrant charts: 2×2 matrices of items placed by two measures",
	createCanvas: "hand-placed CanvasSpec, only for layouts no builder covers (illustration)",
};
const HELPERS = {
	searchIcons:
		"searchIcons({ q, limit? }) resolves to { icons: [{ slug, name, collection, match }] }: exact logo slugs for named technologies",
	drawIcon:
		"drawIcon({ name, svg }) hand-draws a logo the catalog lacks as an icon recipe, with a judge's verdict; about 15 s",
	editFlowchart:
		"editFlowchart({ artifactId, edits }) changes a built flowchart by node id or label and stores the result as a new artifact",
	getArtifact:
		'getArtifact({ artifactId, format?, inline? }) reads a stored artifact; format "document" is a flowchart\'s document',
	applyDiagramPatch:
		'applyDiagramPatch applies deterministic style, shape, text, move or structural edits to an accepted artifact other than a flowchart; docs({ topic: "applyDiagramPatch" })',
};
// Adding an operation without a summary fails typechecking, so the index cannot go stale.
const OPERATION_SUMMARIES: Record<CodeModeOperation, string> = { ...BUILDERS, ...HELPERS };
const OPERATIONS = Object.keys(OPERATION_SUMMARIES) as CodeModeOperation[];
const operationIndex = (buildersHeading: string) =>
	[
		buildersHeading,
		...Object.entries(BUILDERS).map(([operation, summary]) => `- ${operation}: ${summary}`),
		"Helpers:",
		...Object.values(HELPERS).map((summary) => `- ${summary}`),
	].join("\n");
const OPERATION_INDEX = operationIndex(
	'Builders. Before the first call, read docs({ topic: "<builder>" }) for its request type, rules and example:',
);
/**
 * The code parameter states once for the builders after buildFlowchart what each topic says for
 * its own family. Flowchart labels follow FLOWCHART_RULES instead: read as applying to every
 * builder, this rule made Sol paste prompt clauses ("If parsing succeeds", "parsed") as labels.
 */
/** The MCP docs name the text a diagram comes from "the prompt". */
const PROMPT = "the prompt";
const COPY_RULE =
	"copy every item and detail the prompt states into its spec field, keeping its words and order; invent none.";
/**
 * Claude Code cuts upfront-loaded MCP tool descriptions and server instructions at this many
 * characters (2048 before v2.1.296), but not parameter descriptions. The execute description is a
 * head that fits the older window; the code parameter carries every builder's spec and rules.
 */
export const EXECUTE_DESCRIPTION_WINDOW = 4096;
export const EXECUTE_DESCRIPTION_LEGACY_WINDOW = 2048;
/** One compact line per builder after buildFlowchart, whose rules the code parameter carries. */
const FAST_PATH = {
	buildChart: `spec: { title, kind: "bar" | "line" | "pie", categories: string[], series: [{ name?, values: number[] }], unit? ("$M", "%"), categoryAxisTitle?, valueAxisTitle?, stacked? (bar), donut? (pie), orientation? ("horizontal", bar) }. ${CHART_RULES.series} ${CHART_RULES.pieCompact}`,
	buildTimeline: `spec: { title, events: [{ id, label, date?, end?, order?, kind?: "milestone", lane? }], lanes?: string[], today? }. ${TIMELINE_RULES.compact(PROMPT)}`,
	buildSequenceDiagram: `spec: { title, participants: [{ id, label, icon?: { slug } }], messages: [{ source, target, label, type?: "return", style?: "dashed" }] }. Order is kept. ${SEQUENCE_RULES.replies(PROMPT)} ${SEQUENCE_RULES.selfStep}`,
	buildStateMachine: `spec: { title, initial: top-level start state, states: [{ id, label? (defaults to id), kind?: "final" | "choice", parent?: compositeId, initial?: substateId }], transitions: [{ source, target, event?, guard?, action? }] }. A composite (a state named as parent) sets its own initial to its first substate; composites do not nest. Each transition out of a choice has a guard, without brackets: ${STATE_MACHINE_RULES.guards(PROMPT)} ${STATE_MACHINE_RULES.endsLifecycle}`,
	buildMindmap: `spec: { title, root: { label, children?: [{ label, children? }] }, layout?: { direction: "LR" | "RL" } }. ${MINDMAP_RULES.order}`,
	buildGantt: `spec: { title, tasks: [{ id, label, start: "YYYY-MM-DD", end? (last day) | duration? (days), milestone?: true, phase?, dependsOn?: [ids finishing first], progress?: % }], phases?, today? }. ${GANTT_RULES.duration}`,
	buildErDiagram: `spec: { title, entities: [{ id, fields: ["id uuid PK", "customer_id uuid FK", "email text UK", "note text?"] }], relationships: [{ from: "orders.customer_id", to: "customers.id", fromCardinality: "zero-or-many", toCardinality: "one", label? }] }. ${ER_RULES.cardinalities}`,
	buildClassDiagram: `spec: { title, classes: [{ id, kind?: "abstract" | "interface" | "enum", attributes?: ["- id: UUID"], methods?: ["+ area(): double {abstract}"] }], relationships: [{ kind, from, to, fromMultiplicity?, toMultiplicity?, fromRole?, toRole?, navigable?, label? }] }. ${CLASS_RULES.relationships} ${CLASS_RULES.multiplicitiesCompact}`,
	buildOrgChart: `spec: { title, people: [{ id, name, title?, department?, manager?, assistant?: true }], dottedLines?: [{ report, manager, label?: stated scope }], groupByDepartment? }. ${ORG_CHART_RULES.managerCompact}`,
	buildVennDiagram: `spec: { title, sets: [{ id, label }], regions: [{ sets: [ids], items?: string[], count? }] }. ${VENN_RULES.regionsCompact}`,
	buildJourneyMap: `spec: { title, persona?, stages: [{ name, steps: [{ label, score, actor?, touchpoint? }], painPoints?, opportunities? }] }. ${JOURNEY_RULES.score}`,
	buildSankey: `spec: { title, nodes: [{ id, label }], links: [{ source, target, value, label? }], unit? ("$k", "visits") }. ${SANKEY_RULES.flows}`,
	buildWireframe: `spec: { title, screens: [{ name, device: "desktop" | "tablet" | "mobile", children }] }. Containers (children, title?): header, footer (at the bottom), sidebar, main, section, card, modal, column, row (align?: "between" | "center" | "end"), grid (columns: n). Widgets: heading (text, level?), text (text or lines), badge (text), link (text, target?: screen id), button (text, variant?, target?), input, textarea, select, search (label?, placeholder?, value?), checkbox, radio, toggle (label, checked?), tabs, nav (items, active?), breadcrumbs, list (items), avatar, icon, image, chart (label?), table (columns: string[]), divider. ${WIREFRAME_RULES.stateCompact}`,
	buildQuadrantChart: `spec: { title, xAxis: { title, low, high }, yAxis: same, quadrants: { topLeft, topRight, bottomLeft, bottomRight }, points: [{ label, x, y, group? }] }. ${QUADRANT_RULES.placementCompact}`,
} satisfies Record<Exclude<keyof typeof BUILDERS, "buildFlowchart" | "createCanvas">, string>;
/** What the code parameter names a builder for where its name alone could route a prompt wrongly. */
const CODE_HINTS: Partial<Record<keyof typeof FAST_PATH, string>> = {
	buildSequenceDiagram: "time-ordered messages",
	buildTimeline: "dated or ordered events",
	buildGantt: "project schedules",
	buildErDiagram: "database schemas",
	buildWireframe: "UI mockups",
	buildQuadrantChart: "2×2 matrices",
};
const EXECUTE_HELPERS = [
	"searchIcons({ q }) resolves to { icons: [{ slug, match }] }; drawIcon draws a logo it lacks",
	"editFlowchart({ artifactId, edits }) changes a flowchart; never rebuild or patch one",
	'getArtifact({ artifactId, format? }) reads an artifact; "document" is a flowchart\'s',
	'applyDiagramPatch edits other artifacts; docs({ topic: "applyDiagramPatch" })',
];

const OPERATION_LIST = OPERATIONS.map((operation) => `sketchi.${operation}`).join(", ");

const DECLARATIONS = new Map(
	SKETCHI_CODE_MODE_TYPES.split("\n\n").flatMap((block) => {
		const name = /^type (\w+) = /.exec(block)?.[1];
		return name ? [[name, block.trim()] as const] : [];
	}),
);

/**
 * Generated declarations for the named types and everything they reference. Depth-first order reads
 * top-down: each declaration precedes the types it references.
 */
function typesFor(...names: string[]): string {
	const included = new Map<string, string>();
	const visit = (name: string) => {
		const declaration = DECLARATIONS.get(name);
		if (!declaration) throw new Error(`Generated Code Mode types are missing ${name}.`);
		if (included.has(name)) return;
		included.set(name, declaration);
		for (const [reference] of declaration.slice(`type ${name} = `.length).matchAll(/\b[A-Z]\w*/g)) {
			if (DECLARATIONS.has(reference)) visit(reference);
		}
	};
	for (const name of names) visit(name);
	return [...included.values()].join("\n");
}

/** Reference types go after the guidance so models weigh the rules first. */
function operationTypes(operation: CodeModeOperation): string {
	const name = operation.charAt(0).toUpperCase() + operation.slice(1);
	return `Request type:\nsketchi.${operation}(input: ${name}Request)\n${typesFor(`${name}Request`)}`;
}

const DELIVERY_OPTIONS = `{ artifactFormats: ["scene", "excalidraw", "png"], inlineArtifacts: [] }`;

const FLOWCHART_COLORS = DIAGRAM_NODE_COLOR_NAMES.map((name) => `"${name}"`).join(" | ");
const FLOWCHART_SPEC = `spec: { title, direction?: "TB" | "LR", curved?: true, logos?: true | "exact", nodes: { [id]: label | { label, note?, shape?: "database" | "queue" | "document" | "storage" | "diamond", icon?: name | null, color?: ${FLOWCHART_COLORS} (only when asked), group?: id, lane?: id } }, edges: [[from, to, label?]] (ends may list ids), groups?: { [id]: { label, kind?, contains?: [ids] } }, lanes?: { [id]: label } }`;

/**
 * What a first flowchart build needs, each rule with any detail only the buildFlowchart topic
 * adds. The code parameter carries the rules; the topic carries both. The rules themselves live in
 * diagram-core, which the generation prompt and Studio chat read too; only the logo rules, which
 * name sketchi.searchIcons, are the MCP's own.
 */
const FLOWCHART_DOC_RULES: readonly (readonly [rule: string, topicDetail?: string])[] = [
	[
		"Pass { spec, request }: request is the prompt, verbatim; the build lists what it misses.",
		"Each coverage issue names a stated arrow, step or zone the accepted diagram lacks; one editFlowchart adds it.",
	],
	[FLOWCHART_RULES.separateNodes(PROMPT)],
	[FLOWCHART_RULES.statedChecks],
	[FLOWCHART_RULES.labelWords(PROMPT)],
	[FLOWCHART_RULES.labelForm],
	[FLOWCHART_RULES.labelScope(PROMPT)],
	[FLOWCHART_RULES.namedOutcomes(PROMPT)],
	[FLOWCHART_RULES.documentRoles(PROMPT)],
	[FLOWCHART_RULES.documentNoInventedSteps(PROMPT)],
	[FLOWCHART_RULES.documentBranches(PROMPT)],
	[
		FLOWCHART_RULES.documentLoops,
		"A loop with no way out fails with nonterminating_node; a retry loop that keeps an exit is valid.",
	],
	[FLOWCHART_RULES.technologyLabels],
	[FLOWCHART_RULES.documentGroups(PROMPT)],
	[FLOWCHART_RULES.documentLanes(PROMPT)],
	[
		FLOWCHART_RULES.documentLogos(PROMPT),
		"The logo is drawn above the label. An icon naming no logo is dropped with an unknown_icon warning, and a vendor's logo on a label that does not name the vendor with icon_dropped; neither fails the build.",
	],
	[
		FLOWCHART_RULES.documentDirection(PROMPT),
		`${FLOWCHART_RULES.documentCurved(PROMPT)} Curved lines follow the routes square ones take, so none runs through a node, along another line or through a label.`,
	],
	[FLOWCHART_RULES.limits, FLOWCHART_RULES.limitsDetail],
	[FLOWCHART_RULES.summarize],
	[FLOWCHART_RULES.layers],
	[FLOWCHART_RULES.keepNamed(PROMPT)],
];

/**
 * The buildFlowchart topic: the document's shape, which FLOWCHART_SPEC states for the code
 * parameter, every flowchart rule with its detail, then the request type.
 */
const FLOWCHART_DOCS = [
	"buildFlowchart accepts the flowchart document: title, nodes and edges, with optional direction, curved, logos, groups and lanes. Builds use the fixed Sketchi palette.",
	FLOWCHART_RULES.documentShape,
	...FLOWCHART_DOC_RULES.map(([rule, detail]) => (detail ? `${rule} ${detail}` : rule)),
	"",
	operationTypes("buildFlowchart"),
].join("\n");

/** What an edit needs, carried by the code parameter so an edit takes no docs turn. */
const FLOWCHART_EDIT_SPEC = `editFlowchart({ artifactId, edits }) changes a built flowchart; no read first. ${FLOWCHART_EDIT_RULES.ops}`;
const FLOWCHART_EDIT_LINES = [FLOWCHART_EDIT_RULES.refs];

/** The editFlowchart topic: the edit list, what it keeps, and the request type. */
const FLOWCHART_EDIT_DOCS = [
	FLOWCHART_EDIT_SPEC,
	...FLOWCHART_EDIT_LINES,
	"Edits apply in order. One that names an unknown id fails at its path, such as edits[1].between[0], with the nearest ids, and nothing is stored; an edited flowchart that does not build fails with the build's issues.",
	'An accepted edit returns the new artifact (provenance.sourceArtifactId names the one it changed), the full document as normalizedSpec, and the edits. getArtifact({ artifactId, format: "document" }) reads the document of any flowchart.',
	"",
	operationTypes("editFlowchart"),
].join("\n");

const LOGO_RULE =
	"When the prompt names technologies, a sequence diagram awaits sketchi.searchIcons({ q }) for each in the same script and sets participant.icon to { slug }.";

/** Fits EXECUTE_DESCRIPTION_LEGACY_WINDOW, so every Claude Code version reads all of it. */
export const EXECUTE_TOOL_DESCRIPTION = [
	"Run JavaScript against the typed sketchi client. code is one async arrow function in plain JavaScript (no TypeScript, imports or named wrappers): async () => sketchi.buildFlowchart({ spec })",
	`Builders: ${Object.keys(BUILDERS).join(", ")}. The code parameter gives each one's spec and rules, so only createCanvas needs docs({ topic: "createCanvas" }) first.`,
	"Helpers:",
	...EXECUTE_HELPERS.map((summary) => `- ${summary}`),
	`- ${LOGO_RULE}`,
	"- When a build resolves to { ok: false, issues: [{ code, message, hint }] }, fix the spec per hint and rebuild.",
	"- Return the accepted result: execute adds artifactDelivery.finalResponseText; copy it verbatim as the final answer and stop, never recreating the diagram as Markdown, Mermaid, a file or an Antigravity artifact.",
].join("\n");

/**
 * Parameter descriptions are not truncated, so every builder's spec and the rules a first build
 * needs live here. Each topic adds what a build only needs once it fails.
 */
export const EXECUTE_CODE_DESCRIPTION = [
	"Accepted builds and patches return Excalidraw and PNG URLs.",
	"",
	`buildFlowchart (${BUILDERS.buildFlowchart}): ${FLOWCHART_SPEC}.`,
	...FLOWCHART_DOC_RULES.map(([rule]) => rule),
	"",
	FLOWCHART_EDIT_SPEC,
	...FLOWCHART_EDIT_LINES,
	"",
	`Other builders: ${COPY_RULE}`,
	...Object.entries(FAST_PATH).map(([operation, line]) => {
		const hint = CODE_HINTS[operation as keyof typeof FAST_PATH];
		return `- ${operation}${hint ? ` (${hint})` : ""}: ${line}`;
	}),
	`- createCanvas: ${BUILDERS.createCanvas}.`,
	"- drawIcon({ name, svg }) hand-draws a logo; any icon takes it",
].join("\n");

const PATCH_OPERATION_SUMMARY = [
	"- setDefaultStyle: set fallback strokeColor, fillColor, textColor, or backgroundColor for the scene.",
	"- setStyle: style selected nodes, edges, labels, or scopes.",
	"- setShape: change selected node shapes to rectangle, diamond, ellipse, circle, or polygon.",
	"- translate: move selected nodes/edges/text by dx and dy; connectivity is preserved by default.",
	"- replaceText: replace selected node labels, edge labels, or text elements. Use this for label edits.",
	"- rerouteEdges: reroute selected edges after movement or shape changes.",
	"- insert/remove/replace: structurally edit elements while retaining stable ids.",
	"- reorder: move existing ids in the explicit back-to-front zOrder.",
	"- group/ungroup: add or remove stable composition group ids.",
].join("\n");

const PATCH_OPERATIONS_EXAMPLE = `[
  { op: "setDefaultStyle", style: { strokeColor: "#111827", fillColor: "#ffffff", textColor: "#111827" } },
  { op: "setStyle", selector: { nodeIds: ["gate"] }, style: { strokeColor: "#7c3aed", fillColor: "#ede9fe" } },
  { op: "setShape", selector: { nodeIds: ["gate"] }, shape: "diamond" },
  { op: "translate", selector: { nodeIds: ["gate"] }, dx: 24, dy: -12 },
  { op: "replaceText", selector: { nodeIds: ["ship"] }, text: "Ship to production" },
  { op: "rerouteEdges", selector: { scope: "edges" } },
  { op: "insert", afterId: "gate", elements: [{ type: "text", id: "note", text: "Review", x: 10, y: 10, fontSize: 18 }] },
  { op: "replace", id: "note", element: { type: "text", id: "note", text: "Approved", x: 10, y: 10, fontSize: 18 } },
  { op: "reorder", ids: ["note"], beforeId: "gate" },
  { op: "group", ids: ["gate", "note"], groupId: "approval-group" },
  { op: "ungroup", ids: ["note"], groupId: "approval-group" },
  { op: "remove", selector: { ids: ["note"] } }
]`;

const FULL_PATCH_REQUEST_EXAMPLE = `{
  source: { artifactId: built.artifact.artifactId },
  intent: "Highlight one topic and rename another",
  operations: [
    { op: "setStyle", selector: { labels: ["Product"] }, style: { strokeColor: "#7c3aed", fillColor: "#ede9fe" } },
    { op: "replaceText", selector: { labels: ["Operations"] }, text: "Launch operations" }
  ],
  options: { artifactFormats: ["scene", "excalidraw", "png"], inlineArtifacts: [], preserveConnectivity: true }
}`;

const ACCEPTANCE_LOOP_EXAMPLE = `async () => {
  const built = await sketchi.buildFlowchart({
    spec: {
      title: "Approval flow",
      nodes: { request: "Request", approved: "Approved?", done: "Done", revise: "Revise" },
      edges: [
        ["request", "approved"],
        ["approved", "done", "yes"],
        ["approved", "revise", "no"],
      ],
    },
  });

  if (!built.ok) return built;

  // A later change is an edit by id or label, never a patch over the drawing.
  return sketchi.editFlowchart({
    artifactId: built.artifact.artifactId,
    edits: [
      { op: "insert", node: { notify: "Notify requester" }, between: ["approved", "revise"] },
      { op: "set", nodes: { approved: { color: "purple" } } },
    ],
    options: ${DELIVERY_OPTIONS},
  });
}`;

const HOSTED_APP_LOGOS_EXAMPLE = `async () => sketchi.buildFlowchart({
  spec: {
    title: "Next.js page on Vercel",
    logos: true,
    nodes: {
      host: "Vercel routes the request",
      page: "Next.js page receives question",
      done: "Return answer"
    },
    edges: [["host", "page"], ["page", "done"]]
  },
  options: ${DELIVERY_OPTIONS}
})`;

const SEQUENCE_LOGOS_EXAMPLE = `async () => {
  const technologies = ["github", "cloudflare", "docker"];
  const matches = await Promise.all(technologies.map(q => sketchi.searchIcons({ q })));
  const icons = technologies.map((slug, index) => matches[index].icons.find(icon => icon.slug === slug));
  if (icons.some(icon => !icon)) return { missingLogos: true };
  return sketchi.buildSequenceDiagram({
    spec: {
      title: "Deploy webhook",
      participants: [
        { id: "developer", label: "Developer" },
        ...technologies.map((id, index) => ({ id, label: ["GitHub", "Cloudflare Worker", "Docker"][index], icon: { slug: icons[index].slug } }))
      ],
      messages: [
        { source: "developer", target: "github", label: "Push commit" },
        { source: "github", target: "cloudflare", label: "Send deploy webhook" },
        { source: "cloudflare", target: "docker", label: "Build image" },
        { source: "docker", target: "cloudflare", label: "Image digest", type: "return" },
        { source: "cloudflare", target: "github", label: "202 Accepted", type: "return" }
      ]
    },
    options: ${DELIVERY_OPTIONS}
  });
}`;

const SEQUENCE_DIAGRAM_EXAMPLE = `async () => sketchi.buildSequenceDiagram({
  spec: {
    title: "Checkout request",
    participants: [
      { id: "customer", label: "Customer" },
      { id: "store", label: "Store" },
      { id: "payments", label: "Payments" }
    ],
    messages: [
      { source: "customer", target: "store", label: "Checkout" },
      { source: "store", target: "payments", label: "Authorize payment" },
      { source: "payments", target: "store", label: "Approved", type: "return" }
    ]
  },
  options: ${DELIVERY_OPTIONS}
})`;

const CREATE_CANVAS_EXAMPLE = `async () => sketchi.createCanvas({
  spec: {
    kind: "canvas", version: 1, diagramId: "signup-form", title: "Signup form",
    width: 960, height: 560, accentColor: "#1f2937", backgroundColor: "#ffffff",
    layers: [{ id: "screens", name: "Screens" }, { id: "flow", name: "Flow" }],
    elements: [
      { type: "node", id: "form", nodeId: "form", shape: "rectangle", x: 80, y: 80, width: 220, height: 160, label: "Signup form\\nEmail\\nPassword", layerId: "screens", fillColor: "#dbeafe" },
      { type: "node", id: "verify", nodeId: "verify", shape: "rectangle", x: 380, y: 80, width: 220, height: 160, label: "Check your inbox\\nResend link", layerId: "screens", fillColor: "#dcfce7" },
      { type: "node", id: "welcome", nodeId: "welcome", shape: "rectangle", x: 680, y: 80, width: 220, height: 160, label: "Welcome\\nStart tour", layerId: "screens", fillColor: "#fef3c7" },
      { type: "arrow", id: "form-verify", edgeId: "form-verify", sourceNodeId: "form", targetNodeId: "verify", points: [{x:300,y:160},{x:380,y:160}], label: "submit", layerId: "flow" },
      { type: "arrow", id: "verify-welcome", edgeId: "verify-welcome", sourceNodeId: "verify", targetNodeId: "welcome", points: [{x:600,y:160},{x:680,y:160}], label: "open link", layerId: "flow" }
    ],
    layouts: [{ type: "row", ids: ["form", "verify", "welcome"], x: 80, y: 80, gap: 80 }],
    zOrder: ["form", "verify", "welcome", "form-verify", "verify-welcome"]
  },
  options: ${DELIVERY_OPTIONS}
})`;

const CIRCLE_TO_DIAMOND_EXAMPLE = `async () => sketchi.buildFlowchart({
  spec: {
    title: "Purple decision",
    direction: "LR",
    nodes: {
      start: "Start",
      choice: { label: "Continue?", shape: "diamond", color: "purple" },
      yes: "Continue",
      no: "Stop",
    },
    edges: [
      ["start", "choice"],
      ["choice", "yes", "yes"],
      ["choice", "no", "no"],
    ],
  },
  options: ${DELIVERY_OPTIONS},
})`;

const INVALID_FIRST_EXAMPLE = `async () => {
  const built = await sketchi.buildFlowchart({
    spec: {
      title: "Broken branch",
      nodes: { start: "Start", choice: "Ready?", done: "Done" },
      edges: [
        ["start", "choice"],
        ["choice", "done"],
        ["choice", "retry"]
      ],
    },
  });

  if (!built.ok) {
    return {
      repairNeeded: true,
      issues: built.issues.map((issue) => ({
        code: issue.code,
        hint: issue.hint,
        ref: issue.ref,
      })),
    };
  }

  return built;
}`;

const REPLACE_TEXT_EXAMPLE = `async () => {
  const built = await sketchi.buildMindmap({
    spec: {
      title: "Launch plan",
      root: { label: "Launch", children: [{ label: "Product" }, { label: "Operations" }] },
    },
  });

  if (!built.ok) return built;

  return sketchi.applyDiagramPatch({
    source: { artifactId: built.artifact.artifactId },
    intent: "Rename a topic without rebuilding the structure.",
    operations: [
      {
        op: "replaceText",
        selector: { labels: ["Operations"] },
        text: "Launch operations",
      },
    ],
    options: ${DELIVERY_OPTIONS},
  });
}`;

export const catalog: CatalogEntry[] = [
	{
		id: "overview",
		kind: "schema",
		title: "Harness-first Sketchi Code Mode surface",
		topic: "overview",
		keywords: ["overview", "harness", "codex", "claude", "opencode", "mcp"],
		snippet:
			"Use this MCP for external agent harnesses. It exposes docs, search, and execute only.",
		content: [
			"Sketchi Code Mode MCP is for external agent harnesses such as Codex, Claude Code, and OpenCode. It exposes docs, search, and execute; execute runs JavaScript against a typed sketchi client.",
			`The sketchi client has ${OPERATIONS.length} operations: ${OPERATIONS.join(", ")}.`,
			OPERATION_INDEX,
			"search({ query }) finds other topics such as patchOperations and issue repair hints.",
			"The deliverable is the accepted Sketchi artifact: paste artifactDelivery.finalResponseText, or return the artifactId, formats, and Excalidraw/PNG URLs. Do not recreate it as Markdown, Mermaid, or prose.",
			"Studio chat, HTTP, and MCP share these builder request and result contracts. Sketchi-managed threads and artifact lineage are outside this surface.",
		].join("\n"),
	},
	{
		id: "execute",
		kind: "operation",
		title: "execute",
		topic: "execute",
		keywords: ["execute", "code", "javascript", "typescript", "sandbox"],
		snippet:
			"Run an async JavaScript arrow function with the typed sketchi builders, createCanvas, artifact retrieval, and patching operations.",
		content: [
			"execute({ code }) runs one async JavaScript arrow function. Following the Code Mode pattern, typed host tools are exposed inside the sandbox as the sketchi namespace:",
			OPERATION_LIST,
			"Write JavaScript only: no TypeScript annotations, interfaces, generics, imports, or named wrapper functions. Pass the arrow function itself, for example async () => { const result = await sketchi.buildFlowchart(...); return result; }. An outer code fence and a trailing semicolon are accepted.",
			"The sandbox has no secrets, storage bindings, model credentials, or network access. Call sketchi methods sequentially when possible so failures can be inspected and retried deliberately.",
			"The response is { ok, result, logs, builds, artifactDelivery?, finalResponseText?, error? }. result is the script return value, or { buildId, ok, artifactId?, png? } when it exactly repeats a reference-only build receipt; resolve buildId in builds for the full receipt. Pre-ID failures, custom values and explicit inline exports stay unchanged. builds lists every buildFlowchart, editFlowchart, buildMindmap, buildSequenceDiagram, buildTimeline, buildChart, and createCanvas attempt in call order, even when the script returns other data, nothing, or an error. Each receipt has operation, zero-based index, ok, status, and issues, plus buildId, quality, normalizedSpec, and artifact or partial references when available; inline exports are not duplicated. Retrieval and patch calls are not builds. A build still running when the executor times out or aborts has status: incomplete and ok: false.",
			"When the script returns an accepted artifact, execute adds artifactDelivery (artifactId, format refs, raw Excalidraw/PNG URLs, and final-response instructions) and puts its finalResponseText first in the text content. Copy that text verbatim as the final chat answer and stop.",
			"For user-facing completion, return the accepted Sketchi artifactId plus Excalidraw and PNG URLs. Do not synthesize a Mermaid or Markdown replacement after Sketchi accepts an artifact. Do not call file/create/artifact tools, inspect nested inline Excalidraw JSON, or create an Antigravity artifact after that point.",
			"",
			"Generated declarations for every operation:",
			SKETCHI_CODE_MODE_TYPES,
		].join("\n"),
		examples: [
			{
				title: "Build a flowchart, then edit it by id",
				language: "js",
				code: ACCEPTANCE_LOOP_EXAMPLE,
			},
		],
	},
	{
		id: "buildFlowchart",
		kind: "operation",
		title: "buildFlowchart",
		topic: "buildFlowchart",
		keywords: [
			"build",
			"flowchart",
			"flowcharts",
			"node",
			"edge",
			"graph",
			"acceptance",
			"nonterminating",
			"cycle",
			"limit",
			"bounded",
			"24",
			"64",
			"architecture",
			"packages",
			"system",
			"request",
		],
		snippet: "Create the semantic flowchart first. Fix issues before styling or shape changes.",
		content: FLOWCHART_DOCS,
		examples: [
			{
				title: "Separate application and hosting logos",
				language: "js",
				code: HOSTED_APP_LOGOS_EXAMPLE,
			},
		],
	},
	{
		id: "searchIcons",
		kind: "operation",
		title: "searchIcons",
		// Logos are part of building flowcharts; the docs topic list is frozen.
		topic: "buildFlowchart",
		keywords: ["icon", "icons", "logo", "logos", "brand", "slug", "search"],
		snippet: "Find exact logo slugs for nodes and sequence participants before building.",
		content: [
			"searchIcons({ q, limit? }) ranks the Sketchi logo catalog by exact slug, name prefix, alias, then substring. Aliases such as k8s and psql work.",
			'It returns { ok: true, query, icons: [{ slug, name, collection }] }. limit defaults to 10 and is capped at 25. Published community icons (collection "community", slug community/…) follow the curated marks.',
			'Use a returned slug as a SequenceDiagramSpec participant icon ({ icon: { slug: "docker" } }) or a CanvasSpec node icon ({ icon: { slug: "docker", size: 28 } }). A flowchart needs no lookup: logos: true draws the logo each node label names, and a node\'s icon takes a product name or a slug.',
			"When no mark fits, const logo = await sketchi.drawIcon({ name, svg }) hand-draws one; pass logo in place of any icon (icon: logo in a flowchart, { ...logo, size } on a canvas node). It draws only in this diagram and is never published.",
			'Wordmarks answer only a query that asks for one ("Vercel wordmark") and draw only as a standalone canvas icon element, never inside a node.',
			"Search once per technology, then build. Do not invent slugs; a slug that searchIcons did not return is dropped with an unknown_icon warning.",
			"",
			operationTypes("searchIcons"),
		].join("\n"),
	},
	{
		id: "buildMindmap",
		kind: "operation",
		title: "buildMindmap",
		topic: "buildMindmap",
		keywords: ["build", "mindmap", "topic", "hierarchy", "tree", "branch"],
		snippet: "Create a mindmap from a semantic nested topic hierarchy.",
		content: [
			"buildMindmap accepts a semantic MindmapSpec with one nested root topic. Do not supply coordinates, edges, or Excalidraw JSON. Builds use the fixed Sketchi palette.",
			"The semantic-input restriction does not limit outputs: scene, Excalidraw, and PNG remain intentional output formats selected through artifact options.",
			"Children remain in caller order and receive deterministic path identifiers such as topic-0-1-0.",
			"Use nested children to express branches and depth. The public boundary supports LR or RL hierarchy layout.",
			"If buildMindmap returns ok: false, repair the hierarchy from its typed issues and retry before patching.",
			"",
			operationTypes("buildMindmap"),
		].join("\n"),
		examples: [
			{
				title: "Product launch mindmap",
				language: "js",
				code: `async () => sketchi.buildMindmap({\n  spec: {\n    title: "Product launch",\n    root: { label: "Launch", children: [\n      { label: "Product", children: [{ label: "Scope" }, { label: "Quality" }] },\n      { label: "Go to market", children: [{ label: "Docs" }, { label: "Enablement" }] }\n    ] }\n  },\n  options: ${DELIVERY_OPTIONS}\n})`,
			},
		],
	},
	{
		id: "buildTimeline",
		kind: "operation",
		title: "buildTimeline",
		topic: "buildTimeline",
		keywords: [
			"timeline",
			"chronology",
			"milestones",
			"dates",
			"events",
			"roadmap",
			"phases",
			"lanes",
		],
		snippet:
			"Create a native timeline from dated milestones, phases, or explicitly ordered events.",
		content: [
			"buildTimeline accepts { spec: { id?, title, events: [{ id, label, date?, end?, order?, kind?, lane?, description? }], lanes?, today? }, options? }. The renderer owns layout: a time-scaled axis, alternating labels and wrapped rows.",
			`${TIMELINE_RULES.precision(PROMPT)} ${TIMELINE_RULES.mode} ${TIMELINE_RULES.noInvention}`,
			`${TIMELINE_RULES.optional(PROMPT)} ${TIMELINE_RULES.ties}`,
			"Results match the other native builders, including a hosted PNG by default in execute.",
			operationTypes("buildTimeline"),
		].join("\n\n"),
		examples: [
			{
				title: "Launch phases",
				language: "js",
				code: `async () => sketchi.buildTimeline({ spec: { title: "Launch", events: [{ id: "beta", label: "Beta", date: "2026-06-01", end: "2026-07-31" }, { id: "ga", label: "GA", date: "2026-08-04", kind: "milestone" }] }, options: ${DELIVERY_OPTIONS} })`,
			},
		],
	},
	{
		id: "buildChart",
		kind: "operation",
		title: "buildChart",
		topic: "buildChart",
		keywords: [
			"chart",
			"bar",
			"line",
			"pie",
			"donut",
			"graph",
			"plot",
			"data",
			"values",
			"percent",
		],
		snippet: "Create a native bar, line or pie chart from categories and series of numbers.",
		content: [
			"buildChart accepts { spec: { id?, title, kind, categories, series: [{ name?, values }], unit?, categoryAxisTitle?, valueAxisTitle?, stacked?, donut?, orientation? }, options? }. The renderer owns layout: nice ticks, value labels, legend and pie leader lines.",
			CHART_RULES.kinds,
			`${CHART_RULES.categories} ${CHART_RULES.limits}`,
			`${CHART_RULES.copy(PROMPT)} ${CHART_RULES.noRounding} ${CHART_RULES.unit}`,
			operationTypes("buildChart"),
		].join("\n\n"),
		examples: [
			{
				title: "Grouped bars",
				language: "js",
				code: `async () => sketchi.buildChart({ spec: { title: "Quarterly revenue", kind: "bar", categories: ["Q1", "Q2"], series: [{ name: "2025", values: [42, 51] }, { name: "2026", values: [48, 57] }], unit: "$M", valueAxisTitle: "Revenue" }, options: ${DELIVERY_OPTIONS} })`,
			},
		],
	},
	{
		id: "buildGantt",
		kind: "operation",
		title: "buildGantt",
		topic: "buildGantt",
		keywords: [
			"gantt",
			"project plan",
			"schedule",
			"tasks",
			"dependencies",
			"milestones",
			"durations",
			"roadmap",
		],
		snippet:
			"Create a native Gantt chart from dated tasks, durations, dependencies and milestones.",
		content: [
			"buildGantt accepts { spec: { id?, title, tasks: [{ id, label, start, end?, duration?, milestone?, phase?, dependsOn?, progress? }], phases?, today? }, options? }. The renderer owns layout: a to-scale date axis, one row per task under phase headers, and dependency arrows.",
			`${GANTT_RULES.tasks} ${GANTT_RULES.optional(PROMPT)} ${GANTT_RULES.limits}`,
			`${GANTT_RULES.duration} ${GANTT_RULES.copy(PROMPT)} ${GANTT_RULES.conflicts}`,
			operationTypes("buildGantt"),
		].join("\n\n"),
		examples: [
			{
				title: "Release plan",
				language: "js",
				code: `async () => sketchi.buildGantt({ spec: { title: "Release plan", tasks: [{ id: "design", label: "Design", start: "2026-03-02", end: "2026-03-06" }, { id: "build", label: "Build", start: "2026-03-09", duration: 10, dependsOn: ["design"] }, { id: "launch", label: "Launch", start: "2026-03-19", milestone: true, dependsOn: ["build"] }] }, options: ${DELIVERY_OPTIONS} })`,
			},
		],
	},
	{
		id: "buildStateMachine",
		kind: "operation",
		title: "buildStateMachine",
		topic: "buildStateMachine",
		keywords: [
			"state machine",
			"state diagram",
			"states",
			"transitions",
			"lifecycle",
			"events",
			"guards",
			"statechart",
		],
		snippet: "Create a native state machine from states and the transitions between them.",
		content: [
			`buildStateMachine accepts { spec: { id?, title, initial, states: [{ id, label?, kind?, parent?, initial? }], transitions: [{ id?, source, target, event?, guard?, action? }], layout?: { direction } }, options? }. ${STATE_MACHINE_RULES.layout}`,
			[
				STATE_MACHINE_RULES.ids,
				STATE_MACHINE_RULES.label,
				STATE_MACHINE_RULES.initial,
				STATE_MACHINE_RULES.kinds(PROMPT),
				STATE_MACHINE_RULES.composite,
			].join(" "),
			`${STATE_MACHINE_RULES.transitions} ${STATE_MACHINE_RULES.reachable} ${STATE_MACHINE_RULES.endsLifecycle}`,
			operationTypes("buildStateMachine"),
		].join("\n\n"),
		examples: [
			{
				title: "Media player with a composite state",
				language: "js",
				code: `async () => sketchi.buildStateMachine({ spec: { title: "Media player", initial: "stopped", states: [{ id: "stopped", label: "Stopped" }, { id: "active", label: "Active", initial: "playing" }, { id: "playing", label: "Playing", parent: "active" }, { id: "paused", label: "Paused", parent: "active" }, { id: "ejected", kind: "final" }], transitions: [{ source: "stopped", target: "active", event: "play" }, { source: "playing", target: "paused", event: "pause" }, { source: "paused", target: "playing", event: "resume" }, { source: "playing", target: "playing", event: "seek", action: "jump" }, { source: "active", target: "stopped", event: "stop" }, { source: "stopped", target: "ejected", event: "eject", guard: "tray open" }] }, options: ${DELIVERY_OPTIONS} })`,
			},
		],
	},
	{
		id: "buildErDiagram",
		kind: "operation",
		title: "buildErDiagram",
		topic: "buildErDiagram",
		keywords: [
			"er diagram",
			"erd",
			"entity relationship",
			"database schema",
			"tables",
			"foreign key",
			"crow's foot",
			"data model",
		],
		snippet: "Create a native ER diagram from entities, their fields and keys, and relationships.",
		content: [
			"buildErDiagram accepts { spec: { id?, title, entities: [{ id, name?, fields }], relationships: [{ id?, from, to, fromCardinality, toCardinality, label? }] }, options? }. The renderer draws each entity as a table and each relationship as a crow's-foot line between the rows it joins.",
			`${ER_RULES.fields} ${ER_RULES.ids}`,
			[
				ER_RULES.direction(PROMPT),
				ER_RULES.cardinalities,
				ER_RULES.cardinalityFromKeys(PROMPT),
				ER_RULES.example,
			].join(" "),
			ER_RULES.copy(PROMPT),
			operationTypes("buildErDiagram"),
		].join("\n\n"),
		examples: [
			{
				title: "Customers and orders",
				language: "js",
				code: `async () => sketchi.buildErDiagram({ spec: { title: "Shop", entities: [{ id: "customers", fields: ["id uuid PK", "email text UK"] }, { id: "orders", fields: ["id uuid PK", "customer_id uuid FK", "shipped_at date?"] }], relationships: [{ from: "orders.customer_id", to: "customers.id", fromCardinality: "zero-or-many", toCardinality: "one", label: "places" }] }, options: ${DELIVERY_OPTIONS} })`,
			},
		],
	},
	{
		id: "buildClassDiagram",
		kind: "operation",
		title: "buildClassDiagram",
		topic: "buildClassDiagram",
		keywords: [
			"class diagram",
			"uml",
			"classes",
			"interface",
			"inheritance",
			"composition",
			"aggregation",
			"object model",
		],
		snippet: "Create a native UML class diagram from classes, their members, and relationships.",
		content: [
			"buildClassDiagram accepts { spec: { id?, title, classes: [{ id, name?, kind?, stereotype?, attributes, methods }], relationships: [{ id?, kind, from, to, fromMultiplicity?, toMultiplicity?, fromRole?, toRole?, navigable?, label? }] }, options? }. The renderer draws each class as a box of name, attributes and methods, superclasses and interfaces above the classes that extend or implement them, and each relationship with its UML line and head.",
			`${CLASS_RULES.members} ${CLASS_RULES.kinds} ${CLASS_RULES.ids}`,
			[
				CLASS_RULES.relationships,
				CLASS_RULES.multiplicities,
				CLASS_RULES.hierarchy,
				CLASS_RULES.typedFields(PROMPT),
				CLASS_RULES.onlyStated(PROMPT),
			].join(" "),
			CLASS_RULES.copy(PROMPT),
			operationTypes("buildClassDiagram"),
		].join("\n\n"),
		examples: [
			{
				title: "Shapes and a canvas",
				language: "js",
				code: `async () => sketchi.buildClassDiagram({ spec: { title: "Shapes", classes: [{ id: "Shape", kind: "abstract", attributes: ["# x: double"], methods: ["+ area(): double {abstract}"] }, { id: "Circle", attributes: ["- radius: double"], methods: ["+ area(): double"] }, { id: "Canvas", methods: ["+ add(s: Shape): void"] }], relationships: [{ kind: "inheritance", from: "Circle", to: "Shape" }, { kind: "aggregation", from: "Canvas", to: "Shape", fromMultiplicity: "1", toMultiplicity: "0..*", toRole: "shapes" }] }, options: ${DELIVERY_OPTIONS} })`,
			},
		],
	},
	{
		id: "buildQuadrantChart",
		kind: "operation",
		title: "buildQuadrantChart",
		topic: "buildQuadrantChart",
		keywords: [
			"quadrant chart",
			"2x2 matrix",
			"Eisenhower matrix",
			"effort vs impact",
			"prioritization matrix",
			"positioning map",
			"magic quadrant",
		],
		snippet:
			"Create a native quadrant chart of items placed by two measures in four named quadrants.",
		content: [
			"buildQuadrantChart accepts { spec: { id?, title, xAxis: { title, low, high }, yAxis: { title, low, high }, quadrants: { topLeft, topRight, bottomLeft, bottomRight }, points: [{ label, x, y, group? }] }, options? }. The renderer draws a square plot split into four tinted quadrants with their names in their corners, axis arrows carrying the titles and end labels, and each point as a dot at its exact position with its label beside it, or on a leader line where the plot is crowded.",
			`${QUADRANT_RULES.axisEnds(PROMPT)} ${QUADRANT_RULES.names}`,
			`${QUADRANT_RULES.points} ${QUADRANT_RULES.axes(PROMPT)}`,
			`${QUADRANT_RULES.groups(PROMPT)} ${QUADRANT_RULES.limits}`,
			QUADRANT_RULES.copy(PROMPT),
			operationTypes("buildQuadrantChart"),
		].join("\n\n"),
		examples: [
			{
				title: "Effort vs impact with scores out of 100",
				language: "js",
				code: `async () => sketchi.buildQuadrantChart({ spec: { title: "Backlog: effort vs impact", xAxis: { title: "Effort", low: "Low effort", high: "High effort" }, yAxis: { title: "Impact", low: "Low impact", high: "High impact" }, quadrants: { topLeft: "Quick wins", topRight: "Major projects", bottomLeft: "Fill-ins", bottomRight: "Thankless tasks" }, points: [{ label: "Single sign-on", x: 0.3, y: 0.85 }, { label: "Dark mode", x: 0.2, y: 0.4 }, { label: "Usage-based billing", x: 0.8, y: 0.9 }] }, options: ${DELIVERY_OPTIONS} })`,
			},
		],
	},
	{
		id: "buildOrgChart",
		kind: "operation",
		title: "buildOrgChart",
		topic: "buildOrgChart",
		keywords: [
			"org chart",
			"organization chart",
			"team structure",
			"reporting line",
			"hierarchy",
			"manager",
			"direct reports",
			"dotted line",
		],
		snippet: "Create a native org chart from people, their titles and the managers they report to.",
		content: [
			"buildOrgChart accepts { spec: { id?, title, people: [{ id, name, title?, department?, manager?, assistant?, avatar? }], dottedLines?: [{ id?, report, manager, label? }], groupByDepartment?, forest? }, options? }. The renderer draws each person as a card of name, title and department, managers above the reports their bus line feeds, long lists of reports stacked in one or two columns, and each department in a color of its own.",
			[
				ORG_CHART_RULES.manager(PROMPT),
				ORG_CHART_RULES.noCycles,
				ORG_CHART_RULES.assistant,
				ORG_CHART_RULES.avatar,
				ORG_CHART_RULES.ids,
			].join(" "),
			`${ORG_CHART_RULES.dottedLines(PROMPT)} ${ORG_CHART_RULES.groupByDepartment}`,
			ORG_CHART_RULES.copy(PROMPT),
			operationTypes("buildOrgChart"),
		].join("\n\n"),
		examples: [
			{
				title: "A startup with an assistant and a dotted line",
				language: "js",
				code: `async () => sketchi.buildOrgChart({ spec: { title: "Startup team", people: [{ id: "ceo", name: "Ada Lovelace", title: "CEO" }, { id: "ea", name: "Grace Hopper", title: "Executive Assistant", manager: "ceo", assistant: true }, { id: "cto", name: "Alan Turing", title: "CTO", department: "Engineering", manager: "ceo" }, { id: "dev", name: "Ken Thompson", title: "Engineer", department: "Engineering", manager: "cto" }, { id: "cpo", name: "Radia Perlman", title: "CPO", department: "Product", manager: "ceo" }], dottedLines: [{ report: "dev", manager: "cpo", label: "platform roadmap" }] }, options: ${DELIVERY_OPTIONS} })`,
			},
		],
	},
	{
		id: "buildVennDiagram",
		kind: "operation",
		title: "buildVennDiagram",
		topic: "buildVennDiagram",
		keywords: ["venn", "venn diagram", "overlap", "intersection", "shared", "in common", "sets"],
		snippet: "Create a native Venn diagram from two or three sets and the items in each region.",
		content: [
			"buildVennDiagram accepts { spec: { id?, title, sets: [{ id, label, color? }], regions?: [{ sets, label?, items?, count? }] }, options? }. The renderer draws two or three equal, overlapping translucent circles, each set's label outside its circle, and each region's items, one per line, centred inside exactly that region; it sizes the circles until every region's text fits.",
			`${VENN_RULES.regions} ${VENN_RULES.contents(PROMPT)} ${VENN_RULES.color}`,
			VENN_RULES.copy(PROMPT),
			operationTypes("buildVennDiagram"),
		].join("\n\n"),
		examples: [
			{
				title: "Two sets and their overlap",
				language: "js",
				code: `async () => sketchi.buildVennDiagram({ spec: { title: "iOS vs Android", sets: [{ id: "ios", label: "iOS" }, { id: "android", label: "Android" }], regions: [{ sets: ["ios"], items: ["Apple Pay"] }, { sets: ["android"], items: ["Google Pay"] }, { sets: ["ios", "android"], items: ["Push notifications", "Dark mode"] }] }, options: ${DELIVERY_OPTIONS} })`,
			},
		],
	},
	{
		id: "buildJourneyMap",
		kind: "operation",
		title: "buildJourneyMap",
		topic: "buildJourneyMap",
		keywords: [
			"journey map",
			"user journey",
			"customer journey",
			"experience map",
			"touchpoint",
			"pain point",
			"sentiment",
			"emotion curve",
		],
		snippet: "Create a native user journey map from stages of steps, each scored for sentiment.",
		content: [
			"buildJourneyMap accepts { spec: { id?, title, persona?, actors?, stages: [{ name, steps: [{ label, score, actor?, touchpoint? }], painPoints?, opportunities? }] }, options? }. The renderer draws the stages as headers across the top, each step's card under its stage, a face per step on an emotion curve over a neutral baseline, and each stage's pain points and opportunities beneath it.",
			[
				JOURNEY_RULES.stages(PROMPT),
				JOURNEY_RULES.score,
				JOURNEY_RULES.actors(PROMPT),
				JOURNEY_RULES.notes(PROMPT),
			].join(" "),
			JOURNEY_RULES.copy(PROMPT),
			operationTypes("buildJourneyMap"),
		].join("\n\n"),
		examples: [
			{
				title: "An online purchase with a pain point and an opportunity",
				language: "js",
				code: `async () => sketchi.buildJourneyMap({ spec: { title: "Online purchase", persona: "Maya, a first-time buyer", stages: [{ name: "Discover", steps: [{ label: "Sees an ad", score: 4, touchpoint: "Instagram" }] }, { name: "Buy", steps: [{ label: "Creates an account", score: 2, touchpoint: "Website" }, { label: "Pays by card", score: 3, touchpoint: "Website" }], painPoints: ["Forced account creation"], opportunities: ["Offer guest checkout"] }] }, options: ${DELIVERY_OPTIONS} })`,
			},
		],
	},
	{
		id: "buildSankey",
		kind: "operation",
		title: "buildSankey",
		topic: "buildSankey",
		keywords: [
			"sankey",
			"flow diagram",
			"budget flow",
			"funnel",
			"traffic sources",
			"energy flow",
			"drop-off",
			"alluvial",
		],
		snippet: "Create a native Sankey diagram from nodes and the weighted flows between them.",
		content: [
			"buildSankey accepts { spec: { id?, title, nodes: [{ id, label, color? }], links: [{ source, target, value, label? }], unit? }, options? }. The renderer owns layout: each node one column past the longest run of links into it, a bar as tall as the larger of its inflow and outflow with its label and total, and each link a band as wide as its value in its source's color, with its value written. A band under 3 px draws at 3 px; its value stays exact.",
			[
				SANKEY_RULES.links,
				SANKEY_RULES.optional,
				SANKEY_RULES.copy,
				SANKEY_RULES.structure,
				SANKEY_RULES.unit,
				SANKEY_RULES.dropOff(PROMPT),
			].join(" "),
			operationTypes("buildSankey"),
		].join("\n\n"),
		examples: [
			{
				title: "A cloud budget from departments to services",
				language: "js",
				code: `async () => sketchi.buildSankey({ spec: { title: "Cloud budget", unit: "$k", nodes: [{ id: "eng", label: "Engineering" }, { id: "data", label: "Data" }, { id: "compute", label: "Compute" }, { id: "storage", label: "Storage" }], links: [{ source: "eng", target: "compute", value: 310 }, { source: "eng", target: "storage", value: 45 }, { source: "data", target: "compute", value: 140 }, { source: "data", target: "storage", value: 4 }] }, options: ${DELIVERY_OPTIONS} })`,
			},
		],
	},
	{
		id: "buildWireframe",
		kind: "operation",
		title: "buildWireframe",
		topic: "buildWireframe",
		keywords: ["wireframe", "mockup", "ui", "screen", "layout", "form", "dashboard", "app", "page"],
		snippet:
			"Create a native low-fidelity wireframe: screens on a device, each a tree of components.",
		content: [
			'buildWireframe accepts { spec: { id?, title, screens: [{ id?, name, device?: "desktop" | "tablet" | "mobile", align?, children }] }, options? }. Each screen draws as a frame the size of its device. The renderer places everything: a header spans the top, a footer the bottom, a sidebar one side, a modal floats over the rest, and every other component stacks down the content area. No field takes a coordinate or size.',
			`${WIREFRAME_RULES.containers(PROMPT)} ${WIREFRAME_RULES.rows} ${WIREFRAME_RULES.sizing}`,
			`${WIREFRAME_RULES.widgets} ${WIREFRAME_RULES.nav} ${WIREFRAME_RULES.target}`,
			`${WIREFRAME_RULES.state} ${WIREFRAME_RULES.copy} ${WIREFRAME_RULES.screens}`,
			operationTypes("buildWireframe"),
		].join("\n\n"),
		examples: [
			{
				title: "A phone login screen",
				language: "js",
				code: `async () => sketchi.buildWireframe({ spec: { title: "Login", screens: [{ name: "Login", device: "mobile", children: [{ type: "heading", text: "Welcome back" }, { type: "input", label: "Email", placeholder: "you@example.com" }, { type: "input", label: "Password" }, { type: "checkbox", label: "Remember me", checked: true }, { type: "button", text: "Sign in", variant: "primary" }, { type: "link", text: "Forgot password?" }] }] }, options: ${DELIVERY_OPTIONS} })`,
			},
		],
	},
	{
		id: "buildSequenceDiagram",
		kind: "operation",
		title: "buildSequenceDiagram",
		topic: "buildSequenceDiagram",
		keywords: [
			"build",
			"sequence",
			"participant",
			"lifeline",
			"activation",
			"message",
			"chronology",
			"interaction",
		],
		snippet: "Create a native sequence diagram from ordered participants and messages.",
		content: [
			"buildSequenceDiagram accepts a semantic SequenceDiagramSpec with ordered participants and chronological messages. Builds use the fixed Sketchi palette.",
			"Use a sequence diagram when time-ordered interactions between actors or systems are the main idea. Use buildFlowchart for decisions and process paths; use buildMindmap for nested topic hierarchy.",
			SEQUENCE_RULES.order,
			SEQUENCE_RULES.activation,
			SEQUENCE_RULES.selfMessage,
			`A sequence diagram may have ${SEQUENCE_RULES.limits}; larger ones are rejected with sequence_too_large.`,
			"For every named technology participant (e.g. GitHub, Cloudflare Worker, Docker), call sketchi.searchIcons and set participant.icon to { slug } using a matching returned slug. Labels alone do not add logos, and omitted icons produce no warning. Leave human actors unbranded; a technology logo is drawn in the participant header and exported as an Excalidraw image. Unknown slugs are dropped with an unknown_icon warning, never a failed build.",
			"",
			operationTypes("buildSequenceDiagram"),
		].join("\n"),
		examples: [
			{
				title: "Deploy webhook with participant logos",
				language: "js",
				code: SEQUENCE_LOGOS_EXAMPLE,
			},
			{
				title: "Checkout sequence diagram",
				language: "js",
				code: SEQUENCE_DIAGRAM_EXAMPLE,
			},
		],
	},
	{
		id: "createCanvas",
		kind: "operation",
		title: "createCanvas",
		topic: "createCanvas",
		keywords: ["canvas", "arbitrary", "erd", "dashboard", "grid", "layers", "groups", "polygon"],
		snippet: "Hand-place a layout no builder covers (an illustration) as a versioned CanvasSpec.",
		content: [
			"Use createCanvas only for layouts no builder covers, such as illustrations. UI screens and mockups are wireframes (buildWireframe). Processes, request flows and how systems or packages interact are flowcharts (buildFlowchart); database schemas are ER diagrams (buildErDiagram); object models are class diagrams (buildClassDiagram); team structures are org charts (buildOrgChart); overlapping sets are Venn diagrams (buildVennDiagram); weighted flows are Sankey diagrams (buildSankey); 2×2 matrices are quadrant charts (buildQuadrantChart); topic hierarchies, participant interactions, chronologies and bar, line or pie charts have their own builders. createCanvas accepts CanvasSpec v1, never raw Excalidraw JSON.",
			"CanvasSpec supports bound and standalone text, rectangle/ellipse/diamond/circle/polygon shapes, lines and bound connectors with arrowheads, frames, icons, groups, layers, explicit back-to-front zOrder, and deterministic row/column/grid/stack/align/distribute layouts.",
			`An icon element ({ type: "icon", id, slug, x, y, width, height }) draws a mark in the largest square its box holds, ${CANVAS_ICON_ELEMENT.minSize}-${CANVAS_ICON_ELEMENT.maxSize} wide; it may be a wordmark (searchIcons({ q: "Vercel wordmark" })). In place of slug, an icon element or a node's icon takes a drawIcon result.`,
			"Every element needs a unique stable id. Connectors bind through shape nodeId values; line bindings and text containers use element ids.",
			"Generic validation enforces size, reference, geometry, and composition invariants. Intentional overlap is allowed.",
			"CanvasSpec does not accept SVG, HTML, scripts, data URLs, external URLs, or executable payloads. Use only the typed primitives in the contract.",
			`Limits: ${CANVAS_LIMITS.maxElements} elements (${CANVAS_LIMITS.maxExportedElements} once exported to Excalidraw, where a composed shape counts several), ${CANVAS_LIMITS.maxLayers} layers, ${CANVAS_LIMITS.maxLayouts} layout primitives, ${CANVAS_LIMITS.maxPointsPerElement} points per element, ${CANVAS_LIMITS.maxGroupsPerElement} groups per element, ${CANVAS_LIMITS.maxTextLength} characters per text element, ${CANVAS_LIMITS.maxDimension} canvas units per dimension, and ${CANVAS_LIMITS.maxSerializedBytes / 1_000_000} MB serialized input. These are ceilings, not targets: a canvas reads best well under them, and a crowded one reads better split.`,
			"Use applyDiagramPatch structural operations for iterative edits without regenerating the whole scene.",
			"The repository examples include executable dashboard/chart, wireframe, and dense 120-element cases.",
			"",
			operationTypes("createCanvas"),
		].join("\n"),
		examples: [
			{
				title: "Signup form with layers, bindings, layout, and z-order",
				language: "js",
				code: CREATE_CANVAS_EXAMPLE,
			},
		],
	},
	{
		id: "getArtifact",
		kind: "operation",
		title: "getArtifact",
		topic: "getArtifact",
		keywords: ["get", "artifact", "scene", "excalidraw", "png", "format", "inline", "raw"],
		snippet:
			"Retrieve scene, Excalidraw, or hosted PNG artifacts by artifactId after build or patch acceptance.",
		content: [
			"- Reads a stored artifact by the artifactId a build or applyDiagramPatch returned. Do not fetch an accepted artifact just to summarize it; the build result is already the deliverable.",
			"- format 'scene' is the compact Sketchi patch source; 'excalidraw' is an importable Excalidraw file JSON envelope with type, version, source, elements, appState, and files; 'png' is hosted visual proof, returned as metadata and never inline.",
			"- Hosted responses include url fields for raw artifact downloads: GET /api/v1/artifacts/{artifactId}?format=excalidraw&raw=true returns importable JSON and format=png&raw=true returns image bytes. Pass inline: true only when the harness needs scene or Excalidraw JSON in the response.",
			"- format 'document' is the flowchart document a flowchart artifact was built or edited from, returned inline; editFlowchart starts from it.",
			"- Edited and patched artifacts return provenance.sourceArtifactId; root artifacts omit provenance.",
			"",
			operationTypes("getArtifact"),
		].join("\n"),
	},
	{
		id: "editFlowchart",
		kind: "operation",
		title: "editFlowchart",
		// Edits are part of flowcharts; the docs topic list is frozen.
		topic: "buildFlowchart",
		keywords: [
			"edit",
			"change",
			"insert",
			"add",
			"remove",
			"rename",
			"color",
			"move",
			"connect",
			"disconnect",
			"flowchart",
		],
		snippet: "Change a built flowchart by node id or label; the result is a new artifact.",
		content: FLOWCHART_EDIT_DOCS,
		examples: [
			{
				title: "Insert a step, color another and remove a third",
				language: "js",
				code: `async () => sketchi.editFlowchart({ artifactId: "artifact_…", edits: [{ op: "insert", node: { fraud: "Check for fraud" }, between: ["review", "pay"] }, { op: "set", nodes: { "Seat party": { color: "green" }, wait: null } }] })`,
			},
		],
	},
	{
		id: "applyDiagramPatch",
		kind: "operation",
		title: "applyDiagramPatch",
		topic: "applyDiagramPatch",
		keywords: ["patch", "style", "shape", "selector", "color", "translate", "text", "reroute"],
		snippet: "Apply deterministic visual or structural changes to an accepted artifact.",
		content: [
			'Primary path: source: { artifactId: "<accepted artifact id>" }, a short intent, and operations.',
			`Supported operation names: ${DIAGRAM_PATCH_OPERATION_NAMES.join(", ")}.`,
			PATCH_OPERATION_SUMMARY,
			"- Selectors target nodeIds, edgeIds, labels, element ids, kinds, or broad scopes. Colors are 6-digit hex strings such as #7c3aed for strokeColor, fillColor, textColor, and backgroundColor.",
			"- For a CanvasSpec, insert, remove, replace, reorder, group, and ungroup support iterative structural editing. Stable ids are mandatory; connectivity is preserved unless options.preserveConnectivity is false.",
			"- Execute includes hosted visual proof (PNG) after an accepted patch by default; explicit artifactFormats override this.",
			"- A flowchart is not patched: applyDiagramPatch refuses it with unsupported_operation. Change it with editFlowchart.",
			"",
			operationTypes("applyDiagramPatch"),
		].join("\n"),
		examples: [
			{
				title: "Patch request envelope",
				language: "ts",
				code: FULL_PATCH_REQUEST_EXAMPLE,
			},
			{
				title: "Rename an accepted mindmap topic with replaceText",
				language: "js",
				code: REPLACE_TEXT_EXAMPLE,
			},
		],
	},
	{
		id: "patchOperations",
		kind: "schema",
		title: "Patch operation vocabulary",
		topic: "patchOperations",
		keywords: [
			"patch",
			"operation",
			"operations",
			"op",
			"enum",
			"replaceText",
			"setText",
			"setLabel",
			"rename",
			"label",
			"text",
			"style",
			"shape",
			"translate",
			"rerouteEdges",
		],
		snippet: "Allowed applyDiagramPatch operation names and the fields each operation needs.",
		content: [
			`Allowed op values: ${DIAGRAM_PATCH_OPERATION_NAMES.join(", ")}.`,
			PATCH_OPERATION_SUMMARY,
			"Use replaceText for label edits. Do not use setText, setLabel, rename, relabel, text, updateLabel, or setNodeLabel.",
			'Selection-based operations use nodeIds, edgeIds, ids, labels, kinds, or scope. Structural insert/replace/reorder/group operations use stable element ids directly. The example below shows every operation\'s fields; docs({ topic: "applyDiagramPatch" }) has the full request type.',
			"Style patches use strokeColor, fillColor, textColor, and backgroundColor.",
			"If a shape change causes arrow_overlap or text_overflow during export, retry with rerouteEdges or translate, or rebuild with more space.",
		].join("\n"),
		examples: [
			{
				title: "Every supported patch operation",
				language: "json",
				code: PATCH_OPERATIONS_EXAMPLE,
			},
			{
				title: "Rename an accepted mindmap topic with replaceText",
				language: "js",
				code: REPLACE_TEXT_EXAMPLE,
			},
		],
	},
	{
		id: "agentSequence",
		kind: "example",
		title: "Agent sequence",
		topic: "agentSequence",
		keywords: ["sequence", "repair", "retry", "loop", "style after graph"],
		snippet: "Build once with the styles the request states; change a flowchart with edits.",
		content: [
			'A flowchart states its colors and shapes in the build (\'a purple decision diamond\' is { label, shape: "diamond", color: "purple" }); other families get them by patch after the build:',
			"1. Choose buildFlowchart for a process graph, buildMindmap for a nested topic hierarchy, buildSequenceDiagram for chronological participant interactions, buildTimeline for milestones and event chronologies, buildChart for numbers compared across categories, or createCanvas only for layouts no builder covers.",
			"2. Inspect issues. If the build is not accepted, repair the spec and call the same build operation again.",
			"3. Once accepted, change a flowchart with editFlowchart (applyDiagramPatch refuses flowcharts); for other artifacts, use applyDiagramPatch for circle, diamond, color, movement, rerouteEdges, or replaceText tweaks.",
			"4. Return the accepted build or patch; do not fetch the scene just to summarize it. Paste artifactDelivery.finalResponseText when present, otherwise the artifactId and Excalidraw/PNG URLs. Do not create a second Markdown, Mermaid, local file, or Antigravity artifact.",
			"For broad architecture prompts, keep the first build small and readable: one start, a mostly monotonic spine, a few decision or branch points, and separate terminal nodes for separate outcomes.",
		].join("\n"),
		examples: [
			{
				title: "A purple decision diamond in one build",
				language: "js",
				code: CIRCLE_TO_DIAMOND_EXAMPLE,
			},
		],
	},
	{
		id: "issues",
		kind: "issue",
		title: "Issue repair hints",
		topic: "issues",
		keywords: [
			"issues",
			"error",
			"repair",
			"invalid",
			"missing",
			"decision",
			"quality",
			"nonterminating_node",
			"flowchart_too_large",
			"request_too_large",
			"cycle",
			"bounded",
			"limit",
		],
		snippet:
			"Structured issues include code, stage, ref, message, and hint. Repair from those fields.",
		content: [
			"Rejected operations return structured issues with code, severity, stage, ref, message, and hint. Repair from the hint and ref, then retry.",
			"- input: the request shape is wrong; fix the referenced path.",
			"- flowchart: node ids, edges, starts, ends, or decision branches are invalid.",
			`- flowchart_too_large: the graph exceeds ${FLOWCHART_MAX_NODES} nodes or ${FLOWCHART_MAX_EDGES} edges.`,
			"- nonterminating_node: a reachable node cannot reach any end. Add an eventual exit; bounded retry loops with an exit are valid.",
			"- request_too_large: a Studio HTTP build request exceeded 256 KiB and was rejected with 413 before render or persistence.",
			`- Flowchart semantic issue arrays are capped deterministically at ${FLOWCHART_MAX_ISSUES} entries.`,
			"- mindmap: the topic hierarchy exceeds structural limits or is not a valid rooted tree.",
			"- quality: the diagram is valid but too weak or generic; improve labels and branching.",
			"- unknown_patch_target: the patch selector does not match the accepted artifact.",
			"- unsupported_patch_operation on operations.[n].op: use an allowed op from patchOperations or the issue hint.",
			"",
			typesFor("Issue"),
		].join("\n"),
		examples: [
			{
				title: "Return compact repair hints",
				language: "js",
				code: INVALID_FIRST_EXAMPLE,
			},
		],
	},
	{
		id: "examples",
		kind: "example",
		title: "Executable examples",
		topic: "examples",
		keywords: ["examples", "sample", "canvas", "erd", "dashboard"],
		snippet:
			"Runnable examples for accepted graph, patch, artifact retrieval, and repair feedback.",
		content: "Use these examples as starting points for harness-generated execute code.",
		examples: [
			{
				title: "Build a flowchart, then edit it by id",
				language: "js",
				code: ACCEPTANCE_LOOP_EXAMPLE,
			},
			{
				title: "A purple decision diamond in one build",
				language: "js",
				code: CIRCLE_TO_DIAMOND_EXAMPLE,
			},
			{
				title: "Invalid graph returns repair hints",
				language: "js",
				code: INVALID_FIRST_EXAMPLE,
			},
			{
				title: "Rename an accepted mindmap topic with replaceText",
				language: "js",
				code: REPLACE_TEXT_EXAMPLE,
			},
			{
				title: "Checkout sequence diagram",
				language: "js",
				code: SEQUENCE_DIAGRAM_EXAMPLE,
			},
			{
				title: "Signup form through createCanvas",
				language: "js",
				code: CREATE_CANVAS_EXAMPLE,
			},
		],
	},
	{
		id: "no-mermaid-wrapper-non-goal",
		kind: "non_goal",
		title: "Do not replace accepted Sketchi artifacts with Mermaid",
		topic: "overview",
		keywords: ["non-goal", "mermaid", "markdown", "artifact", "final"],
		snippet:
			"When Sketchi accepts an artifact, the final result is that artifact bundle, not a recreated Markdown diagram.",
		content:
			"Do not create a Markdown, Mermaid, local file, Antigravity artifact, or prose-only artifact after buildFlowchart, buildMindmap, buildSequenceDiagram, buildTimeline, buildChart, createCanvas, or applyDiagramPatch succeeds. Do not call getArtifact for scene just to make a local summary. Paste execute.artifactDelivery.finalResponseText when present, or return the Sketchi artifactId, available formats, and raw Excalidraw/PNG URLs so the caller can open the actual generated artifact.",
	},
	{
		id: "raw-excalidraw-non-goal",
		kind: "non_goal",
		title: "Do not edit raw Excalidraw JSON as the primary path",
		topic: "overview",
		keywords: ["non-goal", "excalidraw", "raw", "json", "structural"],
		snippet:
			"Native Excalidraw is an output format. Prefer a semantic flowchart document, MindmapSpec, SequenceDiagramSpec, TimelineSpec, or ChartSpec input.",
		content:
			"Do not use native Excalidraw JSON as build input. Use the flowchart document, nested MindmapSpec, SequenceDiagramSpec, TimelineSpec, ChartSpec, or the renderer-independent CanvasSpec v1; scene and Excalidraw remain intentional output formats; editFlowchart changes a flowchart and applyDiagramPatch any other diagram.",
	},
	{
		id: "managed-thread-non-goal",
		kind: "non_goal",
		title: "Managed threads are deferred",
		topic: "overview",
		keywords: ["non-goal", "threads", "managed", "lineage", "history"],
		snippet:
			"Sketchi-managed threads, message history, artifact lineage, and accepted artifact state are not in this harness surface.",
		content:
			"This MCP is for caller-owned harness state. It does not create Sketchi-managed threads, continue conversations, accept artifacts, list user artifacts, or own version history.",
	},
];
