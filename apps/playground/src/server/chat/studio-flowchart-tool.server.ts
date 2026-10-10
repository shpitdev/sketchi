import "@tanstack/react-start/server-only";

import {
  BuildFlowchartRequestSchema,
  BuildFlowchartResultSchema,
  DIAGRAM_AGENT_SYSTEM_PROMPT,
  MAX_FLOWCHART_BUILD_ATTEMPTS,
  normalizeIconSlug,
  type BuildFlowchartOptions,
  type BuildFlowchartResult,
  type BuildFlowchartToolInput,
  type CodeModeIssue,
} from "@sketchi/diagram-agent";
import { placeNodeLogos, type OfferedLogo } from "@sketchi/diagram-generation";
import { recordMetric } from "@sketchi/observability";
import { Effect, Metric, Ref, Semaphore } from "effect";

import { toPlaygroundStandardSchema } from "../schema/effect-standard-schema.server";

export const STUDIO_BUILD_FLOWCHART_TOOL_NAME = "build_flowchart" as const;

export const STUDIO_BUILD_FLOWCHART_TOOL_DESCRIPTION =
  "Build and persist one canonical flowchart artifact. Pass { spec: FlowchartSpec }; the host supplies artifact options. If rejected, repair every structured issue and retry, up to three total attempts.";

export const StudioBuildFlowchartInputSchema = toPlaygroundStandardSchema(
  BuildFlowchartRequestSchema.omit({ options: true }),
);
export const StudioBuildFlowchartOutputSchema = toPlaygroundStandardSchema(
  BuildFlowchartResultSchema,
);

export type StudioBuildFlowchartInput = BuildFlowchartToolInput;

export const STUDIO_FLOWCHART_ARTIFACT_OPTIONS: NonNullable<BuildFlowchartOptions> =
  {
    artifactFormats: ["scene", "excalidraw"],
    inlineArtifacts: ["scene"],
  };

const studioFlowchartRetries = Metric.counter(
  "sketchi_chat_flowchart_retries",
  {
    description: "Studio chat flowchart repair attempts",
    incremental: true,
  },
);

/**
 * Studio's system prompt, plus the logos the user named. The model may only use
 * those slugs; anything else is dropped before the build.
 */
export function studioSystemPrompt(
  logos: readonly { readonly name: string; readonly slug: string }[],
): string {
  if (logos.length === 0) return DIAGRAM_AGENT_SYSTEM_PROMPT;
  return [
    DIAGRAM_AGENT_SYSTEM_PROMPT,
    "",
    "NODE LOGOS",
    `- Logos for technologies the user named: ${logos
      .map((logo) => `${logo.slug} (${logo.name})`)
      .join(", ")}.`,
    '- When a node is about one of these technologies, set its icon to { "slug": "<slug>" } with a slug from this list exactly. Leave icon off every other node. Never invent a slug.',
  ].join("\n");
}

/**
 * Place the user's named logos on the nodes whose labels name them and drop
 * logos for technologies the user never named, before the build.
 */
function groundSpecIcons(
  input: StudioBuildFlowchartInput,
  logos: readonly OfferedLogo[],
): {
  readonly input: StudioBuildFlowchartInput;
  readonly issues: CodeModeIssue[];
} {
  const offered = new Set(logos.map((logo) => logo.slug));
  const issues: CodeModeIssue[] = input.spec.nodes.flatMap((node) =>
    node.icon && !offered.has(normalizeIconSlug(node.icon.slug))
      ? [
          {
            code: "unknown_icon" as const,
            severity: "warning" as const,
            stage: "input" as const,
            ref: {
              kind: "node" as const,
              id: node.id,
              path: "nodes.icon.slug",
            },
            message: `Icon "${node.icon.slug}" on node "${node.id}" is not a technology the user named; the node renders without a logo.`,
            hint: "Only use logos from the NODE LOGOS list.",
          },
        ]
      : [],
  );
  const placement = placeNodeLogos(
    input.spec.nodes.map((node) =>
      node.icon
        ? { ...node, icon: { slug: normalizeIconSlug(node.icon.slug) } }
        : node,
    ),
    logos,
  );
  return placement.diagnostics.length > 0 || issues.length > 0
    ? {
        input: { ...input, spec: { ...input.spec, nodes: placement.nodes } },
        issues,
      }
    : { input, issues };
}

function attemptLimitResult(): BuildFlowchartResult {
  return {
    ok: false,
    status: "quality_failed",
    issues: [
      {
        code: "quality_below_threshold",
        severity: "error",
        stage: "quality",
        ref: { kind: "request", path: "spec" },
        message: "The diagram still needs changes before it can be shared.",
        hint: "Explain that the draft needs another pass and invite the user to simplify or clarify the flow.",
      },
    ],
  };
}

export interface StudioFlowchartToolExecutor<E = never, R = never> {
  readonly attempts: Effect.Effect<number>;
  readonly execute: (
    input: StudioBuildFlowchartInput,
  ) => Effect.Effect<BuildFlowchartResult, E, R>;
}

/**
 * Per-agent-turn guard around the canonical runtime. Studio owns only the
 * attempt budget and artifact options; validation, quality, rendering,
 * exporting, and persistence remain the shared buildFlowchart vertical.
 */
export function makeStudioFlowchartToolExecutor<E, R>(
  buildFlowchart: (input: unknown) => Effect.Effect<BuildFlowchartResult, E, R>,
  maxAttempts = MAX_FLOWCHART_BUILD_ATTEMPTS,
  logos: readonly OfferedLogo[] = [],
): Effect.Effect<StudioFlowchartToolExecutor<E, R>> {
  return Effect.gen(function* () {
    const semaphore = yield* Semaphore.make(1);
    const state = yield* Ref.make<{
      attempts: number;
      accepted?: Extract<BuildFlowchartResult, { ok: true }>;
    }>({ attempts: 0 });

    const execute = Effect.fn("playground.chat.buildFlowchart.execute")(
      (input: StudioBuildFlowchartInput) =>
        semaphore.withPermit(
          Effect.gen(function* () {
            const current = yield* Ref.get(state);
            if (current.accepted) {
              return current.accepted;
            }
            if (current.attempts >= maxAttempts) {
              return attemptLimitResult();
            }

            const attempt = current.attempts + 1;
            if (attempt > 1) {
              yield* recordMetric(studioFlowchartRetries, 1, {
                operation: "buildFlowchart",
                retryKind: "repair",
                surface: "chat",
              });
              yield* Effect.logInfo("Retrying Studio flowchart repair", {
                attempt,
                operation: "buildFlowchart",
                retry_kind: "repair",
                surface: "chat",
              });
            }

            yield* Ref.update(state, (value) => ({
              ...value,
              attempts: value.attempts + 1,
            }));
            const grounded = groundSpecIcons(input, logos);
            const built = yield* buildFlowchart({
              ...grounded.input,
              options: STUDIO_FLOWCHART_ARTIFACT_OPTIONS,
            });
            const result: BuildFlowchartResult =
              grounded.issues.length > 0
                ? { ...built, issues: [...grounded.issues, ...built.issues] }
                : built;
            if (result.ok) {
              yield* Ref.update(state, (value) => ({
                ...value,
                accepted: result,
              }));
            }
            return result;
          }),
        ),
    );

    return {
      attempts: Ref.get(state).pipe(Effect.map((value) => value.attempts)),
      execute,
    };
  });
}
