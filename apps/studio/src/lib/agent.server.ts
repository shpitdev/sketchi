import "@tanstack/react-start/server-only";

import { createGoogleGenerativeAI } from "@ai-sdk/google";
import {
  CREATE_DIAGRAM_TOOL_DESCRIPTION,
  CREATE_DIAGRAM_TOOL_NAME,
  createDiagramToolSession,
  type CodeModeObjectBucket,
  DIAGRAM_AGENT_SYSTEM_PROMPT,
  DIAGRAM_AGENT_TEMPERATURE,
  DiagramToolInputSchema,
  MAX_AGENT_OUTPUT_TOKENS,
  MAX_AGENT_STEPS,
} from "@sketchi/diagram-agent";
import type { CloudflareAiGatewayProvider } from "@sketchi/diagram-generation";
import {
  convertToModelMessages,
  stepCountIs,
  streamText,
  tool,
  type UIMessage,
} from "ai";

import type { CloudflareBrowserRunBinding } from "./codemode-browser-renderer.server";

/**
 * Studio route adapter for the diagram agent. The generation runtime —
 * prompt policy, tool contract, normalization, grading, attempt limits —
 * lives in `@sketchi/diagram-agent`; this file only wires it into AI SDK
 * streaming over the Cloudflare AI Gateway.
 *
 * The Workers `env.AI` binding stays the single auth path (gateway-stored
 * provider keys, no local secrets); a fetch shim translates the google
 * provider's HTTP requests into `gateway.run()` calls.
 */

export interface StudioEnv {
  AI?: CloudflareAiGatewayProvider;
  BROWSER?: CloudflareBrowserRunBinding;
  LOADER?: unknown;
  SKETCHI_ARTIFACTS?: CodeModeObjectBucket;
  SKETCHI_AI_GATEWAY_ID?: string;
  SKETCHI_AI_MODEL?: string;
  SKETCHI_RENDER_ASSET_ORIGIN?: string;
}

const DEFAULT_GATEWAY_ID = "google-ai-studio";
const DEFAULT_MODEL = "google/gemini-3.1-flash-lite";

/** Never fetched — exists only so the shim can split off the request path. */
const SHIM_BASE_URL = "https://sketchi-gateway.invalid/v1beta";

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

function stripGoogleModelPrefix(model: string): string {
  return model.replace(/^google-ai-studio\//, "").replace(/^google\//, "");
}

function createStudioModel(env: StudioEnv) {
  if (!env.AI) {
    throw new Error(
      "AI binding is not configured in this Worker environment (env.AI).",
    );
  }

  const gateway = env.AI.gateway(
    envString(env, "SKETCHI_AI_GATEWAY_ID", DEFAULT_GATEWAY_ID),
  );
  const modelId = stripGoogleModelPrefix(
    envString(env, "SKETCHI_AI_MODEL", DEFAULT_MODEL),
  );

  const gatewayFetch: typeof fetch = async (input, init) => {
    const url = new URL(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url,
    );
    const body =
      typeof init?.body === "string" ? JSON.parse(init.body) : undefined;

    return gateway.run(
      {
        endpoint: `${url.pathname.replace(/^\//, "")}${url.search}`,
        provider: "google-ai-studio",
        headers: { "Content-Type": "application/json" },
        query: body,
      },
      {
        gateway: {
          collectLog: true,
          metadata: { sketchiSurface: "studio-agent" },
        },
      },
    );
  };

  const provider = createGoogleGenerativeAI({
    // Real auth is the gateway's stored provider key (BYOK); the shim drops
    // this placeholder header before the request leaves the Worker.
    apiKey: "managed-by-cloudflare-gateway",
    baseURL: SHIM_BASE_URL,
    fetch: gatewayFetch,
  });

  return provider(modelId);
}

function buildAgentTools() {
  const session = createDiagramToolSession();

  return {
    [CREATE_DIAGRAM_TOOL_NAME]: tool({
      description: CREATE_DIAGRAM_TOOL_DESCRIPTION,
      inputSchema: DiagramToolInputSchema,
      execute: (input) => Promise.resolve(session.evaluate(input).report),
    }),
  };
}

export async function runStudioAgent(
  env: StudioEnv,
  messages: UIMessage[],
): Promise<Response> {
  const result = streamText({
    model: createStudioModel(env),
    system: DIAGRAM_AGENT_SYSTEM_PROMPT,
    messages: await convertToModelMessages(messages),
    tools: buildAgentTools(),
    stopWhen: stepCountIs(MAX_AGENT_STEPS),
    maxOutputTokens: MAX_AGENT_OUTPUT_TOKENS,
    temperature: DIAGRAM_AGENT_TEMPERATURE,
  });

  return result.toUIMessageStreamResponse({
    sendReasoning: true,
    onError: (error) =>
      error instanceof Error ? error.message : "The agent run failed.",
  });
}
