import { DIAGRAM_PATCH_OPERATION_NAMES } from "@sketchi/diagram-agent";
import {
	FLOWCHART_MAX_EDGES,
	FLOWCHART_MAX_ISSUES,
	FLOWCHART_MAX_NODES,
	SEQUENCE_MAX_MESSAGES,
	SEQUENCE_MAX_PARTICIPANTS,
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
		"process steps and decisions, including how systems or packages interact along a request or data flow, and nested architecture zones",
	buildMindmap: "a nested topic hierarchy",
	buildSequenceDiagram: "time-ordered messages between participants",
	buildTimeline: "dated or ordered events, milestones and phases",
	buildChart: "bar, line or pie charts of numbers across categories",
	buildStateMachine: "states and the events, guards and actions that move between them",
	buildGantt: "Gantt charts of dated tasks, durations, dependencies and milestones",
	buildErDiagram: "database schemas: tables, fields, keys and relationships",
	buildClassDiagram: "UML classes, members and relationships",
	buildOrgChart: "org charts of people, titles and reporting lines",
	createCanvas: "hand-placed CanvasSpec, only for layouts no builder covers (dashboard, wireframe)",
};
const HELPERS = {
	searchIcons:
		"searchIcons({ q, limit? }) resolves to { icons: [{ slug, name, collection, match, attach }] }: exact logo slugs for named technologies",
	getArtifact: "getArtifact({ artifactId, format?, inline? }) reads a stored artifact",
	applyDiagramPatch:
		'applyDiagramPatch applies deterministic style, shape, text, move or structural edits to an accepted artifact; docs({ topic: "applyDiagramPatch" })',
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
/** Shared by the buildChart topic and the compact buildChart line in the execute description. */
const CHART_SERIES_RULE =
	"Give every series exactly one value per category, in category order, and name every series when there are several.";
/** Shared by the buildStateMachine topic and its compact line in the execute description. */
const STATE_MACHINE_END_RULE =
	"A state that ends the machine but has other outgoing transitions also gets a transition to a final state.";
/** Shared by the buildGantt topic and its compact line in the execute description. */
const GANTT_DATE_RULE =
	"Pass a stated duration as duration, not a computed end. Copy every task, date, dependency, milestone and phase from the prompt; invent none.";

/** Shared by the buildErDiagram topic and its compact line in the execute description. */
const ER_CARDINALITY_RULE =
	'Cardinalities: "one", "zero-or-one", "many", "one-or-many", "zero-or-many", each how many rows of its end match one row of the other.';
/** Shared by the buildClassDiagram topic and its compact line in the execute description. */
const CLASS_KIND_RULE =
	'kind "inheritance" or "realization": from extends or implements to; "composition" or "aggregation": from is the whole; "association"; "dependency": from uses to. Multiplicities ("1", "0..*") and roles go on compositions, aggregations and associations only.';
/** Shared by the buildOrgChart topic and its compact line in the execute description. */
const ORG_CHART_RULE =
	"manager is the id they report to; only the top person has none (forest: true for several).";
const CHART_COPY_RULE =
	"Copy every number, category, series name, unit and axis title from the prompt; invent none.";
/**
 * Claude Code cuts upfront-loaded MCP tool descriptions and server instructions at this many
 * characters (2048 before v2.1.296), but not parameter descriptions. The execute description is a
 * head that fits the older window; the code parameter carries every builder's spec and rules.
 */
export const EXECUTE_DESCRIPTION_WINDOW = 4096;
export const EXECUTE_DESCRIPTION_LEGACY_WINDOW = 2048;
/** One compact line per builder after buildFlowchart, whose full topic the code parameter carries. */
const FAST_PATH = {
	buildChart: `spec: { title, kind: "bar" | "line" | "pie", categories: string[], series: [{ name?, values: number[] }], unit? ("$M", "%"), categoryAxisTitle?, valueAxisTitle?, stacked? (bar), donut? (pie), orientation? ("horizontal", bar) }. ${CHART_SERIES_RULE} A pie has one series of non-negative values, at most 8 slices and no axis titles. ${CHART_COPY_RULE}`,
	buildTimeline: `spec: { title, events: [{ id, label, date?, end?, order?, kind?: "milestone", lane? }], lanes?: string[], today? }. Dates keep the prompt's precision (YYYY, YYYY-MM, YYYY-MM-DD or ISO time); without dates, give every event a numeric order. end draws a phase, lane a labeled track; today only when given. Invent no events or dates.`,
	buildSequenceDiagram: `spec: { title, participants: [{ id, label, icon?: { slug } }], messages: [{ source, target, label, type?: "return", style?: "dashed" }] }. Order is kept. Every reply the prompt states, including a redirect back to the caller, is its own type: "return" message from the callee back to its caller; it answers the latest open call between them, and calls nobody answers draw no bar. A participant's own step (validating, retrying) is a self-message with source = target.`,
	buildStateMachine: `spec: { title, initial, states: [{ id, label?, kind?: "final" | "choice", parent?: compositeId, initial?: substateId }], transitions: [{ source, target, event?, guard?, action? }] }. A regular state label defaults to its id verbatim. spec.initial is the top-level start state. A state named as parent is a composite: set initial on the composite itself to its first substate id; composites do not nest. Every outgoing transition of a choice has a guard, without brackets; one may be "else". kind "final" (label optional) ends the machine and nothing leaves it. ${STATE_MACHINE_END_RULE}`,
	buildMindmap: `spec: { title, root: { label, children?: [{ label, children? }] }, layout?: { direction: "LR" | "RL" } }. Children keep their order.`,
	buildGantt: `spec: { title, tasks: [{ id, label, start: "YYYY-MM-DD", end? (last day) | duration? (days), milestone?: true, phase?, dependsOn?: [ids finishing first], progress?: % }], phases?, today? }. ${GANTT_DATE_RULE}`,
	buildErDiagram: `spec: { title, entities: [{ id, fields: ["id uuid PK", "customer_id uuid FK", "email text UK", "note text?"] }], relationships: [{ from: "orders.customer_id", to: "customers.id", fromCardinality: "zero-or-many", toCardinality: "one", label? }] }. ${ER_CARDINALITY_RULE} Copy every table, field, type, key and cardinality stated.`,
	buildClassDiagram: `spec: { title, classes: [{ id, kind?: "abstract" | "interface" | "enum", attributes?: ["- id: UUID"], methods?: ["+ area(): double {abstract}"] }], relationships: [{ kind, from, to, fromMultiplicity?, toMultiplicity?, fromRole?, toRole?, navigable?, label? }] }. ${CLASS_KIND_RULE} Copy every class, member and relationship stated.`,
	buildOrgChart: `spec: { title, people: [{ id, name, title?, department?, manager?, assistant?: true }], dottedLines?: [{ report, manager, label?: stated scope }], groupByDepartment? }. ${ORG_CHART_RULE} Copy every person, title, department and line stated.`,
} satisfies Record<Exclude<keyof typeof BUILDERS, "buildFlowchart" | "createCanvas">, string>;
const EXECUTE_HELPERS = [
	HELPERS.searchIcons,
	HELPERS.getArtifact,
	'applyDiagramPatch edits an accepted artifact; docs({ topic: "applyDiagramPatch" })',
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

/** The buildFlowchart topic, also carried verbatim by the execute code parameter. */
const FLOWCHART_DOCS = [
	"buildFlowchart accepts a compact FlowchartSpec: title, nodes, edges, and optional layout. Builds use the fixed Sketchi palette.",
	"Keep every requested step and decision in a separate node, preserving the prompt's step wording and order. Use plain step labels; do not merge a destination with its next action or replace a named step with a paraphrase.",
	'A stated check or verification ("verify the signature", "stock is checked") is its own process node before the decision that reads its result; "check whether X" alone is just that decision.',
	"Label steps and decisions with the prompt's own words, including how it phrases each decision, and keep every decision it states as a decision node. Only when two labels would be identical, add the distinguishing words the prompt itself uses.",
	"Use one node per outcome the prompt names: point every branch that reaches the same named outcome at that one node, and do not add end nodes the prompt does not name.",
	'Do not add decisions, loops, steps, or edges the prompt does not state; a step that handles "any errors" or acts "if needed" stays one step in sequence. A step that repeats an earlier step ("send another ...", "try again", "retry", "resubmit") continues that cycle: draw it as the earlier step or as a step that loops back to the decision after it, never as an end. Only a new, unrepeated final step with no stated next step is that branch\'s end node (kind: "end").',
	"Use stable node ids. Decision nodes need meaningful labeled outgoing branches, usually yes/no.",
	"Name technologies in node labels; a description draws as a small subtitle under the label, for detail.",
	`Only when the prompt groups steps (teams, zones, phases), declare groups: [{ id, label }] and set each member's group to its innermost group id; others stay ungrouped. Nested zones set parent (subnet in VPC) and kind. Set shape, even on a start or end: "database" databases; "document" files, archives, reports; "queue" queues, streams, topics; "storage" buckets, object stores. Only users stay ellipses. An architecture starts at its entry and ends at each sink.`,
	"For swimlanes, a process across actors or roles, declare lanes: [{ id, label }] in the prompt's order and set each node's lane to its actor; lanes take no groups.",
	'Brand logos: when a node is about a named technology (GitHub, Docker, Postgres), call sketchi.searchIcons({ q: "docker" }) and set that node\'s icon to { slug } from a result marked attach: true. The logo is drawn above the label. Never guess a slug: unknown slugs are dropped with an unknown_icon warning, and logos that cannot be drawn are dropped with icon_dropped. Neither fails the build.',
	`Logo guidance applies only to technologies named in the prompt. Search with the intended node label; attach results marked attach: true to the node you searched for. Each node holds one icon. For X on Y, preserve both technologies as separate meaningful steps and attach each logo to its own node. Do not hide the host only in the title or combine both brands under one icon. Keep the requested step order and stay within graph limits.`,
	"Before building, compare the named technologies with the icons assigned to nodes. A label or successful search alone does not attach a logo; omitted icons produce no warning. If no matching logo exists, keep the technology label and report the unavailable logo instead of substituting another brand.",
	`Flowcharts are bounded to ${FLOWCHART_MAX_NODES} nodes and ${FLOWCHART_MAX_EDGES} edges. Larger graphs fail with flowchart_too_large before render or persistence.`,
	"Every node must be reachable from the single start, and every reachable node must be able to reach an end. Closed cycles fail with nonterminating_node; retry loops remain valid when they retain an eventual exit to an end.",
	"For broad or vague repo/system architecture prompts, summarize into 8-14 high-signal nodes. Prefer a single readable spine with short side branches over a dense dependency graph with one node per package or many crossing links.",
	"When a prompt asks how packages or systems interact, group related packages into layers and show the main flow of responsibility. Use labels/descriptions for detail instead of adding every possible transitive edge.",
	"Keep every package and component the prompt names under its own name; summarizing drops unnamed detail and never renames or generalizes named parts.",
	"",
	operationTypes("buildFlowchart"),
].join("\n");

const LOGO_RULE =
	"When the prompt names technologies, search each node or sequence participant label with sketchi.searchIcons({ q }); set node.icon or sequence participant.icon to { slug } from a result marked attach: true. One icon per node, so 'X on Y' is two steps; labels alone add no logo.";

/** Fits EXECUTE_DESCRIPTION_LEGACY_WINDOW, so every Claude Code version reads all of it. */
export const EXECUTE_TOOL_DESCRIPTION = [
	"Run JavaScript against the typed sketchi client. code is one async arrow function in plain JavaScript (no TypeScript, imports or named wrappers): async () => sketchi.buildFlowchart({ spec })",
	`Builders: ${Object.keys(BUILDERS).join(", ")}. The code parameter gives each one's spec and rules, so only createCanvas needs docs({ topic: "createCanvas" }) first.`,
	"Use buildFlowchart for system/package interactions. createCanvas is a last resort for layouts no builder covers.",
	"Helpers:",
	...EXECUTE_HELPERS.map((summary) => `- ${summary}`),
	`- ${LOGO_RULE}`,
	"- Builds resolve to { ok: true, artifact, normalizedSpec, issues } or { ok: false, issues: [{ code, message, hint }] }; on ok: false, fix the spec from each hint and build again.",
	"- Return the accepted result: execute adds artifactDelivery.finalResponseText; copy it verbatim as the final answer and stop, never recreating the diagram as Markdown, Mermaid, a file or an Antigravity artifact.",
].join("\n");

/** Parameter descriptions are not truncated, so the fast path and the full flowchart topic live here. */
export const EXECUTE_CODE_DESCRIPTION = [
	"One async arrow function: sketchi.<builder>({ spec }). Excalidraw and PNG URLs are default for accepted builds and patches.",
	"",
	"Builders:",
	...Object.entries(BUILDERS).map(([operation, summary]) => `- ${operation}: ${summary}`),
	"",
	"buildFlowchart:",
	FLOWCHART_DOCS,
	"",
	"Other builders:",
	...Object.entries(FAST_PATH).map(([operation, line]) => `- ${operation}: ${line}`),
	"",
	"- Run logo searches and the build in one execute script: await the searches, then set each icon from an attach: true result.",
	'- structuredContent.builds records every build attempt in call order, whatever the script returns. docs({ topic: "execute" }) has every generated declaration, including results.',
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
  intent: "Highlight the gate and rename the release step",
  operations: [
    { op: "setStyle", selector: { nodeIds: ["gate"] }, style: { strokeColor: "#7c3aed", fillColor: "#ede9fe" } },
    { op: "replaceText", selector: { nodeIds: ["ship"] }, text: "Ship to production" }
  ],
  options: { artifactFormats: ["scene", "excalidraw", "png"], inlineArtifacts: [], preserveConnectivity: true }
}`;

const ACCEPTANCE_LOOP_EXAMPLE = `async () => {
  const built = await sketchi.buildFlowchart({
    spec: {
      title: "Approval flow",
      nodes: [
        { id: "request", label: "Request", kind: "start" },
        { id: "approved", label: "Approved?", kind: "decision" },
        { id: "done", label: "Done", kind: "end" },
        { id: "revise", label: "Revise", kind: "end" },
      ],
      edges: [
        { source: "request", target: "approved" },
        { source: "approved", target: "done", label: "yes" },
        { source: "approved", target: "revise", label: "no" },
      ],
    },
  });

  if (!built.ok) return built;

  return sketchi.applyDiagramPatch({
    source: { artifactId: built.artifact.artifactId },
    intent: "Make the decision node a purple diamond after the graph is accepted.",
    operations: [
      {
        op: "setStyle",
        selector: { nodeIds: ["approved"] },
        style: { strokeColor: "#7c3aed", fillColor: "#ede9fe" },
      },
      {
        op: "setShape",
        selector: { nodeIds: ["approved"] },
        shape: "diamond",
      },
    ],
    options: ${DELIVERY_OPTIONS},
  });
}`;

const HOSTED_APP_LOGOS_EXAMPLE = `async () => {
  const [nextjs, vercel] = await Promise.all([
    sketchi.searchIcons({ q: "nextjs" }),
    sketchi.searchIcons({ q: "vercel" })
  ]);
  const nextIcon = nextjs.icons.find(icon => icon.slug === "nextjs");
  const hostIcon = vercel.icons.find(icon => icon.slug === "vercel");
  if (!nextIcon || !hostIcon) return { missingLogos: true };
  return sketchi.buildFlowchart({
    spec: {
      title: "Next.js page on Vercel",
      nodes: [
        { id: "host", label: "Vercel routes the request", kind: "start", icon: { slug: hostIcon.slug } },
        { id: "page", label: "Next.js page receives question", kind: "process", icon: { slug: nextIcon.slug } },
        { id: "done", label: "Return answer", kind: "end" }
      ],
      edges: [{ source: "host", target: "page" }, { source: "page", target: "done" }]
    },
    options: ${DELIVERY_OPTIONS}
  });
}`;

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
    kind: "canvas", version: 1, diagramId: "signup-wireframe", title: "Signup wireframe",
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

const CIRCLE_TO_DIAMOND_EXAMPLE = `async () => {
  const built = await sketchi.buildFlowchart({
    spec: {
      title: "Circle to decision",
      nodes: [
        { id: "circle", label: "Start", kind: "start" },
        { id: "choice", label: "Continue?", kind: "decision" },
        { id: "yes", label: "Continue", kind: "end" },
        { id: "no", label: "Stop", kind: "end" },
      ],
      edges: [
        { source: "circle", target: "choice" },
        { source: "choice", target: "yes", label: "yes" },
        { source: "choice", target: "no", label: "no" },
      ],
      layout: { direction: "LR" },
    },
  });

  if (!built.ok) return built;

  return sketchi.applyDiagramPatch({
    source: { artifactId: built.artifact.artifactId },
    operations: [
      { op: "setShape", selector: { nodeIds: ["circle"] }, shape: "circle" },
      { op: "setShape", selector: { nodeIds: ["choice"] }, shape: "diamond" },
      {
        op: "setStyle",
        selector: { nodeIds: ["choice"] },
        style: { strokeColor: "#7c3aed", fillColor: "#ede9fe" },
      },
    ],
    options: ${DELIVERY_OPTIONS},
  });
}`;

const INVALID_FIRST_EXAMPLE = `async () => {
  const built = await sketchi.buildFlowchart({
    spec: {
      title: "Broken branch",
      nodes: [
        { id: "start", label: "Start", kind: "start" },
        { id: "choice", label: "Ready?", kind: "decision" },
        { id: "done", label: "Done", kind: "end" },
      ],
      edges: [
        { source: "start", target: "choice" },
        { source: "choice", target: "done" }
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
  const built = await sketchi.buildFlowchart({
    spec: {
      title: "Release gate",
      nodes: [
        { id: "start", label: "Start", kind: "start" },
        { id: "gate", label: "Approved?", kind: "decision" },
        { id: "ship", label: "Ship", kind: "end" },
        { id: "revise", label: "Revise", kind: "end" },
      ],
      edges: [
        { source: "start", target: "gate" },
        { source: "gate", target: "ship", label: "yes" },
        { source: "gate", target: "revise", label: "no" },
      ],
    },
  });

  if (!built.ok) return built;

  return sketchi.applyDiagramPatch({
    source: { artifactId: built.artifact.artifactId },
    intent: "Rename the final state without rebuilding structure.",
    operations: [
      {
        op: "replaceText",
        selector: { nodeIds: ["ship"] },
        text: "Ship to production",
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
			"The response is { ok, result, logs, builds, artifactDelivery?, finalResponseText?, error? }. result is the script return value, or { buildId, ok, artifactId?, png? } when it exactly repeats a reference-only build receipt; resolve buildId in builds for the full receipt. Pre-ID failures, custom values and explicit inline exports stay unchanged. builds lists every buildFlowchart, buildMindmap, buildSequenceDiagram, buildTimeline, buildChart, and createCanvas attempt in call order, even when the script returns other data, nothing, or an error. Each receipt has operation, zero-based index, ok, status, and issues, plus buildId, quality, normalizedSpec, and artifact or partial references when available; inline exports are not duplicated. Retrieval and patch calls are not builds. A build still running when the executor times out or aborts has status: incomplete and ok: false.",
			"When the script returns an accepted artifact, execute adds artifactDelivery (artifactId, format refs, raw Excalidraw/PNG URLs, and final-response instructions) and puts its finalResponseText first in the text content. Copy that text verbatim as the final chat answer and stop.",
			"For user-facing completion, return the accepted Sketchi artifactId plus Excalidraw and PNG URLs. Do not synthesize a Mermaid or Markdown replacement after Sketchi accepts an artifact. Do not call file/create/artifact tools, inspect nested inline Excalidraw JSON, or create an Antigravity artifact after that point.",
			"",
			"Generated declarations for every operation:",
			SKETCHI_CODE_MODE_TYPES,
		].join("\n"),
		examples: [
			{
				title: "Accepted graph followed by visual patch",
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
			"It returns { ok: true, query, icons: [{ slug, name, collection, match, attach }] }. Attach results marked attach: true to the node you searched for. limit defaults to 10 and is capped at 25.",
			'Use a returned slug as a FlowchartSpec node icon ({ icon: { slug: "docker" } }), a SequenceDiagramSpec participant icon ({ icon: { slug: "docker" } }), or a CanvasSpec node icon ({ icon: { slug: "docker", size: 28 } }).',
			"Only compact brand marks are searchable: wordmarks and very large SVGs are excluded because they cannot be drawn inside a node.",
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
			"Use dates for every event, or numeric order for every event without dates. Keep source precision: YYYY, YYYY-MM, YYYY-MM-DD, or YYYY-MM-DDTHH:mm[:ss] with Z or ±HH:MM. Never invent events or dates.",
			'Optional: end (inclusive, dated only) draws a phase; kind: "milestone" draws a diamond; lane puts every event on a labeled track (lanes sets order, max 6); today draws a Today marker only when supplied. No dependencies.',
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
			'kind "bar" compares categories (stacked: true stacks the series; long names turn bars horizontal, or set orientation), "line" shows change across ordered categories, "pie" splits one whole (donut: true for a ring).',
			`${CHART_SERIES_RULE} A pie has one series of non-negative values and at most 8 slices; bars and lines take negatives, up to 40 categories and 6 series.`,
			`${CHART_COPY_RULE} unit labels ticks and values: currency symbols lead ("$", "$M"), others follow ("%", "ms", "k").`,
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
			"start and end are YYYY-MM-DD; end is the last day, inclusive. Give end or duration (calendar days counting start), not both. milestone: true draws a diamond on start. dependsOn lists finish-to-start predecessor ids, without cycles. Give every task a phase or none (phases sets their order). progress is percent done; today only when stated. Up to 60 tasks and 12 phases.",
			`${GANTT_DATE_RULE} A task that starts before a predecessor finishes still builds, with a gantt_schedule_conflict warning.`,
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
			"buildStateMachine accepts { spec: { id?, title, initial, states: [{ id, label?, kind?, parent?, initial? }], transitions: [{ id?, source, target, event?, guard?, action? }], layout?: { direction } }, options? }. Omit layout to let the renderer pick LR or TB.",
			'A regular state label defaults to its id verbatim; an explicit blank label is invalid. initial is the top-level state the machine starts in. kind "final" ends the machine: name it when it is a named outcome (for example Failed); generic ends need no name; kind "choice" is a diamond whose outgoing transitions each carry a guard; one may be "else". States other states name as parent form a composite, drawn as a frame around them: give it initial, its first substate. Composites do not nest.',
			`A transition is drawn event [guard] / action; write the guard without brackets. It may leave or enter a composite, or return to its own state. Every state must be reachable from initial, and final states have no outgoing transitions. ${STATE_MACHINE_END_RULE}`,
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
			'A field is one string "name type markers", type optional: "id uuid PK", "order_id uuid PK FK", "email text UK", "note text?" (nullable). Entity ids hold no dot or space; name defaults to the id.',
			`from and to name "entity.field", the foreign key at one end and the key it references at the other, or an entity alone. ${ER_CARDINALITY_RULE} An order has one customer and a customer zero or many orders: from "orders.customer_id", fromCardinality "zero-or-many", to "customers.id", toCardinality "one".`,
			"Copy every table, field, type, key, nullable marker and cardinality the prompt states; invent none.",
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
			'A member is one string as UML writes it: attributes "- radius: double", "+ count: int {static}"; methods "+ area(): double", "+ draw(ctx: Canvas): void {abstract}". Visibility is +, -, # or ~. kind is "abstract", "interface" or "enum" (its values are attributes), or omitted for a class. Class ids hold no colon or space; name defaults to the id.',
			`${CLASS_KIND_RULE} navigable: true puts an open arrow at to. A composition's whole is "1" or "0..1". Interfaces extend only interfaces, classes implement them, and no inheritance cycles.`,
			"Copy every class, member, relationship, multiplicity and role the prompt states; invent none.",
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
			`${ORG_CHART_RULE} No reporting line may cycle. assistant: true draws an assistant beside their manager, off the reporting line; an assistant has no reports. avatar: true draws an initials placeholder. Person ids hold no colon.`,
			'A dotted line joins report to a second manager outside the solid line, drawn dashed with an arrow at that manager; label carries the scope or reason the prompt states for it ("for clinical systems"), drawn beside the line. groupByDepartment: true draws each department below the top as a labeled region.',
			"Copy every person, title, department, reporting line and dotted line the prompt states; invent none.",
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
			"Participant order is preserved left-to-right. Message order is preserved top-to-bottom.",
			'A message with type "return" from the callee back to its caller answers the latest open call between them; Sketchi draws the callee\'s activation bar from that call to its return, nesting re-entrant calls. Calls nobody answers draw no bar.',
			"Every message source and target must reference a declared participant id. A self-message (source equals target) draws as a loop on that participant's lifeline; a self-call returns into a short nested activation bar, and self-messages never answer or open a call between participants.",
			`A sequence diagram may have at most ${SEQUENCE_MAX_PARTICIPANTS} participants and ${SEQUENCE_MAX_MESSAGES} messages; larger ones are rejected with sequence_too_large.`,
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
		keywords: [
			"canvas",
			"arbitrary",
			"erd",
			"dashboard",
			"wireframe",
			"grid",
			"layers",
			"groups",
			"polygon",
		],
		snippet:
			"Hand-place a layout no builder covers (dashboard, wireframe) as a versioned CanvasSpec.",
		content: [
			"Use createCanvas only for layouts no builder covers, such as dashboards and wireframes. Processes, request flows and how systems or packages interact are flowcharts (buildFlowchart); database schemas are ER diagrams (buildErDiagram); object models are class diagrams (buildClassDiagram); team structures are org charts (buildOrgChart); topic hierarchies, participant interactions, chronologies and bar, line or pie charts have their own builders. createCanvas accepts CanvasSpec v1, never raw Excalidraw JSON.",
			"CanvasSpec supports bound and standalone text, rectangle/ellipse/diamond/circle/polygon shapes, lines and bound connectors with arrowheads, frames, groups, layers, explicit back-to-front zOrder, and deterministic row/column/grid/stack/align/distribute layouts.",
			"Every element needs a unique stable id. Connectors bind through shape nodeId values; line bindings and text containers use element ids.",
			"Generic validation enforces size, reference, geometry, and composition invariants. Intentional overlap is allowed.",
			"CanvasSpec does not accept SVG, HTML, scripts, data URLs, external URLs, or executable payloads. Use only the typed primitives in the contract.",
			"Limits: 600 elements, 64 layers, 128 layout primitives, 256 points per element, 16 groups per element, 4096 characters per text element, 16384 canvas units per dimension, and 1.5 MB serialized input.",
			"Use applyDiagramPatch structural operations for iterative edits without regenerating the whole scene.",
			"The repository examples include executable dashboard/chart, wireframe, and dense 120-element cases.",
			"",
			operationTypes("createCanvas"),
		].join("\n"),
		examples: [
			{
				title: "Signup wireframe with layers, bindings, layout, and z-order",
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
			"- Patched artifacts return provenance.sourceArtifactId; root artifacts omit provenance.",
			"",
			operationTypes("getArtifact"),
		].join("\n"),
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
			"- If export returns arrow_overlap, rebuild the FlowchartSpec as a cleaner DAG first; rerouteEdges preserves connectivity but cannot reliably fix a long upward return edge.",
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
				title: "Rename an accepted node label with replaceText",
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
			"If a shape change causes arrow_overlap or text_overflow during export, retry with rerouteEdges or translate, or rebuild the FlowchartSpec with more space. For complex flowcharts the most reliable repair is structural: keep edges flowing in the layout direction and avoid connecting a bottom node back to an early terminal.",
		].join("\n"),
		examples: [
			{
				title: "Every supported patch operation",
				language: "json",
				code: PATCH_OPERATIONS_EXAMPLE,
			},
			{
				title: "Rename an accepted node label with replaceText",
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
		snippet: "First get the semantic graph accepted, then apply visual patches.",
		content: [
			"For mixed requests like 'circle connected to a purple decision diamond', split the task:",
			"1. Choose buildFlowchart for a process graph, buildMindmap for a nested topic hierarchy, buildSequenceDiagram for chronological participant interactions, buildTimeline for milestones and event chronologies, buildChart for numbers compared across categories, or createCanvas only for layouts no builder covers.",
			"2. Inspect issues. If the build is not accepted, repair the spec and call the same build operation again.",
			"3. Once accepted, use applyDiagramPatch for circle, diamond, color, movement, rerouteEdges, or replaceText tweaks.",
			"4. Return the accepted build or patch; do not fetch the scene just to summarize it. Paste artifactDelivery.finalResponseText when present, otherwise the artifactId and Excalidraw/PNG URLs. Do not create a second Markdown, Mermaid, local file, or Antigravity artifact.",
			"For broad architecture prompts, keep the first build small and readable: one start, a mostly monotonic spine, a few decision or branch points, and separate terminal nodes for separate outcomes.",
		].join("\n"),
		examples: [
			{
				title: "Circle connected to purple decision diamond",
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
		keywords: ["examples", "sample", "canvas", "erd", "dashboard", "wireframe"],
		snippet:
			"Runnable examples for accepted graph, patch, artifact retrieval, and repair feedback.",
		content: "Use these examples as starting points for harness-generated execute code.",
		examples: [
			{
				title: "Accepted graph followed by visual patch",
				language: "js",
				code: ACCEPTANCE_LOOP_EXAMPLE,
			},
			{
				title: "Circle connected to purple decision diamond",
				language: "js",
				code: CIRCLE_TO_DIAMOND_EXAMPLE,
			},
			{
				title: "Invalid graph returns repair hints",
				language: "js",
				code: INVALID_FIRST_EXAMPLE,
			},
			{
				title: "Rename an accepted node label with replaceText",
				language: "js",
				code: REPLACE_TEXT_EXAMPLE,
			},
			{
				title: "Checkout sequence diagram",
				language: "js",
				code: SEQUENCE_DIAGRAM_EXAMPLE,
			},
			{
				title: "Signup wireframe through createCanvas",
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
			"Native Excalidraw is an output format. Prefer semantic FlowchartSpec, MindmapSpec, SequenceDiagramSpec, TimelineSpec, or ChartSpec input.",
		content:
			"Do not use native Excalidraw JSON as build input. Use FlowchartSpec, nested MindmapSpec, SequenceDiagramSpec, TimelineSpec, ChartSpec, or the renderer-independent CanvasSpec v1; scene and Excalidraw remain intentional output formats, and applyDiagramPatch handles deterministic edits.",
	},
	{
		id: "managed-thread-non-goal",
		kind: "non_goal",
		title: "Managed threads are deferred",
		topic: "overview",
		keywords: ["non-goal", "convex", "threads", "managed", "lineage", "history"],
		snippet:
			"Convex threads, message history, artifact lineage, and accepted artifact state are not in this harness surface.",
		content:
			"This MCP is for caller-owned harness state. It does not create Sketchi-managed threads, continue conversations, accept artifacts, list user artifacts, or own version history.",
	},
];
