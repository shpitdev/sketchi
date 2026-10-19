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

/** One line per operation. Every request carries this index, so family detail lives in docs topics. */
const BUILDERS = {
	buildFlowchart:
		"process steps and decisions, including how systems or packages interact along a request or data flow",
	buildMindmap: "a nested topic hierarchy",
	buildSequenceDiagram: "time-ordered messages between participants",
	buildTimeline: "dated or ordered events, milestones and phases",
	buildChart: "bar, line or pie charts of numbers across categories",
	buildStateMachine: "states and the events, guards and actions that move between them",
	createCanvas:
		"hand-placed CanvasSpec, only for layouts no builder above covers (ERD, dashboard, wireframe)",
};
const HELPERS = {
	searchIcons:
		"searchIcons({ q, limit? }) resolves to { icons: [{ slug, name, collection }] }: exact logo slugs for named technologies",
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
	buildSequenceDiagram: `spec: { title, participants: [{ id, label, icon?: { slug } }], messages: [{ source, target, label, type?: "return", style?: "dashed" }] }. Order is kept. Every reply the prompt states is its own type: "return" message from the callee back to its caller; it answers the latest open call between them, and calls nobody answers draw no bar. source and target are distinct participant ids.`,
	buildStateMachine: `spec: { title, initial, states: [{ id, label?, kind?: "final" | "choice", parent?: compositeId, initial?: substateId }], transitions: [{ source, target, event?, guard?, action? }] }. spec.initial is the top-level start state. A state named as parent is a composite: set initial on the composite itself to its first substate id; composites do not nest. Every outgoing transition of a choice has a guard, without brackets; one may be "else". kind "final" (label optional) ends the machine and nothing leaves it. ${STATE_MACHINE_END_RULE}`,
	buildMindmap: `spec: { title, root: { label, children?: [{ label, children? }] }, layout?: { direction: "LR" | "RL" } }. Children keep their order.`,
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

/** The buildFlowchart topic, also carried verbatim by the execute description. */
const FLOWCHART_DOCS = [
	"buildFlowchart accepts a compact FlowchartSpec: title, nodes, edges, and optional layout. Builds use the fixed Sketchi palette.",
	"Keep every requested step and decision in a separate node, preserving the prompt's step wording and order. Use plain step labels; do not merge a destination with its next action or replace a named step with a paraphrase.",
	'A stated check or verification ("verify the signature", "stock is checked") is its own process node before the decision that reads its result; "check whether X" alone is just that decision.',
	"Label steps and decisions with the prompt's own words, including how it phrases each decision, and keep every decision it states as a decision node. Only when two labels would be identical, add the distinguishing words the prompt itself uses.",
	"Use one node per outcome the prompt names: point every branch that reaches the same named outcome at that one node, and do not add end nodes the prompt does not name.",
	'Do not add loops, steps, or edges the prompt does not state. A step that repeats an earlier step ("send another ...", "try again", "retry", "resubmit") continues that cycle: draw it as the earlier step or as a step that loops back to the decision after it, never as an end. Only a new, unrepeated final step with no stated next step is that branch\'s end node (kind: "end").',
	"Use stable node ids. Decision nodes need meaningful labeled outgoing branches, usually yes/no.",
	"Only when the prompt groups steps (teams, zones, phases), declare groups: [{ id, label }] and set each member node's group to a group id. Leave other nodes ungrouped; groups do not nest.",
	'Brand logos: when a node is about a named technology (GitHub, Docker, Postgres), call sketchi.searchIcons({ q: "docker" }) and set that node\'s icon to { slug } with an exact returned slug. The logo is drawn above the label. Never guess a slug: unknown slugs are dropped with an unknown_icon warning, and logos that cannot be drawn are dropped with icon_dropped. Neither fails the build.',
	"Logo guidance applies only to technologies named in the prompt. Each node holds one icon. For X on Y, preserve both technologies as separate meaningful steps and attach each logo to its own node. Do not hide the host only in the title or combine both brands under one icon. Keep the requested step order and stay within graph limits.",
	"Before building, compare the named technologies with the icons assigned to nodes. A label or successful search alone does not attach a logo; omitted icons produce no warning. If no matching logo exists, keep the technology label and report the unavailable logo instead of substituting another brand.",
	`Flowcharts are bounded to ${FLOWCHART_MAX_NODES} nodes and ${FLOWCHART_MAX_EDGES} edges. Larger graphs fail with flowchart_too_large before render or persistence.`,
	"Every node must be reachable from the single start, and every reachable node must be able to reach an end. Closed cycles fail with nonterminating_node; retry loops remain valid when they retain an eventual exit to an end.",
	"For export-ready visual proof, prefer monotonic flowchart graphs: avoid long back-edges and loops to earlier nodes that the prompt does not state.",
	"For broad or vague repo/system architecture prompts, summarize into 8-14 high-signal nodes. Prefer a single readable spine with short side branches over a dense dependency graph with one node per package or many crossing links.",
	"When a prompt asks how packages or systems interact, group related packages into layers and show the main flow of responsibility. Use labels/descriptions for detail instead of adding every possible transitive edge.",
	"Keep every package and component the prompt names under its own name; summarizing drops unnamed detail and never renames or generalizes named parts.",
	"If buildFlowchart returns ok: false, repair the spec from issues and call buildFlowchart again.",
	"Do not use applyDiagramPatch until buildFlowchart returns an accepted artifact.",
	"",
	operationTypes("buildFlowchart"),
].join("\n");

const LOGO_RULE =
	"When the prompt names technologies, call sketchi.searchIcons({ q }) for each and set node.icon or sequence participant.icon to { slug } from a matching slug. One icon per node, so 'X on Y' is two steps; labels alone add no logo.";

/** Fits EXECUTE_DESCRIPTION_LEGACY_WINDOW, so every Claude Code version reads all of it. */
export const EXECUTE_TOOL_DESCRIPTION = [
	"Run JavaScript against the typed sketchi client. code is one async arrow function in plain JavaScript (no TypeScript, imports or named wrappers): async () => sketchi.buildFlowchart({ spec, options }), with options as the code parameter shows",
	'Builders. The code parameter gives each one\'s spec and rules, so only createCanvas needs docs({ topic: "createCanvas" }) first:',
	...Object.entries(BUILDERS).map(([operation, summary]) => `- ${operation}: ${summary}`),
	"Helpers:",
	...EXECUTE_HELPERS.map((summary) => `- ${summary}`),
	`- ${LOGO_RULE}`,
	"- Builds resolve to { ok: true, artifact, normalizedSpec, issues } or { ok: false, issues: [{ code, message, hint }] }; on ok: false, fix the spec from each hint and build again.",
	"- Return the accepted result: execute adds artifactDelivery.finalResponseText; copy it verbatim as the final answer and stop, never recreating the diagram as Markdown, Mermaid, a file or an Antigravity artifact.",
].join("\n");

/** Parameter descriptions are not truncated, so the fast path and the full flowchart topic live here. */
export const EXECUTE_CODE_DESCRIPTION = [
	`One async arrow function. Call every builder as sketchi.<builder>({ spec, options: ${DELIVERY_OPTIONS} }) to get Excalidraw and PNG URLs without inline JSON. Each builder's spec and the rules that make it build first try:`,
	"",
	"buildFlowchart:",
	FLOWCHART_DOCS,
	"",
	"Other builders:",
	...Object.entries(FAST_PATH).map(([operation, line]) => `- ${operation}: ${line}`),
	"",
	"- Run logo searches and the build in one execute script: await the searches, then set each icon from a returned slug.",
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
    kind: "canvas", version: 1, diagramId: "erd", title: "Commerce ERD",
    width: 960, height: 560, accentColor: "#1f2937", backgroundColor: "#ffffff",
    layers: [{ id: "entities", name: "Entities" }, { id: "relations", name: "Relations" }],
    elements: [
      { type: "node", id: "users", nodeId: "users", shape: "rectangle", x: 80, y: 80, width: 220, height: 160, label: "users\\nid PK\\nemail UNIQUE", layerId: "entities", fillColor: "#dbeafe" },
      { type: "node", id: "orders", nodeId: "orders", shape: "rectangle", x: 380, y: 80, width: 220, height: 160, label: "orders\\nid PK\\nuser_id FK", layerId: "entities", fillColor: "#dcfce7" },
      { type: "node", id: "items", nodeId: "items", shape: "rectangle", x: 680, y: 80, width: 220, height: 160, label: "order_items\\norder_id FK\\nsku", layerId: "entities", fillColor: "#fef3c7" },
      { type: "arrow", id: "users-orders", edgeId: "users-orders", sourceNodeId: "users", targetNodeId: "orders", points: [{x:300,y:160},{x:380,y:160}], label: "1:N", layerId: "relations", startArrowhead: "bar", endArrowhead: "arrow" },
      { type: "arrow", id: "orders-items", edgeId: "orders-items", sourceNodeId: "orders", targetNodeId: "items", points: [{x:600,y:160},{x:680,y:160}], label: "1:N", layerId: "relations", startArrowhead: "bar", endArrowhead: "arrow" }
    ],
    layouts: [{ type: "row", ids: ["users", "orders", "items"], x: 80, y: 80, gap: 80 }],
    zOrder: ["users", "orders", "items", "users-orders", "orders-items"]
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
			"The response is { ok, result, logs, builds, artifactDelivery?, finalResponseText?, error? }. result is the script return value. builds lists every buildFlowchart, buildMindmap, buildSequenceDiagram, buildTimeline, buildChart, and createCanvas attempt in call order, even when the script returns other data, nothing, or an error. Each receipt has operation, zero-based index, ok, status, and issues, plus buildId, quality, normalizedSpec, and artifact or partial references when available; inline exports are not duplicated. Retrieval and patch calls are not builds. A build still running when the executor times out or aborts has status: incomplete and ok: false.",
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
			"It returns { ok: true, query, icons: [{ slug, name, collection }] }. limit defaults to 10 and is capped at 25.",
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
			"Results match the other native builders. Request png in artifactFormats for a hosted PNG.",
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
			'initial is the top-level state the machine starts in. kind "final" is an end bullseye and needs no label; kind "choice" is a diamond whose outgoing transitions each carry a guard; one may be "else". States other states name as parent form a composite, drawn as a frame around them: give it initial, its first substate. Composites do not nest.',
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
			"Every message source and target must reference a declared participant id. Self-referential messages are rejected with structured issues and repair hints.",
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
			"Hand-place a layout no builder covers (ERD, dashboard, wireframe) as a versioned CanvasSpec.",
		content: [
			"Use createCanvas only for layouts no builder covers, such as ERDs, dashboards and wireframes. Processes, request flows and how systems or packages interact are flowcharts (buildFlowchart); topic hierarchies, participant interactions, chronologies and bar, line or pie charts have their own builders. createCanvas accepts CanvasSpec v1, never raw Excalidraw JSON.",
			"CanvasSpec supports bound and standalone text, rectangle/ellipse/diamond/circle/polygon shapes, lines and bound connectors with arrowheads, frames, groups, layers, explicit back-to-front zOrder, and deterministic row/column/grid/stack/align/distribute layouts.",
			"Every element needs a unique stable id. Connectors bind through shape nodeId values; line bindings and text containers use element ids.",
			"Generic validation enforces size, reference, geometry, and composition invariants. Intentional overlap is allowed.",
			"CanvasSpec does not accept SVG, HTML, scripts, data URLs, external URLs, or executable payloads. Use only the typed primitives in the contract.",
			"Limits: 600 elements, 64 layers, 128 layout primitives, 256 points per element, 16 groups per element, 4096 characters per text element, 16384 canvas units per dimension, and 1.5 MB serialized input.",
			"Use applyDiagramPatch structural operations for iterative edits without regenerating the whole scene.",
			"The repository examples include executable ERD, dashboard/chart, wireframe, and dense 120-element cases.",
			"",
			operationTypes("createCanvas"),
		].join("\n"),
		examples: [
			{
				title: "Commerce ERD with layers, bindings, layout, and z-order",
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
			"- For hosted visual proof after a patch, include png in artifactFormats.",
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
				title: "Commerce ERD through createCanvas",
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
