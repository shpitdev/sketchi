import "@tanstack/react-start/server-only";

import { createGoogleGenerativeAI } from "@ai-sdk/google";
import {
  DIAGRAM_AGENT_SYSTEM_PROMPT,
  DIAGRAM_AGENT_TEMPERATURE,
  MAX_AGENT_OUTPUT_TOKENS,
  MAX_AGENT_STEPS,
} from "@sketchi/diagram-agent";
import {
  convertToModelMessages,
  stepCountIs,
  streamText,
  tool,
  type UIMessage,
} from "ai";

import type { StudioEnv } from "../bindings/studio-env.server";
import { createStudioCodeModeRuntime } from "../codemode/codemode-api.server";
import {
  createStudioFlowchartToolExecutor,
  STUDIO_BUILD_FLOWCHART_TOOL_DESCRIPTION,
  STUDIO_BUILD_FLOWCHART_TOOL_NAME,
  StudioBuildFlowchartInputSchema,
} from "./studio-flowchart-tool.server";

/**
 * Studio route adapter for the diagram agent. The generation runtime —
 * prompt policy and canonical buildFlowchart vertical live in
 * `@sketchi/diagram-agent`; this file only wires them into AI SDK streaming
 * over the Cloudflare AI Gateway and injects Studio's artifact host options.
 *
 * The Workers `env.AI` binding stays the single auth path (gateway-stored
 * provider keys, no local secrets); a fetch shim translates the google
 * provider's HTTP requests into `gateway.run()` calls.
 */

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

function buildAgentTools(env: StudioEnv, origin: string) {
  const runtime = createStudioCodeModeRuntime(env, { origin });
  const executor = createStudioFlowchartToolExecutor(runtime.buildFlowchart);

  return {
    [STUDIO_BUILD_FLOWCHART_TOOL_NAME]: tool({
      description: STUDIO_BUILD_FLOWCHART_TOOL_DESCRIPTION,
      inputSchema: StudioBuildFlowchartInputSchema,
      execute: (input) => executor.execute(input),
    }),
  };
}

export async function runStudioAgent(
  env: StudioEnv,
  messages: UIMessage[],
  origin: string,
): Promise<Response> {
  const result = streamText({
    model: createStudioModel(env),
    system: DIAGRAM_AGENT_SYSTEM_PROMPT,
    messages: await convertToModelMessages(messages),
    tools: buildAgentTools(env, origin),
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
