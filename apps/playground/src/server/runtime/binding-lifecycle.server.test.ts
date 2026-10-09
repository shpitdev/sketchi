import type { CloudflareAiGatewayProvider } from "@sketchi/diagram-generation";
import { MemoryStudioObjectBucket } from "@sketchi/studio-projects/server";
import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";

import type { StudioEnv } from "../bindings/studio-env.server";
import { PlaygroundCodeMode } from "../codemode/service.server";
import { PlaygroundGeneration } from "../generation/service.server";
import {
  handleCreateStudioProjectFromArtifactRequest,
  handleListStudioProjectsRequest,
} from "../studio/projects.server";
import { makePlaygroundRuntime } from "./runtime.server";

const lifecycle = vi.hoisted(() => ({
  generationBuilt: 0,
  generationClosed: 0,
  studioBuilt: 0,
  studioClosed: 0,
}));

vi.mock("@sketchi/diagram-generation", async (importOriginal) => {
  const { Effect, Layer } = await import("effect");
  const actual =
    await importOriginal<typeof import("@sketchi/diagram-generation")>();
  return {
    ...actual,
    CloudflareGoogleAiStudioClientLive:
      actual.CloudflareGoogleAiStudioClientLive.pipe(
        Layer.tap(() =>
          Effect.gen(function* () {
            lifecycle.generationBuilt += 1;
            yield* Effect.addFinalizer(() =>
              Effect.sync(() => {
                lifecycle.generationClosed += 1;
              }),
            );
          }),
        ),
      ),
  };
});

vi.mock("@sketchi/studio-projects/server", async (importOriginal) => {
  const { Effect, Layer } = await import("effect");
  const actual =
    await importOriginal<typeof import("@sketchi/studio-projects/server")>();
  return {
    ...actual,
    StudioProjectsLive: actual.StudioProjectsLive.pipe(
      Layer.tap(() =>
        Effect.gen(function* () {
          lifecycle.studioBuilt += 1;
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              lifecycle.studioClosed += 1;
            }),
          );
        }),
      ),
    ),
  };
});

function boundary(
  env: StudioEnv,
  request = new Request("https://studio.test/api/v1/generate"),
) {
  return { env, request, platform: { waitUntilPromise: () => undefined } };
}

function fakeAi(
  calls: { gatewayId: string; endpoint: string }[],
): CloudflareAiGatewayProvider {
  return {
    gateway: (gatewayId) => ({
      getUrl: () => Promise.resolve("https://gateway.invalid"),
      run: (input) => {
        calls.push({ gatewayId, endpoint: input.endpoint });
        // Permanent offline failure exercises client provisioning without retries or live AI.
        return Promise.resolve(new Response("unauthorized", { status: 401 }));
      },
    }),
  };
}

const generate = (model?: string) =>
  Effect.gen(function* () {
    const generation = yield* PlaygroundGeneration;
    return yield* Effect.result(
      generation.generate({
        prompt: "A release approval flow",
        ...(model ? { model } : {}),
      }),
    );
  });

describe("binding-dependent host lifecycles", () => {
  it("builds one generation client per AI binding/gateway and closes only with its host", async () => {
    const before = { ...lifecycle };
    const runtime = makePlaygroundRuntime();
    const calls: { gatewayId: string; endpoint: string }[] = [];
    const ai = fakeAi(calls);
    try {
      await Promise.all([
        runtime.run(
          generate(),
          boundary({
            AI: ai,
            SKETCHI_AI_GATEWAY_ID: " shared ",
            SKETCHI_AI_MODEL: "google/model-a",
          }),
        ),
        runtime.run(
          generate("google/model-b"),
          boundary({ AI: ai, SKETCHI_AI_GATEWAY_ID: "shared" }),
        ),
      ]);
      await runtime.run(
        generate(),
        boundary({ AI: ai, SKETCHI_AI_GATEWAY_ID: "shared" }),
      );
      expect(lifecycle.generationBuilt - before.generationBuilt).toBe(1);
      expect(lifecycle.generationClosed).toBe(before.generationClosed);
      expect(calls.map((call) => call.gatewayId)).toEqual([
        "shared",
        "shared",
        "shared",
      ]);
      expect(calls.map((call) => call.endpoint)).toEqual(
        expect.arrayContaining([
          "v1beta/models/model-a:generateContent",
          "v1beta/models/model-b:generateContent",
          "v1beta/models/gemini-3.1-flash-lite:generateContent",
        ]),
      );
      await runtime.run(
        generate(),
        boundary({ AI: ai, SKETCHI_AI_GATEWAY_ID: "other" }),
      );
      await runtime.run(
        generate(),
        boundary({ AI: fakeAi(calls), SKETCHI_AI_GATEWAY_ID: "shared" }),
      );
      expect(lifecycle.generationBuilt - before.generationBuilt).toBe(3);
      expect(lifecycle.generationClosed).toBe(before.generationClosed);
    } finally {
      await runtime.dispose();
    }
    expect(lifecycle.generationClosed - before.generationClosed).toBe(3);

    const nextHost = makePlaygroundRuntime();
    try {
      await nextHost.run(
        generate(),
        boundary({ AI: ai, SKETCHI_AI_GATEWAY_ID: "shared" }),
      );
      expect(lifecycle.generationBuilt - before.generationBuilt).toBe(4);
    } finally {
      await nextHost.dispose();
    }
    expect(lifecycle.generationClosed - before.generationClosed).toBe(4);
  });

  it("reuses Studio services per bucket while keeping request ownership and bucket data separate", async () => {
    const before = { ...lifecycle };
    const runtime = makePlaygroundRuntime();
    const firstBucket = new MemoryStudioObjectBucket();
    const secondBucket = new MemoryStudioObjectBucket();
    const env = { SKETCHI_ARTIFACTS: firstBucket };
    const list = (cookie: string, origin = "https://studio.test") =>
      new Request(`${origin}/api/studio/projects`, {
        headers: { Cookie: cookie },
      });
    const cookie = "sketchi_studio_session=anon_lifecycle_owner";
    try {
      const built = await runtime.run(
        Effect.gen(function* () {
          const codeMode = yield* PlaygroundCodeMode;
          return yield* codeMode.buildFlowchart({
            spec: {
              title: "Lifecycle source",
              nodes: [
                { id: "start", label: "Change proposed", kind: "start" },
                { id: "review", label: "Review evidence", kind: "process" },
                { id: "end", label: "Change recorded", kind: "end" },
              ],
              edges: [
                { source: "start", target: "review" },
                { source: "review", target: "end" },
              ],
            },
            options: { artifactFormats: ["scene"], inlineArtifacts: ["scene"] },
          });
        }),
        boundary(env),
      );
      if (!built.ok)
        throw new Error("Expected the offline artifact to be accepted.");
      const request = new Request(
        "https://first.test/api/studio/projects/from-artifact",
        {
          method: "POST",
          headers: { Cookie: cookie, "Content-Type": "application/json" },
          body: JSON.stringify({ artifactId: built.artifact.artifactId }),
        },
      );
      const created = await runtime.run(
        handleCreateStudioProjectFromArtifactRequest(request),
        boundary(env, request),
      );
      expect(created.status).toBe(200);
      const [first, second] = await Promise.all([
        runtime.run(
          handleListStudioProjectsRequest(list(cookie)),
          boundary({ ...env }, list(cookie)),
        ),
        runtime.run(
          handleListStudioProjectsRequest(list(cookie, "https://second.test")),
          boundary({ ...env }, list(cookie, "https://second.test")),
        ),
      ]);
      for (const response of [first, second]) {
        expect(await response.json()).toMatchObject({
          ok: true,
          projects: [{ title: "Lifecycle source" }],
        });
      }
      expect(lifecycle.studioBuilt - before.studioBuilt).toBe(1);
      expect(lifecycle.studioClosed).toBe(before.studioClosed);
      const otherOwner = list("sketchi_studio_session=anon_other_owner");
      const privateList = await runtime.run(
        handleListStudioProjectsRequest(otherOwner),
        boundary(env, otherOwner),
      );
      expect(await privateList.json()).toMatchObject({ projects: [] });
      const otherBucket = list(cookie);
      const isolated = await runtime.run(
        handleListStudioProjectsRequest(otherBucket),
        boundary({ SKETCHI_ARTIFACTS: secondBucket }, otherBucket),
      );
      expect(await isolated.json()).toMatchObject({ projects: [] });
      await Promise.all(
        [{}, {}].map((localEnv) => {
          const localRequest = list(cookie);
          return runtime.run(
            handleListStudioProjectsRequest(localRequest),
            boundary(localEnv, localRequest),
          );
        }),
      );
      expect(lifecycle.studioBuilt - before.studioBuilt).toBe(3);
      expect(lifecycle.studioClosed).toBe(before.studioClosed);
    } finally {
      await runtime.dispose();
    }
    expect(lifecycle.studioClosed - before.studioClosed).toBe(3);
  });
});
