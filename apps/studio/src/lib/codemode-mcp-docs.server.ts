import "@tanstack/react-start/server-only";

import { DIAGRAM_PATCH_OPERATION_NAMES } from "@sketchi/diagram-agent";
import { z } from "zod";

export const CodeModeDocsTopicSchema = z
  .enum([
    "overview",
    "execute",
    "buildFlowchart",
    "getArtifact",
    "applyDiagramPatch",
    "patchOperations",
    "agentSequence",
    "issues",
    "examples",
  ])
  .default("overview");

export const CodeModeDocsRequestSchema = z.object({
  topic: CodeModeDocsTopicSchema.optional(),
});

export const CodeModeSearchRequestSchema = z.object({
  query: z.string().min(1),
  limit: z.number().int().min(1).max(20).optional(),
});

export interface CodeExample {
  title: string;
  language: "js" | "json" | "ts";
  code: string;
}

export const CodeExampleSchema = z.object({
  title: z.string(),
  language: z.enum(["js", "json", "ts"]),
  code: z.string(),
});

export interface DocsResult extends Record<string, unknown> {
  topic: z.infer<typeof CodeModeDocsTopicSchema>;
  content: string;
  examples: CodeExample[];
  version: string;
}

export const CodeModeDocsResultSchema = z.object({
  topic: CodeModeDocsTopicSchema,
  content: z.string(),
  examples: z.array(CodeExampleSchema),
  version: z.string(),
});

export interface SearchHit {
  id: string;
  kind: "operation" | "schema" | "issue" | "example" | "non_goal";
  title: string;
  snippet: string;
  score: number;
}

export const CodeModeSearchHitSchema = z.object({
  id: z.string(),
  kind: z.enum(["operation", "schema", "issue", "example", "non_goal"]),
  title: z.string(),
  snippet: z.string(),
  score: z.number(),
});

export interface SearchResult extends Record<string, unknown> {
  query: string;
  results: SearchHit[];
}

export const CodeModeSearchResultSchema = z.object({
  query: z.string(),
  results: z.array(CodeModeSearchHitSchema),
});

interface CatalogEntry {
  id: string;
  kind: SearchHit["kind"];
  title: string;
  topic: DocsResult["topic"];
  keywords: string[];
  snippet: string;
  content: string;
  examples?: CodeExample[];
}

export const SKETCHI_CODE_MODE_VERSION = "2026-06-23";

const PATCH_OPERATION_SUMMARY = [
  "- setDefaultStyle: set fallback strokeColor, fillColor, textColor, or backgroundColor for the scene.",
  "- setStyle: style selected nodes, edges, labels, or scopes.",
  "- setShape: change selected node shapes to rectangle, diamond, ellipse, or circle.",
  "- translate: move selected nodes/edges/text by dx and dy; connectivity is preserved by default.",
  "- replaceText: replace selected node labels, edge labels, or text elements. Use this for label edits.",
  "- rerouteEdges: reroute selected edges after movement or shape changes.",
].join("\n");

const PATCH_REQUEST_SHAPE = `interface ApplyDiagramPatchRequest {
  source: { artifactId: string; format?: "scene" } | { scene: RenderedDiagramScene };
  operations: DiagramPatchOperation[];
  intent?: string;
  options?: { inlineArtifacts?: ["scene", "excalidraw"]; artifactFormats?: ["scene", "excalidraw", "png"]; preserveConnectivity?: boolean };
}

type DiagramPatchOperation =
  | { op: "setDefaultStyle"; style: DiagramStylePatch }
  | { op: "setStyle"; selector: DiagramSelector; style: DiagramStylePatch }
  | { op: "setShape"; selector: DiagramSelector; shape: "rectangle" | "diamond" | "ellipse" | "circle" }
  | { op: "translate"; selector: DiagramSelector; dx: number; dy: number }
  | { op: "replaceText"; selector: DiagramSelector; text: string }
  | { op: "rerouteEdges"; selector?: DiagramSelector };

// Primary public path:
{
  source: { artifactId: "<artifact id from buildFlowchart or applyDiagramPatch>" },
  intent: "short human reason for the edit",
  operations: [{ op: "replaceText", selector: { nodeIds: ["ship"] }, text: "Ship to production" }],
  options: { inlineArtifacts: ["scene", "excalidraw"] }
}`;

const PATCH_OPERATIONS_EXAMPLE = `[
  { op: "setDefaultStyle", style: { strokeColor: "#111827", fillColor: "#ffffff", textColor: "#111827" } },
  { op: "setStyle", selector: { nodeIds: ["gate"] }, style: { strokeColor: "#7c3aed", fillColor: "#ede9fe" } },
  { op: "setShape", selector: { nodeIds: ["gate"] }, shape: "diamond" },
  { op: "translate", selector: { nodeIds: ["gate"] }, dx: 24, dy: -12 },
  { op: "replaceText", selector: { nodeIds: ["ship"] }, text: "Ship to production" },
  { op: "rerouteEdges", selector: { scope: "edges" } }
]`;

const FULL_PATCH_REQUEST_EXAMPLE = `{
  source: { artifactId: built.artifact.artifactId },
  operations: [
    {
      op: "setStyle",
      selector: { nodeIds: ["gate"] },
      style: { strokeColor: "#7c3aed", fillColor: "#ede9fe" }
    },
    {
      op: "replaceText",
      selector: { nodeIds: ["ship"] },
      text: "Ship to production"
    }
  ],
  options: { inlineArtifacts: ["scene", "excalidraw"], preserveConnectivity: true }
}`;

export const SKETCHI_CODE_MODE_TYPES = `declare const sketchi: {
  buildFlowchart(input: BuildFlowchartRequest): Promise<BuildFlowchartResult>;
  getArtifact(input: GetArtifactRequest): Promise<GetArtifactResult>;
  applyDiagramPatch(input: ApplyDiagramPatchRequest): Promise<ApplyDiagramPatchResult>;
};

type FlowchartNodeKind = "start" | "process" | "decision" | "end";
type ArtifactFormat = "scene" | "excalidraw" | "png";
type InlineArtifactFormat = "scene" | "excalidraw";
type DiagramShape = "rectangle" | "diamond" | "ellipse" | "circle";

interface FlowchartSpec {
  id?: string;
  title: string;
  nodes: Array<{
    id: string;
    label: string;
    kind: FlowchartNodeKind;
    description?: string;
  }>;
  edges?: Array<{
    id?: string;
    source: string;
    target: string;
    label?: string;
  }>;
  layout?: { direction?: "TB" | "LR" };
  style?: {
    accentColor?: string;
    backgroundColor?: string;
  };
}

interface BuildFlowchartRequest {
  requestId?: string;
  spec: FlowchartSpec;
  options?: {
    artifactFormats?: ArtifactFormat[];
    inlineArtifacts?: InlineArtifactFormat[];
    minQualityScore?: number;
  };
}

interface GetArtifactRequest {
  artifactId: string;
  format?: ArtifactFormat;
  inline?: boolean;
}

interface DiagramSelector {
  ids?: string[];
  nodeIds?: string[];
  edgeIds?: string[];
  kinds?: FlowchartNodeKind[];
  labels?: string[];
  scope?: "all" | "nodes" | "edges";
}

type DiagramPatchOperation =
  | { op: "setDefaultStyle"; style: DiagramStylePatch }
  | { op: "setStyle"; selector: DiagramSelector; style: DiagramStylePatch }
  | { op: "setShape"; selector: DiagramSelector; shape: DiagramShape }
  | { op: "translate"; selector: DiagramSelector; dx: number; dy: number }
  | { op: "replaceText"; selector: DiagramSelector; text: string }
  | { op: "rerouteEdges"; selector?: DiagramSelector };

interface DiagramStylePatch {
  strokeColor?: string;
  fillColor?: string;
  textColor?: string;
  backgroundColor?: string;
}

type DiagramPatchSource =
  | { artifactId: string; format?: "scene" }
  | { scene: unknown };

interface ApplyDiagramPatchRequest {
  requestId?: string;
  source: DiagramPatchSource;
  operations: DiagramPatchOperation[];
  options?: {
    artifactFormats?: ArtifactFormat[];
    inlineArtifacts?: InlineArtifactFormat[];
    preserveConnectivity?: boolean;
  };
  intent?: string;
}

interface CodeModeIssue {
  code: string;
  severity: "error" | "warning";
  stage: "input" | "flowchart" | "quality" | "render" | "export" | "storage";
  ref?: { kind: "request" | "diagram" | "node" | "edge" | "artifact"; id?: string; path?: string };
  message: string;
  hint: string;
}

type BuildFlowchartResult =
  | { ok: true; status: "accepted"; buildId: string; normalizedSpec: unknown; quality: unknown; artifact: ArtifactBundle; issues: CodeModeIssue[] }
  | { ok: false; status: string; issues: CodeModeIssue[]; normalizedSpec?: unknown; quality?: unknown; partial?: unknown };

type GetArtifactResult =
  | { ok: true; artifactId: string; diagramId: string; format: ArtifactFormat; mimeType: string; inline?: unknown; sizeBytes?: number; url?: string; expiresAt?: string }
  | { ok: false; status: string; issues: CodeModeIssue[] };

type ApplyDiagramPatchResult =
  | { ok: true; status: "accepted"; patchId: string; sourceArtifactId?: string; artifact: ArtifactBundle; issues: CodeModeIssue[] }
  | { ok: false; status: string; issues: CodeModeIssue[]; sourceArtifactId?: string; partial?: unknown };

interface ArtifactBundle {
  artifactId: string;
  diagramId: string;
  formats: Array<{ format: ArtifactFormat; mimeType: string; inline?: unknown; sizeBytes?: number }>;
  preview?: { format: ArtifactFormat; mimeType: string; inline?: unknown; sizeBytes?: number };
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
    options: {
      artifactFormats: ["scene", "excalidraw", "png"],
      inlineArtifacts: ["scene", "excalidraw"],
    },
  });
}`;

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

  const patched = await sketchi.applyDiagramPatch({
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
    options: {
      artifactFormats: ["scene", "excalidraw", "png"],
      inlineArtifacts: ["scene", "excalidraw"],
    },
  });

  if (!patched.ok) return patched;

  return sketchi.getArtifact({
    artifactId: patched.artifact.artifactId,
    format: "png",
    inline: false,
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
    options: { inlineArtifacts: ["scene", "excalidraw"] },
  });
}`;

const catalog: CatalogEntry[] = [
  {
    id: "overview",
    kind: "schema",
    title: "Harness-first Sketchi Code Mode surface",
    topic: "overview",
    keywords: ["overview", "harness", "codex", "claude", "opencode", "mcp"],
    snippet:
      "Use this MCP for external agent harnesses. It exposes docs, search, and execute only.",
    content: [
      "Sketchi Code Mode MCP is for external agent harnesses: Codex, Claude Code, OpenCode, and similar clients.",
      "The server exposes a small contract: docs, search, and execute. execute runs JavaScript against a typed sketchi client.",
      "The public sketchi client has exactly three operations: buildFlowchart, getArtifact, and applyDiagramPatch.",
      "Use docs({ topic }) for full request envelopes and examples. Use search({ query }) to discover operation-specific topics such as patchOperations.",
      "The managed Sketchi product model, Convex threads, user artifact lineage, and Studio chat/canvas parity are intentionally out of this slice.",
    ].join("\n"),
  },
  {
    id: "execute",
    kind: "operation",
    title: "execute",
    topic: "execute",
    keywords: ["execute", "code", "javascript", "typescript", "sandbox"],
    snippet:
      "Run an async JavaScript arrow function with sketchi.buildFlowchart, sketchi.getArtifact, and sketchi.applyDiagramPatch.",
    content: [
      "execute({ code }) runs an async JavaScript arrow function.",
      "This matches the Code Mode pattern: typed host tools are exposed as a namespace inside the sandbox, here sketchi.*.",
      "Cloudflare Code Mode exposes typed namespace methods in generated code; this server follows that shape with sketchi.buildFlowchart, sketchi.getArtifact, and sketchi.applyDiagramPatch.",
      "Pass the function expression itself. A trailing semicolon and outer markdown code fence are accepted, but examples omit them so copied code is canonical.",
      "Write JavaScript only: no TypeScript annotations, interfaces, generics, imports, or named wrapper functions. Use the canonical shape async () => { const result = await sketchi.buildFlowchart(...); return result; }.",
      "Do not define a named function and then call it. Put the arrow function body directly in code.",
      "Inside code, call sketchi.buildFlowchart(input), sketchi.getArtifact(input), and sketchi.applyDiagramPatch(input).",
      "The sandbox must not receive secrets, storage bindings, model credentials, or raw network access.",
      "Call sketchi methods sequentially when possible so a harness can inspect structured failures and retry deliberately.",
      "",
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
    ],
    snippet:
      "Create the semantic flowchart first. Fix issues before styling or shape changes.",
    content: [
      "buildFlowchart accepts a compact FlowchartSpec: title, nodes, edges, optional layout, and optional style.",
      'Request envelope: { spec: FlowchartSpec, options?: { artifactFormats?: ["scene", "excalidraw", "png"], inlineArtifacts?: ["scene", "excalidraw"], minQualityScore?: number } }.',
      "Request png when the agent needs hosted visual proof. PNG artifacts are stored binary outputs and are never inlined in MCP JSON responses.",
      "Use stable node ids. Decision nodes need meaningful labeled outgoing branches, usually yes/no.",
      "For export-ready visual proof, prefer monotonic flowchart graphs: avoid long back-edges, loops to earlier nodes, or reusing the same terminal node for both early and late outcomes. Use distinct terminal nodes when branches resolve at different depths.",
      "If buildFlowchart returns ok: false, repair the spec from issues and call buildFlowchart again.",
      "Do not use applyDiagramPatch until buildFlowchart returns an accepted artifact.",
    ].join("\n"),
  },
  {
    id: "getArtifact",
    kind: "operation",
    title: "getArtifact",
    topic: "getArtifact",
    keywords: [
      "get",
      "artifact",
      "scene",
      "excalidraw",
      "png",
      "format",
      "inline",
      "raw",
    ],
    snippet:
      "Retrieve scene, Excalidraw, or hosted PNG artifacts by artifactId after build or patch acceptance.",
    content: [
      "getArtifact reads a stored artifact by artifactId.",
      'Request envelope: { artifactId: string, format?: "scene" | "excalidraw" | "png", inline?: boolean }.',
      "Use format: 'scene' for the compact Sketchi scene and format: 'excalidraw' for portable Excalidraw JSON.",
      "Use format: 'png' for hosted visual proof. PNG is binary and is returned as metadata from getArtifact, never as inline payload.",
      "Pass inline: true only when the harness needs scene or Excalidraw JSON in the MCP response.",
      "To fetch raw PNG bytes, request GET /api/v1/artifacts/{artifactId}?format=png&raw=true from the Studio API.",
      "Use the artifactId returned by buildFlowchart or applyDiagramPatch.",
    ].join("\n"),
  },
  {
    id: "applyDiagramPatch",
    kind: "operation",
    title: "applyDiagramPatch",
    topic: "applyDiagramPatch",
    keywords: [
      "patch",
      "style",
      "shape",
      "selector",
      "color",
      "translate",
      "text",
      "reroute",
    ],
    snippet:
      "Apply deterministic non-structural visual changes to an accepted artifact.",
    content: [
      "applyDiagramPatch modifies styling, shape, text, layout translation, and edge routes.",
      "Request envelope:",
      PATCH_REQUEST_SHAPE,
      "Selectors can target nodeIds, edgeIds, labels, element ids, kinds, or broad scopes.",
      `Supported operation names: ${DIAGRAM_PATCH_OPERATION_NAMES.join(", ")}.`,
      PATCH_OPERATION_SUMMARY,
      "Patch operations do not create or delete nodes and edges. Rebuild the FlowchartSpec for structural changes.",
      "For color changes, use 6-digit hex strings such as #7c3aed.",
      "For hosted visual proof after a patch, include png in artifactFormats and fetch the raw Studio API artifact bytes.",
      "If export returns arrow_overlap, first rebuild the FlowchartSpec into a cleaner DAG. rerouteEdges preserves connectivity, but it cannot reliably fix a graph with a long upward return edge.",
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
    snippet:
      "Allowed applyDiagramPatch operation names and the fields each operation needs.",
    content: [
      `Allowed op values: ${DIAGRAM_PATCH_OPERATION_NAMES.join(", ")}.`,
      PATCH_OPERATION_SUMMARY,
      "",
      "Use replaceText for label edits. Do not use setText, setLabel, rename, relabel, text, updateLabel, or setNodeLabel.",
      "Op-specific shapes:",
      PATCH_REQUEST_SHAPE,
      "Every operation except setDefaultStyle needs a selector unless noted otherwise. A selector can use nodeIds, edgeIds, ids, labels, kinds, or scope.",
      "For style patches, node and edge colors use strokeColor, fillColor, textColor, and backgroundColor. FlowchartSpec top-level style uses accentColor and backgroundColor.",
      "If a shape change causes arrow_overlap or text_overflow during export, retry with rerouteEdges, translate, or rebuild the FlowchartSpec with more space.",
      "For complex flowcharts, the most reliable repair is usually structural: keep edges flowing in the declared layout direction and avoid connecting a bottom node back to an early terminal.",
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
    snippet:
      "First get the semantic graph accepted, then apply visual patches.",
    content: [
      "For mixed requests like 'circle connected to a purple decision diamond', split the task.",
      "Step 1: build a valid semantic flowchart with nodes and edges.",
      "Step 2: inspect issues. If not accepted, repair the spec and call buildFlowchart again.",
      "Step 3: once accepted, use applyDiagramPatch for circle, diamond, color, movement, rerouteEdges, or replaceText tweaks.",
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
    ],
    snippet:
      "Structured issues include code, stage, ref, message, and hint. Repair from those fields.",
    content: [
      "All rejected operations return structured issues with code, severity, stage, ref, message, and hint.",
      "input-stage issues usually mean the request shape is wrong. Fix the referenced path.",
      "flowchart-stage issues mean node ids, edges, starts, ends, or decision branches are invalid.",
      "quality-stage issues mean the diagram is technically valid but too weak or generic. Improve labels and branching.",
      "patch issues such as unknown_patch_target mean the selector does not match the accepted artifact.",
      "unsupported_patch_operation on operations.[n].op means the op name is not supported; use patchOperations or the issue hint to pick an allowed value.",
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
    keywords: ["examples", "sample", "purple", "diamond", "approval"],
    snippet:
      "Runnable examples for accepted graph, patch, artifact retrieval, and repair feedback.",
    content:
      "Use these examples as starting points for harness-generated execute code.",
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
    ],
  },
  {
    id: "raw-excalidraw-non-goal",
    kind: "non_goal",
    title: "Do not edit raw Excalidraw JSON as the primary path",
    topic: "overview",
    keywords: ["non-goal", "excalidraw", "raw", "json", "structural"],
    snippet:
      "Native Excalidraw is an export format. Prefer FlowchartSpec and structured patch operations.",
    content:
      "Do not ask harnesses to directly mutate native Excalidraw JSON for normal flowchart generation or styling. Rebuild structure with buildFlowchart and use applyDiagramPatch for deterministic visual changes.",
  },
  {
    id: "managed-thread-non-goal",
    kind: "non_goal",
    title: "Managed threads are deferred",
    topic: "overview",
    keywords: [
      "non-goal",
      "convex",
      "threads",
      "managed",
      "lineage",
      "history",
    ],
    snippet:
      "Convex threads, message history, artifact lineage, and accepted artifact state are not in this harness surface.",
    content:
      "This MCP is for caller-owned harness state. It does not create Sketchi-managed threads, continue conversations, accept artifacts, list user artifacts, or own version history.",
  },
];

function docsEntryForTopic(topic: DocsResult["topic"]): CatalogEntry {
  const fallback = catalog.find((entry) => entry.id === "overview");
  const entry = catalog.find((entry) => entry.topic === topic) ?? fallback;

  if (!entry) {
    throw new Error("Code Mode docs catalog is missing an overview entry.");
  }

  return entry;
}

function scoreEntry(entry: CatalogEntry, terms: string[]): number {
  const haystack = [
    entry.id,
    entry.kind,
    entry.title,
    entry.topic,
    entry.snippet,
    entry.content,
    ...entry.keywords,
  ]
    .join(" ")
    .toLowerCase();

  return terms.reduce((score, term) => {
    if (entry.id.toLowerCase() === term || entry.topic.toLowerCase() === term) {
      return score + 12;
    }
    if (entry.keywords.some((keyword) => keyword.toLowerCase() === term)) {
      return score + 8;
    }
    return haystack.includes(term) ? score + 1 : score;
  }, 0);
}

export function getCodeModeDocs(input: unknown): DocsResult {
  const parsed = CodeModeDocsRequestSchema.parse(input);
  const topic = parsed.topic ?? "overview";
  const entry = docsEntryForTopic(topic);
  return {
    topic,
    content: entry.content,
    examples: entry.examples ?? [],
    version: SKETCHI_CODE_MODE_VERSION,
  };
}

export function searchCodeModeDocs(input: unknown): SearchResult {
  const parsed = CodeModeSearchRequestSchema.parse(input);
  const terms = parsed.query
    .toLowerCase()
    .split(/[^a-z0-9_#-]+/)
    .filter(Boolean);
  const limit = parsed.limit ?? 8;
  const results = catalog
    .map((entry) => ({
      id: entry.id,
      kind: entry.kind,
      title: entry.title,
      snippet: entry.snippet,
      score: scoreEntry(entry, terms),
    }))
    .filter((hit) => hit.score > 0)
    .sort(
      (left, right) =>
        right.score - left.score || left.id.localeCompare(right.id),
    )
    .slice(0, limit);

  return {
    query: parsed.query,
    results,
  };
}
