import { describe, expect, it } from "vitest";
import type { BuildFlowchartResult } from "@sketchi/diagram-agent";
import type { UIMessage } from "ai";
import {
  buildResultOf,
  deriveBuildState,
  type FlowchartToolPart,
} from "./build-result";
import {
  DEPLOY_PIPELINE_SCENE,
  DEPLOY_PIPELINE_SPEC,
} from "./deploy-pipeline-sample";

function pendingMessage(id: string): UIMessage {
  return {
    id,
    role: "assistant",
    parts: [
      {
        type: "tool-build_flowchart",
        toolCallId: id,
        state: "input-available",
        input: { spec: DEPLOY_PIPELINE_SPEC },
      },
    ],
  };
}

describe("build result selectors", () => {
  it.each([false, true])(
    "ignores an earlier unfinished call when busy=%s",
    (busy) => {
      const latest: UIMessage = {
        id: "latest",
        role: "assistant",
        parts: [{ type: "text", text: "Done" }],
      };
      const state = deriveBuildState([pendingMessage("stopped"), latest], busy);
      expect(state.activePart).toBeUndefined();
      expect(state.ghostLabels).toEqual([]);
    },
  );
  it("clears the active stage when a call stops or fails", () => {
    expect(
      deriveBuildState([pendingMessage("stopped")], false).activePart,
    ).toBeUndefined();
    expect(
      deriveBuildState([pendingMessage("stopped")], false).ghostLabels,
    ).toEqual([]);
  });
  it("uses the latest assistant's active input during a new run", () => {
    const state = deriveBuildState(
      [pendingMessage("old"), pendingMessage("new")],
      true,
    );
    expect(state.activePart?.toolCallId).toBe("new");
    expect(state.ghostLabels).toEqual(
      DEPLOY_PIPELINE_SPEC.nodes.map((node) => node.label),
    );
  });
  it("rejects malformed accepted payloads before selecting formats", () => {
    const part: FlowchartToolPart = {
      type: "tool-build_flowchart",
      toolCallId: "bad",
      state: "output-available",
      output: {
        ok: true,
        status: "accepted",
        buildId: "bad",
        issues: [],
        normalizedSpec: {},
        quality: {},
        artifact: {},
      },
    };
    expect(buildResultOf(part)).toBeUndefined();
  });
  it("retains the latest accepted scene and downloads when a newer build fails", () => {
    const accepted = {
      ok: true,
      status: "accepted",
      buildId: "accepted",
      issues: [],
      normalizedSpec: {
        ...DEPLOY_PIPELINE_SPEC,
        id: "pipeline",
        edges: DEPLOY_PIPELINE_SPEC.edges.map((edge, index) => ({
          ...edge,
          id: `edge-${index}`,
        })),
      },
      quality: {
        accepted: true,
        checks: [],
        score: 9,
        threshold: 8,
        summary: { nodeCount: 4, edgeCount: 3 },
      },
      artifact: {
        artifactId: "artifact with space",
        diagramId: "pipeline",
        formats: [
          {
            format: "scene",
            mimeType: "application/json",
            inline: DEPLOY_PIPELINE_SCENE,
          },
          { format: "excalidraw", mimeType: "application/json" },
        ],
      },
    } satisfies BuildFlowchartResult;
    const message: UIMessage = {
      id: "builds",
      role: "assistant",
      parts: [
        {
          type: "tool-build_flowchart",
          toolCallId: "accepted",
          state: "output-available",
          input: {},
          output: accepted,
        },
        {
          type: "tool-build_flowchart",
          toolCallId: "failed",
          state: "output-available",
          input: {},
          output: { ok: false, status: "quality_failed", issues: [] },
        },
      ],
    };
    const state = deriveBuildState([message], false);
    expect(state.displayResult).toMatchObject({
      ok: false,
      status: "quality_failed",
    });
    expect(state.acceptedResult?.ok).toBe(true);
    expect(state.scene).toEqual(DEPLOY_PIPELINE_SCENE);
    expect(state.artifact?.editUrl).toBe(
      "/artifacts/artifact%20with%20space/edit",
    );
    expect(state.activePart).toBeUndefined();
  });

  it("decodes a valid rejected result", () => {
    expect(
      buildResultOf({
        type: "tool-build_flowchart",
        toolCallId: "rejected",
        state: "output-available",
        output: { ok: false, status: "storage_failed", issues: [] },
      }),
    ).toMatchObject({ ok: false, status: "storage_failed" });
  });
});
