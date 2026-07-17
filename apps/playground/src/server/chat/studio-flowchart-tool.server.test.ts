import { describe, expect, it } from "vitest";

import {
  BuildFlowchartRequestSchema,
  createCodeModeRuntime,
  createMemoryArtifactStore,
  type BuildFlowchartResult,
  type CodeModeArtifactStore,
  type FlowchartSpec,
} from "@sketchi/diagram-agent";

import { createStudioFlowchartToolExecutor } from "./studio-flowchart-tool.server";

function acceptedSpec(): FlowchartSpec {
  return {
    id: "release-review-loop",
    title: "Release review loop",
    nodes: [
      { id: "start", kind: "start", label: "Open release" },
      { id: "review", kind: "decision", label: "Release ready?" },
      { id: "publish", kind: "process", label: "Publish release" },
      { id: "revise", kind: "process", label: "Revise release" },
      { id: "done", kind: "end", label: "Release live" },
    ],
    edges: [
      { id: "start-review", source: "start", target: "review" },
      {
        id: "review-publish",
        label: "yes",
        source: "review",
        target: "publish",
      },
      {
        id: "review-revise",
        label: "no",
        source: "review",
        target: "revise",
      },
      { id: "revise-review", source: "revise", target: "review" },
      { id: "publish-done", source: "publish", target: "done" },
    ],
    layout: { direction: "TB" },
    style: { accentColor: "#8f707f", backgroundColor: "#fffdf8" },
  };
}

function rejectedSpec(): FlowchartSpec {
  const spec = acceptedSpec();
  return {
    ...spec,
    edges: spec.edges.filter((edge) => edge.id !== "review-revise"),
  };
}

function countingStore() {
  const memory = createMemoryArtifactStore();
  let writes = 0;
  const store: CodeModeArtifactStore = {
    read: (artifactId, format) => memory.read(artifactId, format),
    readManifest: (artifactId) => memory.readManifest(artifactId),
    async write(input) {
      writes += 1;
      return memory.write(input);
    },
  };
  return { store, writes: () => writes };
}

function deterministicRuntime(store: CodeModeArtifactStore) {
  return createCodeModeRuntime({
    createId: (prefix) => `${prefix}_fixed`,
    store,
  });
}

function deferred<T>() {
  let resolve: (value: T | PromiseLike<T>) => void = () => undefined;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

const repairResult: BuildFlowchartResult = {
  ok: false,
  status: "invalid_flowchart",
  issues: [
    {
      code: "underbranched_decision",
      severity: "error",
      stage: "flowchart",
      ref: { kind: "node", id: "review", path: "spec.nodes[1]" },
      message: "Decision review must have at least two outgoing branches.",
      hint: "Add another labeled branch from this decision.",
    },
  ],
};

describe("Studio build_flowchart host", () => {
  it("injects artifact options instead of exposing them to the model", async () => {
    let request:
      | ReturnType<typeof BuildFlowchartRequestSchema.parse>
      | undefined;
    const executor = createStudioFlowchartToolExecutor(async (input) => {
      request = BuildFlowchartRequestSchema.parse(input);
      return repairResult;
    });

    await executor.execute({ requestId: "studio-run", spec: rejectedSpec() });

    expect(request).toMatchObject({
      options: {
        artifactFormats: ["scene", "excalidraw"],
        inlineArtifacts: ["scene"],
      },
      requestId: "studio-run",
    });
  });

  it("returns deterministic structured canonical issues for rejected flows", async () => {
    const firstStore = countingStore();
    const secondStore = countingStore();
    const first = await createStudioFlowchartToolExecutor(
      deterministicRuntime(firstStore.store).buildFlowchart,
    ).execute({ spec: rejectedSpec() });
    const second = await createStudioFlowchartToolExecutor(
      deterministicRuntime(secondStore.store).buildFlowchart,
    ).execute({ spec: rejectedSpec() });

    expect(second).toEqual(first);
    expect(first).toMatchObject({
      ok: false,
      status: "invalid_flowchart",
      issues: expect.arrayContaining([
        expect.objectContaining({
          code: "underbranched_decision",
          ref: expect.objectContaining({ id: "review", kind: "node" }),
          severity: "error",
          stage: "flowchart",
        }),
      ]),
    });
    expect(firstStore.writes()).toBe(0);
    expect(secondStore.writes()).toBe(0);
  });

  it("persists one canonical artifact and reuses it after acceptance", async () => {
    const counted = countingStore();
    const executor = createStudioFlowchartToolExecutor(
      deterministicRuntime(counted.store).buildFlowchart,
    );

    const first = await executor.execute({ spec: acceptedSpec() });
    const duplicate = await executor.execute({ spec: acceptedSpec() });

    expect(first).toMatchObject({
      ok: true,
      status: "accepted",
      artifact: {
        artifactId: "artifact_fixed",
        formats: [
          expect.objectContaining({
            format: "scene",
            inline: expect.anything(),
          }),
          expect.objectContaining({ format: "excalidraw" }),
        ],
      },
    });
    expect(duplicate).toEqual(first);
    expect(executor.attempts).toBe(1);
    expect(counted.writes()).toBe(1);
  });

  it("serializes concurrent accepted calls and persists only the first artifact", async () => {
    const counted = countingStore();
    const runtime = deterministicRuntime(counted.store);
    const started = deferred<void>();
    const release = deferred<void>();
    let runtimeCalls = 0;
    const executor = createStudioFlowchartToolExecutor(async (input) => {
      runtimeCalls += 1;
      started.resolve(undefined);
      await release.promise;
      return runtime.buildFlowchart(input);
    });

    const firstPromise = executor.execute({
      requestId: "accepted-first",
      spec: acceptedSpec(),
    });
    const queuedPromise = executor.execute({
      requestId: "accepted-queued",
      spec: acceptedSpec(),
    });

    await started.promise;
    expect(runtimeCalls).toBe(1);
    expect(executor.attempts).toBe(1);
    expect(counted.writes()).toBe(0);

    release.resolve(undefined);
    const [first, queued] = await Promise.all([firstPromise, queuedPromise]);

    expect(first).toMatchObject({ ok: true, status: "accepted" });
    expect(queued).toBe(first);
    expect(runtimeCalls).toBe(1);
    expect(executor.attempts).toBe(1);
    expect(counted.writes()).toBe(1);
  });

  it("serializes concurrent rejected calls and applies the cap in queue order", async () => {
    const started = deferred<void>();
    const release = deferred<void>();
    const requestIds: Array<string> = [];
    const executor = createStudioFlowchartToolExecutor(async (input) => {
      const request = BuildFlowchartRequestSchema.parse(input);
      requestIds.push(request.requestId ?? "missing-request-id");
      if (requestIds.length === 1) {
        started.resolve(undefined);
        await release.promise;
      }
      return repairResult;
    });

    const pending = ["repair-1", "repair-2", "repair-3", "past-cap"].map(
      (requestId) => executor.execute({ requestId, spec: rejectedSpec() }),
    );

    await started.promise;
    expect(requestIds).toEqual(["repair-1"]);
    expect(executor.attempts).toBe(1);

    release.resolve(undefined);
    const results = await Promise.all(pending);

    expect(requestIds).toEqual(["repair-1", "repair-2", "repair-3"]);
    expect(results.slice(0, 3)).toEqual([
      repairResult,
      repairResult,
      repairResult,
    ]);
    expect(results[3]).toMatchObject({
      ok: false,
      status: "quality_failed",
    });
    expect(executor.attempts).toBe(3);
  });

  it("caps rejected repair attempts at three without invoking the runtime again", async () => {
    let calls = 0;
    const executor = createStudioFlowchartToolExecutor(async () => {
      calls += 1;
      return repairResult;
    });

    await executor.execute({ spec: rejectedSpec() });
    await executor.execute({ spec: rejectedSpec() });
    await executor.execute({ spec: rejectedSpec() });
    const capped = await executor.execute({ spec: acceptedSpec() });

    expect(calls).toBe(3);
    expect(executor.attempts).toBe(3);
    expect(capped).toMatchObject({
      ok: false,
      status: "quality_failed",
      issues: [
        expect.objectContaining({
          message: "Flowchart was not accepted within 3 attempts.",
        }),
      ],
    });
  });
});
