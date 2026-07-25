import { fireEvent, render, screen } from "@testing-library/react";
import type { BuildFlowchartResult } from "@sketchi/diagram-agent";
import {
  convertSceneToExcalidraw,
  validateExcalidrawScene,
} from "@sketchi/diagram-excalidraw";
import type { UIMessage } from "ai";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@sketchi/diagram-ui", () => ({
  DiagramPreview: ({ scene }: { scene: { diagramId: string } }) => (
    <div data-diagram-id={scene.diagramId} data-testid="diagram-preview" />
  ),
}));

import {
  ArtifactActions,
  AssistantFollowUp,
  BuildResultDetails,
  PlaygroundComposer,
  PlaygroundEmptyState,
  assistantAsksQuestion,
  type ReadyPlaygroundArtifact,
} from "./playground-surface";
import {
  DEPLOY_PIPELINE_SCENE,
  DEPLOY_PIPELINE_SPEC,
} from "./deploy-pipeline-sample";

const acceptedBuild = {
  artifact: {
    artifactId: "artifact_release",
    diagramId: "release",
    formats: [],
  },
  buildId: "build_release",
  issues: [],
  normalizedSpec: {
    edges: [{ id: "start-done", source: "start", target: "done" }],
    id: "release",
    layout: { direction: "TB" },
    nodes: [
      { id: "start", kind: "start", label: "Start" },
      { id: "done", kind: "end", label: "Done" },
    ],
    style: { accentColor: "#8f707f", backgroundColor: "#fffdf8" },
    title: "Release",
  },
  ok: true,
  quality: {
    accepted: true,
    checks: [],
    score: 9,
    summary: { edgeCount: 1, nodeCount: 2 },
    threshold: 8,
  },
  status: "accepted",
} satisfies BuildFlowchartResult;

const artifact = {
  artifactId: "artifact_release",
  editUrl: "/artifacts/artifact_release/edit",
  exportUrls: {
    excalidraw: "/artifact.excalidraw",
    scene: "/artifact.json",
  },
  viewUrl: "/artifacts/artifact_release",
} satisfies ReadyPlaygroundArtifact;

const rejectedBuild = {
  issues: [
    {
      code: "quality_below_threshold",
      hint: "Stop calling build_flowchart after 3 attempts and list structured issues.",
      message: "build_flowchart failed after attempt 3 of 3.",
      ref: { kind: "request", path: "spec" },
      severity: "error",
      stage: "quality",
    },
  ],
  ok: false,
  status: "quality_failed",
} satisfies BuildFlowchartResult;

describe("playground surface", () => {
  it("renders a genuine generated deploy scene with brand icons", () => {
    render(<PlaygroundEmptyState onSelect={() => undefined} />);

    expect(screen.getByText("Deploy pipeline")).toBeTruthy();
    expect(
      screen.getByTestId("diagram-preview").getAttribute("data-diagram-id"),
    ).toBe(DEPLOY_PIPELINE_SCENE.diagramId);
    for (const brand of ["GitHub", "Docker", "Cloudflare"]) {
      const logo = screen.getByRole("img", { name: `${brand} logo` });
      expect(logo.closest("figcaption")).not.toBeNull();
      expect(logo.closest(".studio__sample-canvas")).toBeNull();
    }

    expect(DEPLOY_PIPELINE_SCENE.accentColor).toBe("#8f707f");
    expect(DEPLOY_PIPELINE_SCENE.backgroundColor).toBe("#fffdf8");
    expect(DEPLOY_PIPELINE_SPEC.nodes.map((node) => node.label)).toEqual([
      "GitHub push",
      "Docker build",
      "Run tests",
      "Cloudflare ship",
    ]);
    expect(DEPLOY_PIPELINE_SPEC.nodes).toHaveLength(4);
    expect(DEPLOY_PIPELINE_SPEC.edges).toEqual([
      { source: "push", target: "build" },
      { source: "build", target: "tests" },
      { label: "pass", source: "tests", target: "deploy" },
    ]);
    expect(JSON.stringify(DEPLOY_PIPELINE_SPEC)).not.toMatch(
      /fix build|retry/i,
    );
    expect(JSON.stringify(DEPLOY_PIPELINE_SCENE)).not.toMatch(
      /fix build|retry/i,
    );
    expect(
      DEPLOY_PIPELINE_SCENE.elements
        .filter((element) => element.type === "node")
        .map((element) => element.shape),
    ).toEqual(["ellipse", "rectangle", "rectangle", "ellipse"]);
    expect(
      DEPLOY_PIPELINE_SCENE.elements.filter(
        (element) => element.type === "arrow",
      ),
    ).toHaveLength(3);
    expect(DEPLOY_PIPELINE_SCENE.elements).toHaveLength(11);
    const sceneNodeLabels = DEPLOY_PIPELINE_SCENE.elements
      .filter((element) => element.type === "text")
      .filter((element) => element.containerId);
    expect(sceneNodeLabels.map((element) => element.fontSize)).toEqual([
      15, 15, 15, 15,
    ]);
    expect(sceneNodeLabels.map((element) => element.text)).toEqual([
      "GitHub\npush",
      "Docker\nbuild",
      "Run\ntests",
      "Cloudflare\nship",
    ]);
    expect(
      validateExcalidrawScene(convertSceneToExcalidraw(DEPLOY_PIPELINE_SCENE)),
    ).toEqual({ issues: [], ok: true });

    expect(document.querySelector(".studio__sample-flow")).toBeNull();
    expect(document.querySelector(".studio__sample-arrow")).toBeNull();
  });

  it("keeps equal-priority starters and a separate mind map announcement", () => {
    render(<PlaygroundEmptyState onSelect={() => undefined} />);

    expect(screen.getByLabelText("Starter prompts").children).toHaveLength(3);
    expect(screen.getByText("Mind maps are ready to explore.")).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "View the example →" }),
    ).toBeTruthy();
  });

  it("keeps generation telemetry inside a closed disclosure", () => {
    render(<BuildResultDetails pass={1} result={acceptedBuild} />);

    const disclosure = screen.getByText("Drawing details").closest("details");
    expect(disclosure?.hasAttribute("open")).toBe(false);
    expect(disclosure?.textContent).toContain("9.0");
    expect(disclosure?.textContent).toContain("Diagram items2");
    expect(screen.queryByText(/canonical artifact/i)).toBeNull();
    expect(screen.queryByText(/attempt 1 of 3/i)).toBeNull();
  });

  it("renders visible labels for every generated-diagram action", () => {
    render(<ArtifactActions artifact={artifact} />);

    for (const label of [
      "View diagram",
      "Edit diagram",
      "Download JSON",
      "Download Excalidraw",
    ]) {
      expect(screen.getByRole("link", { name: label }).textContent).toBe(label);
    }

    expect(
      screen
        .getByRole("link", { name: "Download JSON" })
        .getAttribute("download"),
    ).toBe("artifact_release.json");
    expect(
      screen
        .getByRole("link", { name: "Download Excalidraw" })
        .getAttribute("download"),
    ).toBe("artifact_release.excalidraw");
  });

  it("replaces internal failure details with useful product copy", () => {
    render(<BuildResultDetails pass={3} result={rejectedBuild} />);

    expect(
      screen.getByText("This draft needs another pass before it is ready."),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "Ask Sketchi to simplify the flow or try a shorter description.",
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/build_flowchart/i)).toBeNull();
    expect(
      screen.queryByText(/3 attempts|attempt 3|structured issues/i),
    ).toBeNull();
  });

  it("keeps a persistent accessible name on the primary composer", () => {
    render(
      <PlaygroundComposer
        buildMode={false}
        composerRef={createRef<HTMLTextAreaElement>()}
        onSubmit={() => undefined}
        status="ready"
      />,
    );

    const composer = screen.getByRole("textbox", {
      name: "Describe your diagram",
    }) as HTMLTextAreaElement;
    fireEvent.change(composer, { target: { value: "Map a release flow" } });
    expect(screen.getByLabelText("Describe your diagram")).toBe(composer);
    expect(composer.value).toBe("Map a release flow");
  });

  it("offers quick and custom answers after an assistant question", () => {
    const answers: string[] = [];
    let composeRequests = 0;
    render(
      <AssistantFollowUp
        onCompose={() => {
          composeRequests += 1;
        }}
        onSelect={(answer) => answers.push(answer)}
      />,
    );

    screen.getByRole("button", { name: "Yes, make that change" }).click();
    screen.getByRole("button", { name: "Write another answer" }).click();
    expect(answers).toEqual(["Yes, make that change"]);
    expect(composeRequests).toBe(1);
  });

  it("recognizes only assistant messages that end in a question", () => {
    const assistantQuestion = {
      id: "assistant-question",
      parts: [
        {
          state: "done",
          text: "Would you like me to add a security scan?",
          type: "text",
        },
      ],
      role: "assistant",
    } satisfies UIMessage;
    const assistantStatement = {
      ...assistantQuestion,
      id: "assistant-statement",
      parts: [
        { state: "done", text: "The security scan is included.", type: "text" },
      ],
    } satisfies UIMessage;

    expect(assistantAsksQuestion(assistantQuestion)).toBe(true);
    expect(assistantAsksQuestion(assistantStatement)).toBe(false);
  });
});
