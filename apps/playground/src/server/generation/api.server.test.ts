import type {
  CloudflareAiGateway,
  CloudflareAiGatewayProvider,
} from "@sketchi/diagram-generation";
import { describe, expect, it } from "vitest";

import type { StudioEnv } from "../bindings/studio-env.server";
import { runPlaygroundEffect } from "../runtime/runtime.server";
import { handleGenerateDiagramRequest } from "./api.server";

const flowchartIr = {
  id: "generated-release-flow",
  title: "Generated release flow",
  type: "flowchart",
  nodes: [
    { id: "start", label: "Change proposed", kind: "start" },
    { id: "review", label: "Review evidence", kind: "process" },
    { id: "decision", label: "Evidence complete?", kind: "decision" },
    { id: "approve", label: "Approve release", kind: "process" },
    { id: "revise", label: "Request revision", kind: "process" },
    { id: "end", label: "Release recorded", kind: "end" },
  ],
  edges: [
    { id: "e1", source: "start", target: "review" },
    { id: "e2", source: "review", target: "decision" },
    { id: "e3", source: "decision", target: "approve", label: "Complete" },
    { id: "e4", source: "decision", target: "revise", label: "Incomplete" },
    { id: "e5", source: "approve", target: "end" },
    { id: "e6", source: "revise", target: "end" },
  ],
  layout: { direction: "TB", edgeRouting: "orthogonal" },
  style: { accentColor: "#0f766e", backgroundColor: "#ffffff" },
};

const sequenceIr = {
  id: "generated-login-sequence",
  title: "Login sequence",
  type: "sequence",
  participants: [
    { id: "browser", label: "Browser" },
    { id: "api", label: "API" },
    { id: "database", label: "Database" },
  ],
  messages: [
    {
      id: "login",
      source: "browser",
      target: "api",
      label: "Login request",
    },
    {
      id: "lookup",
      source: "api",
      target: "database",
      label: "Look up user",
    },
    {
      id: "record",
      source: "database",
      target: "api",
      label: "User record",
      type: "return",
    },
  ],
};

function fakeAiGateway(
  text: string,
  observeRun?: (input: Parameters<CloudflareAiGateway["run"]>[0]) => void,
): CloudflareAiGatewayProvider {
  return {
    gateway: () => ({
      run: (input) => {
        observeRun?.(input);
        return Promise.resolve(
          new Response(
            JSON.stringify({
              candidates: [{ content: { parts: [{ text }] } }],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        );
      },
      getUrl: () => Promise.resolve("https://gateway.invalid"),
    }),
  };
}

function testBoundary(env: StudioEnv, request: Request) {
  return {
    env,
    request,
    platform: {
      waitUntilPromise: (promise: Promise<unknown>) => {
        void promise;
      },
    },
  };
}

function generateRequest(env: StudioEnv, body: unknown): Promise<Response> {
  const request = new Request(
    "https://playground.sketchi.app/api/v1/generate",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  return runPlaygroundEffect(
    handleGenerateDiagramRequest(request),
    testBoundary(env, request),
  );
}

describe("public generate endpoint", () => {
  it("generates and returns a built flowchart with inline artifacts", async () => {
    const env: StudioEnv = { AI: fakeAiGateway(JSON.stringify(flowchartIr)) };
    const response = await generateRequest(env, {
      prompt: "Map release approval with pass and revise branches",
      type: "flowchart",
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.ok).toBe(true);
    expect(body.status).toBe("generated");
    const diagram = body.diagram as Record<string, unknown>;
    const document = diagram.document as { type: string };
    expect(document.type).toBe("flowchart");
    expect(diagram.scene).toBeTruthy();
    expect(diagram.excalidraw).toBeTruthy();
    const generation = body.generation as { provider: string };
    expect(generation.provider).toBe("cloudflare-google-ai-studio");
  });

  it("generates and returns a native sequence with inline artifacts", async () => {
    const env: StudioEnv = { AI: fakeAiGateway(JSON.stringify(sequenceIr)) };
    const response = await generateRequest(env, {
      prompt: "Show Browser, API, and Database login interactions",
      type: "sequence",
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    const diagram = body.diagram as Record<string, unknown>;
    const document = diagram.document as {
      type: string;
      spec: {
        participants: ReadonlyArray<unknown>;
        messages: ReadonlyArray<unknown>;
      };
    };
    expect(document.type).toBe("sequence");
    expect(document.spec.participants).toHaveLength(3);
    expect(document.spec.messages).toHaveLength(3);
    expect(diagram.scene).toBeTruthy();
    expect(diagram.excalidraw).toBeTruthy();
  });

  it("requests fresh provider output for reliability probes", async () => {
    const observedRuns: Array<Parameters<CloudflareAiGateway["run"]>[0]> = [];
    const env: StudioEnv = {
      AI: fakeAiGateway(JSON.stringify(flowchartIr), (input) => {
        observedRuns.push(input);
      }),
    };
    const response = await generateRequest(env, {
      cacheMode: "fresh",
      prompt: "Map release approval with pass and revise branches",
      type: "flowchart",
    });

    expect(response.status).toBe(200);
    expect(observedRuns).toHaveLength(1);
    expect(observedRuns[0]).toEqual(
      expect.objectContaining({
        headers: expect.objectContaining({
          "Cache-Control": "no-store",
          "cf-aig-skip-cache": "true",
          Pragma: "no-cache",
        }),
      }),
    );
  });

  it("rejects an empty prompt with a typed invalid-input contract", async () => {
    const env: StudioEnv = { AI: fakeAiGateway(JSON.stringify(flowchartIr)) };
    const response = await generateRequest(env, { prompt: "   " });

    expect(response.status).toBe(400);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.ok).toBe(false);
    expect(body.status).toBe("invalid_input");
  });

  it("reports a provider failure when the AI binding is missing", async () => {
    const response = await generateRequest({}, { prompt: "Any diagram" });

    expect(response.status).toBe(502);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.ok).toBe(false);
    expect(body.status).toBe("provider_failed");
  });

  it("rejects a generated diagram whose type does not match the request", async () => {
    const env: StudioEnv = { AI: fakeAiGateway(JSON.stringify(flowchartIr)) };
    const response = await generateRequest(env, {
      prompt: "Organize launch readiness",
      type: "mindmap",
    });

    expect(response.status).toBe(422);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.status).toBe("invalid_generated_document");
  });

  it("treats non-JSON model output as malformed output", async () => {
    const env: StudioEnv = { AI: fakeAiGateway("not a diagram") };
    const response = await generateRequest(env, {
      prompt: "Map a flow",
      type: "flowchart",
    });

    expect(response.status).toBe(422);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.status).toBe("malformed_output");
  });

  it("returns bounded validator diagnostics for malformed diagrams", async () => {
    const invalidFlowchart = {
      ...flowchartIr,
      edges: [
        ...flowchartIr.edges.map((edge) =>
          edge.id === "e4" ? { ...edge, label: "Complete" } : edge,
        ),
        { id: "end-retry", source: "end", target: "review" },
      ],
    };
    const env: StudioEnv = {
      AI: fakeAiGateway(JSON.stringify(invalidFlowchart)),
    };
    const response = await generateRequest(env, {
      prompt: "Map a release flow with a retry loop",
      type: "flowchart",
    });

    expect(response.status).toBe(422);
    const body = (await response.json()) as {
      status: string;
      issues: ReadonlyArray<{ message: string }>;
    };
    expect(body.status).toBe("malformed_output");
    expect(body.issues.length).toBeGreaterThan(1);
    expect(body.issues.length).toBeLessThanOrEqual(8);
    expect(body.issues.map((entry) => entry.message).join("\n")).toContain(
      "end_has_outgoing",
    );
  });
});
