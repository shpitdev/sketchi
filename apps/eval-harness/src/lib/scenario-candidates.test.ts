import { describe, expect, it, vi } from "vitest";

import type { EvalHarnessEnv } from "./generate-scenario";
import { Route } from "../routes/api/scenario-candidates";

const { bindings } = vi.hoisted(() => {
  const bindings: EvalHarnessEnv = {};
  return { bindings };
});
vi.mock("./cloudflare-bindings.server", () => ({
  getEvalHarnessBindings: () => bindings,
}));

async function post(request: Request) {
  const handlers = Route.options.server?.handlers;
  if (!handlers || typeof handlers === "function" || !handlers.POST) {
    throw new Error("Expected a POST handler for scenario candidates.");
  }
  const response = await handlers.POST({
    context: undefined,
    params: {},
    pathname: "/api/scenario-candidates",
    request,
    next: () => {
      throw new Error("The POST handler must return its own response.");
    },
  });
  if (!(response instanceof Response)) {
    throw new Error("Expected the POST handler to return a Response.");
  }
  return response;
}

function scenarioRequest(input: unknown, signal?: AbortSignal) {
  return new Request("https://eval.test/api/scenario-candidates", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
    ...(signal ? { signal } : {}),
  });
}

describe("scenario candidates HTTP adapter", () => {
  it("returns 400 with Standard Schema issue paths and a string error", async () => {
    const response = await post(
      scenarioRequest({ providers: ["invalid"], scenarioId: "scenario" }),
    );
    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(typeof payload.error).toBe("string");
    expect(JSON.parse(payload.error)).toEqual([
      { path: ["providers", 0], message: expect.any(String) },
    ]);
  });

  it("returns 200 with the existing missing-binding candidate shape", async () => {
    const response = await post(
      scenarioRequest({ scenarioId: "sketchi-onboarding-decision-flow" }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      scenarioId: "sketchi-onboarding-decision-flow",
      candidates: [
        {
          diagramValid: false,
          provider: "cloudflare-google-ai-studio",
          error: expect.any(String),
        },
      ],
    });
  });

  it("cancels an in-flight gateway call when the HTTP request is aborted", async () => {
    const started = Promise.withResolvers<AbortSignal>();
    const controller = new AbortController();
    // A distinct bindings object keeps this request isolated from the no-AI runtime.
    const provider: EvalHarnessEnv = {
      AI: {
        gateway: () => ({
          getUrl: vi.fn(),
          run: (_data, options) =>
            new Promise<Response>((_resolve, reject) => {
              const signal = options?.signal;
              if (!signal)
                return reject(new Error("Missing upstream AbortSignal."));
              signal.addEventListener("abort", () => reject(signal.reason), {
                once: true,
              });
              started.resolve(signal);
            }),
        }),
      },
    };
    const bindingModule = await import("./cloudflare-bindings.server");
    const bindingSpy = vi
      .spyOn(bindingModule, "getEvalHarnessBindings")
      .mockReturnValue(provider);
    try {
      const responsePromise = post(
        scenarioRequest(
          { scenarioId: "sketchi-onboarding-decision-flow" },
          controller.signal,
        ),
      );
      const upstreamSignal = await started.promise;
      controller.abort();
      await responsePromise;
      expect(upstreamSignal.aborted).toBe(true);
    } finally {
      bindingSpy.mockRestore();
    }
  });
});
