import { describe, expect, it } from "@effect/vitest";
import { parseFlowchartDiagram } from "@sketchi/diagram-core";
import { Effect } from "effect";

import type {
  DiagramGenerationCandidate,
  DiagramGenerationRequest,
} from "./candidates.js";
import { runDiagramGenerationWithPolicy } from "./policy.js";

const request: DiagramGenerationRequest = {
  model: "fixture-model",
  prompt: {
    id: "refund-flow",
    request: "Draw the refund approval flow.",
    requestedType: "flowchart",
  },
};
const acceptedDiagram = parseFlowchartDiagram({
  id: "refund-flow",
  title: "Refund approval",
  type: "flowchart",
  nodes: [
    { id: "start", kind: "start", label: "Receive return" },
    { id: "approve", kind: "process", label: "Approve refund" },
    { id: "done", kind: "end", label: "Refund issued" },
  ],
  edges: [
    { id: "start-approve", source: "start", target: "approve" },
    { id: "approve-done", source: "approve", target: "done" },
  ],
});
const currentIssue =
  'flowchart.underbranched_decision: Decision node "approve" needs two branches.';

function runRepairs(initialDiagnostics: string[]) {
  const requests: DiagramGenerationRequest[] = [];
  const candidates: DiagramGenerationCandidate[] = [
    {
      provider: "fixture",
      model: request.model,
      text: "initial invalid output",
      diagnostics: initialDiagnostics,
    },
    {
      provider: "fixture",
      model: request.model,
      text: "latest invalid output",
      diagnostics: [currentIssue],
    },
    {
      provider: "fixture",
      model: request.model,
      text: JSON.stringify(acceptedDiagram),
      diagram: acceptedDiagram,
      diagnostics: [],
    },
  ];
  const prepareAttempt = Effect.fn("diagramGeneration.test.prepareAttempt")(
    function* (callRequest: DiagramGenerationRequest) {
      const candidate = candidates[requests.length];
      if (!candidate) {
        throw new Error("Unexpected generation attempt.");
      }
      requests.push(callRequest);
      return yield* Effect.succeed(Effect.succeed(candidate));
    },
  );
  return runDiagramGenerationWithPolicy(prepareAttempt, request, "fixture", {
    concurrency: 1,
    maxRepairAttempts: 2,
    maxRetries: 0,
    requestTimeoutMs: 1_000,
    retryDelayMs: 1,
  }).pipe(Effect.map((candidate) => ({ candidate, requests })));
}

describe("generation repair prompts", () => {
  for (const initialDiagnostics of [
    ["output_truncated: Regenerate the complete diagram."],
    [
      "flowchart.self_loop: Reroute the retry edge.",
      "flowchart.start_has_incoming: Reroute the loop-back edge.",
    ],
  ]) {
    it.effect(
      `uses only the latest diagnostics after ${initialDiagnostics[0]}`,
      () =>
        Effect.gen(function* () {
          const { candidate, requests } = yield* runRepairs(initialDiagnostics);
          expect(requests).toHaveLength(3);
          const repair = requests[2];
          expect(repair?.cacheMode).toBe("fresh");
          expect(repair?.prompt.request).toContain(
            `Validator diagnostics:\n- ${currentIssue}`,
          );
          expect(repair?.prompt.request).toContain("latest invalid output");
          for (const staleIssue of initialDiagnostics) {
            expect(repair?.prompt.request).not.toContain(staleIssue);
          }
          expect(repair?.prompt.request).not.toMatch(
            /repair_attempted:|repair_failed:|Priority validator issue|Required correction/,
          );
          expect(candidate.diagram).toEqual(acceptedDiagram);
          expect(candidate.diagnostics).toEqual([
            ...initialDiagnostics,
            expect.stringContaining("repair_attempted:"),
            currentIssue,
            "repair_failed: semantic repair attempt 1 failed.",
            expect.stringContaining("repair_attempted:"),
            "repair_succeeded: semantic repair attempt 2 succeeded.",
          ]);
        }),
    );
  }

  it.effect("includes the original scenario once in each repair prompt", () =>
    Effect.gen(function* () {
      const { requests } = yield* runRepairs([
        "flowchart.self_loop: Retry edge.",
      ]);
      for (const repair of requests.slice(1)) {
        expect(
          repair.prompt.request.split(request.prompt.request),
        ).toHaveLength(2);
        expect(repair.prompt.request).toContain(
          `- Original scenario: ${request.prompt.request}`,
        );
      }
    }),
  );
});
