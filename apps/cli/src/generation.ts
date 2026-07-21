import type { FlowchartDiagram, MindmapDiagram } from "@sketchi/diagram-core";
import {
  CLOUDFLARE_AI_GATEWAY_PROVIDER_KEY_DIAGNOSTIC,
  CLOUDFLARE_AI_GATEWAY_TOKEN_REJECTED_DIAGNOSTIC,
  CloudflareGoogleAiStudioHttpClientLive,
  CloudflareGoogleAiStudioHttpConfig,
  CloudflareGoogleAiStudioHttpFetch,
  DiagramGenerationClient,
  type DiagramGenerationError,
  type DiagramGenerationType,
  DiagramGenerationPolicyLive,
  extractJsonObject,
} from "@sketchi/diagram-generation";
import { Effect, Layer } from "effect";

import { DiagramBuilder } from "./builder.js";
import type { StoredDiagram } from "./contracts.js";
import { decodeCanonicalDiagramDocument } from "./document.js";
import { CliGenerationError } from "./errors.js";
import { DiagramStore } from "./storage.js";

export const DEFAULT_GENERATION_MODEL = "gemini-3.1-flash-lite";
export const CF_AIG_TOKEN_ENV = "CF_AIG_TOKEN";
export const SKETCHI_AI_GATEWAY_ACCOUNT_ID_ENV =
  "SKETCHI_AI_GATEWAY_ACCOUNT_ID";
export const SKETCHI_AI_GATEWAY_ID_ENV = "SKETCHI_AI_GATEWAY_ID";
export const DEFAULT_SKETCHI_AI_GATEWAY_ACCOUNT_ID =
  "75f9660f39e4dafe8b95980b87e7399a";
export const DEFAULT_SKETCHI_AI_GATEWAY_ID = "google-ai-studio";

export interface GenerateDiagramInput {
  readonly model: string;
  readonly prompt: string;
  readonly type: DiagramGenerationType;
}

export interface GenerateDiagramResult {
  readonly diagram: StoredDiagram;
  readonly model: string;
  readonly provider: "cloudflare-google-ai-studio";
}

function titleFromPrompt(prompt: string): string {
  const title = prompt.replace(/\s+/gu, " ").trim().slice(0, 80);
  return title || "Generated Sketchi diagram";
}

function generationFailure(error: DiagramGenerationError): CliGenerationError {
  switch (error._tag) {
    case "DiagramGenerationConfigurationError":
      return CliGenerationError.make({
        code: "missing_credential",
        message: `Prompt-assisted generation requires ${CF_AIG_TOKEN_ENV}.`,
        hint: `Set ${CF_AIG_TOKEN_ENV} to a Cloudflare API token with AI Gateway Run access and retry.`,
        details: [],
      });
    case "DiagramGenerationHttpError": {
      const missingProviderKey = error.diagnostics.includes(
        CLOUDFLARE_AI_GATEWAY_PROVIDER_KEY_DIAGNOSTIC,
      );
      const rejectedToken =
        error.status === 401 ||
        error.status === 403 ||
        error.diagnostics.includes(
          CLOUDFLARE_AI_GATEWAY_TOKEN_REJECTED_DIAGNOSTIC,
        );
      return CliGenerationError.make({
        code: "provider_failure",
        message: missingProviderKey
          ? CLOUDFLARE_AI_GATEWAY_PROVIDER_KEY_DIAGNOSTIC
          : rejectedToken
            ? CLOUDFLARE_AI_GATEWAY_TOKEN_REJECTED_DIAGNOSTIC
            : `Cloudflare AI Gateway rejected the provider request with HTTP ${String(error.status)}.`,
        hint: missingProviderKey
          ? "Configure a default Google AI Studio BYOK key on the selected gateway, then retry."
          : rejectedToken
            ? `Set ${CF_AIG_TOKEN_ENV} to a Cloudflare API token with AI Gateway Run access.`
            : "Verify the gateway, model name, and Google AI Studio availability, then retry.",
        details: [`http_status:${String(error.status)}`],
      });
    }
    case "DiagramGenerationTransportError":
      return CliGenerationError.make({
        code: "provider_failure",
        message: "Cloudflare AI Gateway could not be reached.",
        hint: "Check network access and gateway availability, then retry.",
        details: ["transport"],
      });
    case "DiagramGenerationTimeoutError":
      return CliGenerationError.make({
        code: "generation_timeout",
        message: `Cloudflare AI Gateway did not respond within ${String(error.timeoutMs)} ms.`,
        hint: "Retry once; if it persists, choose a faster model.",
        details: [`timeout_ms:${String(error.timeoutMs)}`],
      });
    case "DiagramGenerationResponseError":
      return CliGenerationError.make({
        code: "malformed_output",
        message:
          "The Google AI Studio provider returned an unreadable response through Cloudflare AI Gateway.",
        hint: "Retry once; if it persists, choose another model.",
        details: [],
      });
    case "DiagramGenerationInputError":
      return CliGenerationError.make({
        code: "invalid_generated_document",
        message:
          "The generation request could not be converted into a diagram.",
        hint: "Use a concrete prompt that describes one diagram.",
        details: [],
      });
  }
}

function flowchartDocumentInput(diagram: FlowchartDiagram): unknown {
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

function mindmapDocumentInput(diagram: MindmapDiagram): unknown {
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

function malformedOutput(
  text: string,
): Effect.Effect<void, CliGenerationError> {
  return Effect.try({
    try: () => {
      extractJsonObject(text);
    },
    catch: () =>
      CliGenerationError.make({
        code: "malformed_output",
        message:
          "The Google AI Studio provider output did not contain one JSON object.",
        hint: "Retry once; if it persists, choose another model.",
        details: [],
      }),
  });
}

function invalidGeneratedDocument(): CliGenerationError {
  return CliGenerationError.make({
    code: "invalid_generated_document",
    message: "Generated JSON failed Sketchi schema or semantic validation.",
    hint: "Refine the prompt or choose another model, then retry.",
    details: [],
  });
}

export const generateDiagram = Effect.fn("sketchi.cli.generate")(function* (
  input: GenerateDiagramInput,
) {
  const client = yield* DiagramGenerationClient;
  const builder = yield* DiagramBuilder;
  const store = yield* DiagramStore;
  const candidate = yield* client
    .generate({
      model: input.model,
      prompt: {
        id: "sketchi-cli-generate",
        request: input.prompt,
        requiredBranchLabels: [],
        requiredNodeLabels: [],
        title: titleFromPrompt(input.prompt),
        type: input.type,
      },
    })
    .pipe(Effect.mapError(generationFailure));

  if (!candidate.diagram) {
    yield* malformedOutput(candidate.text);
    return yield* invalidGeneratedDocument();
  }
  if (candidate.diagram.type !== input.type) {
    return yield* invalidGeneratedDocument();
  }

  const document = yield* decodeCanonicalDiagramDocument(
    candidate.diagram.type === "flowchart"
      ? flowchartDocumentInput(candidate.diagram)
      : mindmapDocumentInput(candidate.diagram),
  ).pipe(Effect.mapError(() => invalidGeneratedDocument()));
  const built = yield* builder.build(document);
  const diagram = yield* store.create(built);

  return {
    diagram,
    model: candidate.model,
    provider: "cloudflare-google-ai-studio",
  } satisfies GenerateDiagramResult;
});

export function makeCloudflareGoogleAiStudioHttpConfigLayer(config: {
  readonly accountId: string;
  readonly gatewayId: string;
  readonly token: string | undefined;
}) {
  return Layer.succeed(CloudflareGoogleAiStudioHttpConfig, config);
}

export function makeCloudflareGoogleAiStudioHttpFetchLayer(
  fetch: typeof globalThis.fetch,
) {
  return Layer.succeed(CloudflareGoogleAiStudioHttpFetch, { fetch });
}

function environmentValueOrDefault(name: string, fallback: string): string {
  return process.env[name]?.trim() || fallback;
}

const CloudflareGoogleAiStudioHttpNodeDependencies = Layer.mergeAll(
  makeCloudflareGoogleAiStudioHttpConfigLayer({
    accountId: environmentValueOrDefault(
      SKETCHI_AI_GATEWAY_ACCOUNT_ID_ENV,
      DEFAULT_SKETCHI_AI_GATEWAY_ACCOUNT_ID,
    ),
    gatewayId: environmentValueOrDefault(
      SKETCHI_AI_GATEWAY_ID_ENV,
      DEFAULT_SKETCHI_AI_GATEWAY_ID,
    ),
    token: process.env[CF_AIG_TOKEN_ENV],
  }),
  makeCloudflareGoogleAiStudioHttpFetchLayer((input, init) =>
    globalThis.fetch(input, init),
  ),
  DiagramGenerationPolicyLive,
);

export const DiagramGenerationClientNodeLive =
  CloudflareGoogleAiStudioHttpClientLive.pipe(
    Layer.provide(CloudflareGoogleAiStudioHttpNodeDependencies),
  );
