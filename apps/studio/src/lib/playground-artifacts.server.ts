import "@tanstack/react-start/server-only";

import {
  cleanToolString,
  DiagramToolInputSchema,
  type ArtifactBundle,
  type BuildFlowchartResult,
  type CodeModeIssue,
  type DiagramToolInput,
  type FlowchartSpec,
  type FlowchartSpecNode,
} from "@sketchi/diagram-agent";

import type { StudioEnv } from "./agent.server";
import { createStudioCodeModeRuntime } from "./codemode-api.server";

const SKETCHI_ACCENT = "#8f707f";
const SKETCHI_PAPER = "#fffdf8";

export interface PlaygroundArtifactSuccess {
  ok: true;
  status: "accepted";
  artifact: ArtifactBundle;
  exportUrls: {
    excalidraw: string;
    scene: string;
  };
  editUrl: string;
  viewUrl: string;
  retention: string;
}

export interface PlaygroundArtifactFailure {
  ok: false;
  status: Exclude<BuildFlowchartResult["status"], "accepted">;
  issues: CodeModeIssue[];
}

export type PlaygroundArtifactResult =
  | PlaygroundArtifactSuccess
  | PlaygroundArtifactFailure;

export const PLAYGROUND_ARTIFACT_RETENTION =
  "Deployed Playground artifacts are stored in the configured object bucket; local development uses the in-memory fallback and loses artifacts when the dev server restarts.";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cleanOptional(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const cleaned = cleanToolString(value);
  return cleaned.length > 0 ? cleaned : undefined;
}

function flowchartKind(
  kind: DiagramToolInput["nodes"][number]["kind"],
): FlowchartSpecNode["kind"] {
  switch (kind) {
    case "start":
    case "decision":
    case "end":
      return kind;
    case "data":
    case "external":
    case "process":
    case undefined:
      return "process";
  }
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

export function diagramToolInputToFlowchartSpec(
  input: DiagramToolInput,
): FlowchartSpec {
  const title = cleanToolString(input.title);

  return {
    id: slugify(title) || "sketchi-diagram",
    title,
    nodes: input.nodes.map((node) => ({
      id: cleanToolString(node.id),
      label: cleanToolString(node.label),
      kind: flowchartKind(node.kind),
    })),
    edges: input.edges.map((edge, index) => ({
      id: `edge-${index + 1}`,
      source: cleanToolString(edge.source),
      target: cleanToolString(edge.target),
      ...(cleanOptional(edge.label)
        ? { label: cleanOptional(edge.label) }
        : {}),
    })),
    layout: {
      direction: input.direction ?? "TB",
    },
    style: {
      accentColor: SKETCHI_ACCENT,
      backgroundColor: SKETCHI_PAPER,
    },
  };
}

export function playgroundArtifactViewUrl(artifactId: string): string {
  return `/artifacts/${encodeURIComponent(artifactId)}`;
}

export function playgroundArtifactEditUrl(artifactId: string): string {
  return `${playgroundArtifactViewUrl(artifactId)}/edit`;
}

export function playgroundArtifactExportUrls(
  artifactId: string,
): PlaygroundArtifactSuccess["exportUrls"] {
  const encoded = encodeURIComponent(artifactId);
  return {
    excalidraw: `/api/v1/artifacts/${encoded}?format=excalidraw&raw=true`,
    scene: `/api/v1/artifacts/${encoded}?format=scene&raw=true`,
  };
}

function invalidInputIssues(input: unknown): CodeModeIssue[] {
  const parsed = DiagramToolInputSchema.safeParse(input);
  if (parsed.success) {
    return [];
  }

  return parsed.error.issues.map((issue) => ({
    code: "invalid_type",
    severity: "error",
    stage: "input",
    ref: {
      kind: "request",
      path: issue.path.length > 0 ? `input.${issue.path.join(".")}` : "input",
    },
    message: issue.message,
    hint: "Persist only validated create_diagram tool input.",
  }));
}

function requestInput(body: unknown): unknown {
  return isRecord(body) && "input" in body ? body.input : body;
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

function statusFor(result: PlaygroundArtifactResult): number {
  if (result.ok) {
    return 200;
  }

  switch (result.status) {
    case "invalid_input":
      return 400;
    case "invalid_flowchart":
    case "quality_failed":
      return 422;
    case "render_failed":
    case "export_failed":
    case "storage_failed":
      return 500;
  }
}

function jsonResponse(result: PlaygroundArtifactResult): Response {
  return Response.json(result, {
    status: statusFor(result),
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

export async function createPlaygroundArtifact(
  env: StudioEnv,
  request: Request,
  input: unknown,
): Promise<PlaygroundArtifactResult> {
  const parsed = DiagramToolInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      status: "invalid_input",
      issues: invalidInputIssues(input),
    };
  }

  const result = await createStudioCodeModeRuntime(env, {
    origin: new URL(request.url).origin,
  }).buildFlowchart({
    spec: diagramToolInputToFlowchartSpec(parsed.data),
    options: {
      artifactFormats: ["excalidraw", "scene"],
      inlineArtifacts: ["scene"],
    },
  });

  if (!result.ok) {
    return {
      ok: false,
      status: result.status,
      issues: result.issues,
    };
  }

  return {
    ok: true,
    status: "accepted",
    artifact: result.artifact,
    editUrl: playgroundArtifactEditUrl(result.artifact.artifactId),
    exportUrls: playgroundArtifactExportUrls(result.artifact.artifactId),
    viewUrl: playgroundArtifactViewUrl(result.artifact.artifactId),
    retention: PLAYGROUND_ARTIFACT_RETENTION,
  };
}

export async function handleCreatePlaygroundArtifactRequest(
  env: StudioEnv,
  request: Request,
): Promise<Response> {
  const body = await readJson(request);
  const result = await createPlaygroundArtifact(
    env,
    request,
    requestInput(body),
  );
  return jsonResponse(result);
}
