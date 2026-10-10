import "@tanstack/react-start/server-only";

import {
  SKETCHI_DIAGRAM_STYLE,
  type FlowchartDiagram,
  type MindmapDiagram,
} from "@sketchi/diagram-core";
import {
  CloudflareAiGatewayBinding,
  CloudflareGoogleAiStudioClientLive,
  CloudflareGoogleAiStudioConfig,
  type CloudflareAiGatewayProvider,
  type DiagramGenerationCacheMode,
  DiagramGenerationClient,
  DiagramGenerationConfigurationError,
  type DiagramGenerationCandidate,
  type DiagramGenerationError,
  type DiagramGenerationType,
  type GeneratedSequenceDiagram,
  DiagramGenerationPolicyLive,
} from "@sketchi/diagram-generation";
import { Context, Effect, Layer } from "effect";

import { aiEnvironment } from "../bindings/ai-env.server";
import { logosNamedIn } from "../codemode/icon-catalog.server";
import type { StudioEnv } from "../bindings/studio-env.server";
import { PlaygroundBindings } from "../runtime/context.server";

const GENERATION_PROVIDER = "cloudflare-google-ai-studio" as const;

export interface GenerateDiagramServiceInput {
  readonly cacheMode?: DiagramGenerationCacheMode;
  readonly model?: string;
  readonly prompt: string;
  readonly type?: DiagramGenerationType;
}

export interface PlaygroundGenerationShape {
  readonly generate: (
    input: GenerateDiagramServiceInput,
  ) => Effect.Effect<
    DiagramGenerationCandidate,
    DiagramGenerationError,
    PlaygroundBindings
  >;
  readonly defaultModel: (env: StudioEnv) => string;
}

export class PlaygroundGeneration extends Context.Service<
  PlaygroundGeneration,
  PlaygroundGenerationShape
>()("@sketchi/playground/PlaygroundGeneration") {}

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
        ...(node.icon ? { icon: { slug: node.icon.slug } } : {}),
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

/** Convert a validated sequence candidate into the native Code Mode contract. */
export function sequenceDocumentInput(
  diagram: GeneratedSequenceDiagram,
): unknown {
  return {
    type: "sequence",
    spec: {
      id: diagram.id,
      title: diagram.title,
      participants: diagram.participants,
      messages: diagram.messages,
      style: diagram.style ?? SKETCHI_DIAGRAM_STYLE,
    },
  };
}

export const PlaygroundGenerationLive = Layer.effect(
  PlaygroundGeneration,
  Effect.gen(function* () {
    const scope = yield* Effect.scope;
    const clients = new WeakMap<
      CloudflareAiGatewayProvider,
      Map<
        string,
        Effect.Effect<Context.Service.Shape<typeof DiagramGenerationClient>>
      >
    >();

    // Bindings may differ in local/test hosts. Each binding/configuration is
    // initialized once and owned by the host scope, not by a request scope.
    const clientForBindings = Effect.fn(
      "playground.generation.clientForBindings",
    )(function* (ai: CloudflareAiGatewayProvider, gatewayId: string) {
      let byGateway = clients.get(ai);
      if (!byGateway) {
        byGateway = new Map();
        clients.set(ai, byGateway);
      }
      let client = byGateway.get(gatewayId);
      if (!client) {
        const clientLayer = CloudflareGoogleAiStudioClientLive.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.succeed(CloudflareAiGatewayBinding, ai),
              Layer.succeed(CloudflareGoogleAiStudioConfig, {
                collectLog: true,
                gatewayId,
              }),
              DiagramGenerationPolicyLive,
            ),
          ),
        );
        client = yield* Effect.cached(
          Layer.buildWithScope(clientLayer, scope).pipe(
            Effect.map((context) =>
              Context.get(context, DiagramGenerationClient),
            ),
          ),
        );
        byGateway.set(gatewayId, client);
      }
      return yield* client;
    });

    return PlaygroundGeneration.of({
      defaultModel: (env) => aiEnvironment(env).model,
      generate: Effect.fn("playground.generation.generate")(function* (input) {
        const env = yield* PlaygroundBindings;
        const config = aiEnvironment(env);
        const model = input.model?.trim() || config.model;
        if (!env.AI) {
          return yield* DiagramGenerationConfigurationError.make({
            message:
              "AI Gateway generation is not configured in this Worker environment (env.AI).",
            provider: GENERATION_PROVIDER,
          });
        }
        const client = yield* clientForBindings(env.AI, config.gatewayId);
        const logos = logosNamedIn(input.prompt);
        return yield* client.generate({
          ...(input.cacheMode ? { cacheMode: input.cacheMode } : {}),
          model,
          prompt: {
            id: "sketchi-generate",
            ...(logos.length > 0 ? { logos } : {}),
            request: input.prompt,
            ...(input.type ? { requestedType: input.type } : {}),
          },
        });
      }),
    });
  }),
);
