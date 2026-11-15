import { DIAGRAM_PATCH_OPERATION_NAMES } from "@sketchi/diagrams/build/code-mode/contract";
import {
	FLOWCHART_MAX_EDGES,
	FLOWCHART_MAX_ISSUES,
	FLOWCHART_MAX_NODES,
} from "@sketchi/diagrams/families/flowchart/diagram";
import { FLOWCHART_EDIT_RULES } from "@sketchi/diagrams/families/flowchart/rules";
import { families, familyForType } from "@sketchi/diagrams/family";
import { CANVAS_ICON_ELEMENT, CANVAS_LIMITS } from "@sketchi/drawing";
import { Record } from "effect";
import { type CodeExample, type DocsResult, type SearchHit } from "../mcp-docs.server";
import SKETCHI_CODE_MODE_TYPES from "./code-mode-types.generated.txt?raw";
import { type CodeModeOperation } from "./types";
const flowchartDocs = familyForType("flowchart").docs;
const CANVAS_SUMMARY = "hand-placed CanvasSpec, only for layouts no builder covers (illustration)";
const BUILDERS = [
	...families.map((family) => [family.operation, family.docs.summary] as const),
	["createCanvas", CANVAS_SUMMARY] as const,
];

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
const OPERATIONS = [...BUILDERS.map(([operation]) => operation), ...Record.keys(HELPERS)];
const operationIndex = (buildersHeading: string) =>
	[
		buildersHeading,
		...BUILDERS.map(([operation, summary]) => `- ${operation}: ${summary}`),
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
const COPY_RULE =
	"copy every item and detail the prompt states into its spec field, keeping its words and order; invent none.";
/**
 * Claude Code cuts upfront-loaded MCP tool descriptions and server instructions at this many
 * characters (2048 before v2.1.296), but not parameter descriptions. The execute description is a
 * head that fits the older window; the code parameter carries every builder's spec and rules.
 */
export const EXECUTE_DESCRIPTION_WINDOW = 4096;
export const EXECUTE_DESCRIPTION_LEGACY_WINDOW = 2048;
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
	`Builders: ${BUILDERS.map(([operation]) => operation).join(", ")}. The code parameter gives each one's spec and rules, so only createCanvas needs docs({ topic: "createCanvas" }) first.`,
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
	`buildFlowchart (${flowchartDocs.summary}): ${flowchartDocs.spec}.`,
	...flowchartDocs.rules.map(([rule]) => rule),
	"",
	FLOWCHART_EDIT_SPEC,
	...FLOWCHART_EDIT_LINES,
	"",
	`Other builders: ${COPY_RULE}`,
	...families
		.filter((family) => family.docs.fastPath !== undefined)
		.toSorted((left, right) => left.docs.fastPathOrder - right.docs.fastPathOrder)
		.map((family) => {
			const hint = family.docs.codeHint;
			return `- ${family.operation}${hint ? ` (${hint})` : ""}: ${family.docs.fastPath}`;
		}),
	`- createCanvas: ${CANVAS_SUMMARY}.`,
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
	...families.map((family) => ({
		order: family.docs.catalogOrder,
		entry: family.docs.entry(operationTypes(family.operation)),
	})),
	{
		order: 0,
		entry: {
			id: "overview",
			kind: "schema" as const,
			title: "Harness-first Sketchi Code Mode surface",
			topic: "overview" as const,
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
	},
	{
		order: 1,
		entry: {
			id: "execute",
			kind: "operation" as const,
			title: "execute",
			topic: "execute" as const,
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
					language: "js" as const,
					code: ACCEPTANCE_LOOP_EXAMPLE,
				},
			],
		},
	},
	{
		order: 3,
		entry: {
			id: "searchIcons",
			kind: "operation" as const,
			title: "searchIcons",
			// Logos are part of building flowcharts; the docs topic list is frozen.
			topic: "buildFlowchart" as const,
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
	},
	{
		order: 18,
		entry: {
			id: "createCanvas",
			kind: "operation" as const,
			title: "createCanvas",
			topic: "createCanvas" as const,
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
					language: "js" as const,
					code: CREATE_CANVAS_EXAMPLE,
				},
			],
		},
	},
	{
		order: 19,
		entry: {
			id: "getArtifact",
			kind: "operation" as const,
			title: "getArtifact",
			topic: "getArtifact" as const,
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
	},
	{
		order: 20,
		entry: {
			id: "editFlowchart",
			kind: "operation" as const,
			title: "editFlowchart",
			// Edits are part of flowcharts; the docs topic list is frozen.
			topic: "buildFlowchart" as const,
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
					language: "js" as const,
					code: `async () => sketchi.editFlowchart({ artifactId: "artifact_…", edits: [{ op: "insert", node: { fraud: "Check for fraud" }, between: ["review", "pay"] }, { op: "set", nodes: { "Seat party": { color: "green" }, wait: null } }] })`,
				},
			],
		},
	},
	{
		order: 21,
		entry: {
			id: "applyDiagramPatch",
			kind: "operation" as const,
			title: "applyDiagramPatch",
			topic: "applyDiagramPatch" as const,
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
					language: "ts" as const,
					code: FULL_PATCH_REQUEST_EXAMPLE,
				},
				{
					title: "Rename an accepted mindmap topic with replaceText",
					language: "js" as const,
					code: REPLACE_TEXT_EXAMPLE,
				},
			],
		},
	},
	{
		order: 22,
		entry: {
			id: "patchOperations",
			kind: "schema" as const,
			title: "Patch operation vocabulary",
			topic: "patchOperations" as const,
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
					language: "json" as const,
					code: PATCH_OPERATIONS_EXAMPLE,
				},
				{
					title: "Rename an accepted mindmap topic with replaceText",
					language: "js" as const,
					code: REPLACE_TEXT_EXAMPLE,
				},
			],
		},
	},
	{
		order: 23,
		entry: {
			id: "agentSequence",
			kind: "example" as const,
			title: "Agent sequence",
			topic: "agentSequence" as const,
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
					language: "js" as const,
					code: CIRCLE_TO_DIAMOND_EXAMPLE,
				},
			],
		},
	},
	{
		order: 24,
		entry: {
			id: "issues",
			kind: "issue" as const,
			title: "Issue repair hints",
			topic: "issues" as const,
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
					language: "js" as const,
					code: INVALID_FIRST_EXAMPLE,
				},
			],
		},
	},
	{
		order: 25,
		entry: {
			id: "examples",
			kind: "example" as const,
			title: "Executable examples",
			topic: "examples" as const,
			keywords: ["examples", "sample", "canvas", "erd", "dashboard"],
			snippet:
				"Runnable examples for accepted graph, patch, artifact retrieval, and repair feedback.",
			content: "Use these examples as starting points for harness-generated execute code.",
			examples: [
				{
					title: "Build a flowchart, then edit it by id",
					language: "js" as const,
					code: ACCEPTANCE_LOOP_EXAMPLE,
				},
				{
					title: "A purple decision diamond in one build",
					language: "js" as const,
					code: CIRCLE_TO_DIAMOND_EXAMPLE,
				},
				{
					title: "Invalid graph returns repair hints",
					language: "js" as const,
					code: INVALID_FIRST_EXAMPLE,
				},
				{
					title: "Rename an accepted mindmap topic with replaceText",
					language: "js" as const,
					code: REPLACE_TEXT_EXAMPLE,
				},
				{
					title: "Checkout sequence diagram",
					language: "js" as const,
					code: familyForType("sequence").docs.example,
				},
				{
					title: "Signup form through createCanvas",
					language: "js" as const,
					code: CREATE_CANVAS_EXAMPLE,
				},
			],
		},
	},
	{
		order: 26,
		entry: {
			id: "no-mermaid-wrapper-non-goal",
			kind: "non_goal" as const,
			title: "Do not replace accepted Sketchi artifacts with Mermaid",
			topic: "overview" as const,
			keywords: ["non-goal", "mermaid", "markdown", "artifact", "final"],
			snippet:
				"When Sketchi accepts an artifact, the final result is that artifact bundle, not a recreated Markdown diagram.",
			content:
				"Do not create a Markdown, Mermaid, local file, Antigravity artifact, or prose-only artifact after buildFlowchart, buildMindmap, buildSequenceDiagram, buildTimeline, buildChart, createCanvas, or applyDiagramPatch succeeds. Do not call getArtifact for scene just to make a local summary. Paste execute.artifactDelivery.finalResponseText when present, or return the Sketchi artifactId, available formats, and raw Excalidraw/PNG URLs so the caller can open the actual generated artifact.",
		},
	},
	{
		order: 27,
		entry: {
			id: "raw-excalidraw-non-goal",
			kind: "non_goal" as const,
			title: "Do not edit raw Excalidraw JSON as the primary path",
			topic: "overview" as const,
			keywords: ["non-goal", "excalidraw", "raw", "json", "structural"],
			snippet:
				"Native Excalidraw is an output format. Prefer a semantic flowchart document, MindmapDocument, SequenceDiagramSpec, TimelineSpec, or ChartSpec input.",
			content:
				"Do not use native Excalidraw JSON as build input. Use the flowchart document, nested MindmapDocument, SequenceDiagramSpec, TimelineSpec, ChartSpec, or the renderer-independent CanvasSpec v1; scene and Excalidraw remain intentional output formats; editFlowchart changes a flowchart and applyDiagramPatch any other diagram.",
		},
	},
	{
		order: 28,
		entry: {
			id: "managed-thread-non-goal",
			kind: "non_goal" as const,
			title: "Managed threads are deferred",
			topic: "overview" as const,
			keywords: ["non-goal", "threads", "managed", "lineage", "history"],
			snippet:
				"Sketchi-managed threads, message history, artifact lineage, and accepted artifact state are not in this harness surface.",
			content:
				"This MCP is for caller-owned harness state. It does not create Sketchi-managed threads, continue conversations, accept artifacts, list user artifacts, or own version history.",
		},
	},
]
	.sort((left, right) => left.order - right.order)
	.map(({ entry }) => entry);
