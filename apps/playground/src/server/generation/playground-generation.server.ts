import "@tanstack/react-start/server-only";

import type {
  FlowchartDiagram,
  MindmapDiagram,
} from "@sketchi/diagram-core";
import {
  CloudflareAiGatewayBinding,
  CloudflareGoogleAiStudioClientLive,
  CloudflareGoogleAiStudioConfig,
  DiagramGenerationClient,
  DiagramGenerationConfigurationError,
  type DiagramGenerationCandidate,
  type DiagramGenerationError,
  type DiagramGenerationType,
  DiagramGenerationPolicyLive,
} from "@sketchi/diagram-generation";
import { Context, Effect, Layer } from "effect";

import type { StudioEnv } from "../bindings/studio-env.server";
import { PlaygroundBindings } from "../runtime/playground-context.server";

const GENERATION_PROVIDER = "cloudflare-google-ai-studio" as const;
const DEFAULT_GATEWAY_ID = "google-ai-studio";
const DEFAULT_MODEL = "google/gemini-3.1-flash-lite";

export interface GenerateDiagramServiceInput {
  readonly model?: string;
  readonly prompt: string;
  readonly type: DiagramGenerationType;
}

export interface PlaygroundGenerationShape {
  readonly generate: (
    input: GenerateDiagramServiceInput,
  ) => Effect.Effect<DiagramGenerationCandidate, DiagramGenerationError, PlaygroundBindings>;
  readonly defaultModel: (env: StudioEnv) => string;
}

export class PlaygroundGeneration extends Context.Service<
  PlaygroundGeneration,
  PlaygroundGenerationShape
>()("@sketchi/playground/PlaygroundGeneration") {}

function envString(
  env: StudioEnv,
  key: "SKETCHI_AI_GATEWAY_ID" | "SKETCHI_AI_MODEL",
  fallback: string,
): string {
  const value = env[key];
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : fallback;
}

/** Human-readable title derived from the free-text prompt. */
export function titleFromPrompt(prompt: string): string {
  const title = prompt.replace(/\s+/gu, " ").trim().slice(0, 80);
  return title || "Generated Sketchi diagram";
}

/** Convert a validated flowchart IR candidate into a canonical document input. */
export function flowchartDocumentInput(diagram: FlowchartDiagram): unknown {
  return {
    type: "flowchart",
    spec: {
      id: diagram.id,
      title: diagram.title,
      nodes: diagram.nodes.map((node) => ({
        id: node.id,
        label: node.label,
        kind: node.kind,
        ...(node.description ? { description: node.description } : {}),
      })),
      edges: diagram.edges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        ...(edge.label ? { label: edge.label } : {}),
      })),
      layout: { direction: diagram.layout.direction },
      style: diagram.style,
    },
  };
}

/** Convert a validated mindmap IR candidate into a canonical document input. */
export function mindmapDocumentInput(diagram: MindmapDiagram): unknown {
  const root = diagram.nodes.find((node) => node.kind === "root");
  if (!root) return undefined;
  const nodes = new Map(diagram.nodes.map((node) => [node.id, node]));
  const children = new Map<string, MindmapDiagram["edges"]>();
  for (const edge of diagram.edges) {
    children.set(edge.source, [...(children.get(edge.source) ?? []), edge]);
  }
  const topic = (nodeId: string): unknown => {
    const node = nodes.get(nodeId);
    if (!node) return undefined;
    const nested = [...(children.get(nodeId) ?? [])]
      .sort(
        (left, right) =>
          left.metadata.siblingIndex - right.metadata.siblingIndex,
      )
      .map((edge) => topic(edge.target));
    return {
      label: node.label,
      ...(nested.length > 0 ? { children: nested } : {}),
    };
  };

  return {
    type: "mindmap",
    spec: {
      id: diagram.id,
      title: diagram.title,
      root: topic(root.id),
      layout: { direction: diagram.layout.direction },
      style: diagram.style,
    },
  };
}

export const PlaygroundGenerationLive = Layer.succeed(PlaygroundGeneration, {
  defaultModel: (env) => envString(env, "SKETCHI_AI_MODEL", DEFAULT_MODEL),
  generate: Effect.fn("playground.generation.generate")(function* (input) {
    const env = yield* PlaygroundBindings;
    const model =
      input.model?.trim() || envString(env, "SKETCHI_AI_MODEL", DEFAULT_MODEL);
    const gatewayId = envString(
      env,
      "SKETCHI_AI_GATEWAY_ID",
      DEFAULT_GATEWAY_ID,
    );

    if (!env.AI) {
      return yield* DiagramGenerationConfigurationError.make({
        message:
          "AI Gateway generation is not configured in this Worker environment (env.AI).",
        provider: GENERATION_PROVIDER,
      });
    }

    const clientLayer = CloudflareGoogleAiStudioClientLive.pipe(
      Layer.provide(
        Layer.mergeAll(
          Layer.succeed(CloudflareAiGatewayBinding, env.AI),
          Layer.succeed(CloudflareGoogleAiStudioConfig, {
            collectLog: true,
            gatewayId,
          }),
          DiagramGenerationPolicyLive,
        ),
      ),
    );

    const request = {
      model,
      prompt: {
        id: "sketchi-generate",
        request: input.prompt,
        requiredBranchLabels: [] as string[],
        requiredNodeLabels: [] as string[],
        title: titleFromPrompt(input.prompt),
        type: input.type,
      },
    };

    return yield* Effect.flatMap(DiagramGenerationClient, (client) =>
      client.generate(request),
    ).pipe(Effect.provide(clientLayer));
  }),
});
