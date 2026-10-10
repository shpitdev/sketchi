import { describe, expect, it } from "vitest";

import {
  candidateFromText,
  enforceCandidateRequestRequirements,
  type DiagramGenerationRequest,
} from "./candidates";
import { buildDiagramGenerationMessages } from "./messages";

const logos = [
  { slug: "github", name: "GitHub" },
  { slug: "docker", name: "Docker" },
];

function request(
  prompt: Partial<DiagramGenerationRequest["prompt"]> = {},
): DiagramGenerationRequest {
  return {
    model: "gemini-test",
    prompt: {
      id: "deploy",
      request: "Push to GitHub, build with Docker, then ship.",
      logos,
      ...prompt,
    },
  };
}

function responseText(icons: Record<string, unknown>) {
  const node = (id: string, label: string, kind: string) => ({
    id,
    label,
    kind,
    ...(icons[id] === undefined ? {} : { icon: icons[id] }),
  });
  return JSON.stringify({
    title: "Deploy pipeline",
    intent: {
      requestedKind: "flowchart",
      nativeKind: "flowchart",
      requirements: [],
    },
    diagram: {
      id: "deploy",
      type: "flowchart",
      nodes: [
        node("push", "Push to GitHub", "start"),
        node("build", "Build the image", "process"),
        node("ship", "Ship it", "end"),
      ],
      edges: [
        { id: "a", source: "push", target: "build" },
        { id: "b", source: "build", target: "ship" },
      ],
      layout: { direction: "TB", edgeRouting: "orthogonal" },
    },
  });
}

function nodeIcons(result: { readonly diagram?: unknown }) {
  const diagram = result.diagram as
    | {
        readonly type: string;
        readonly nodes: ReadonlyArray<{ readonly icon?: unknown }>;
      }
    | undefined;
  if (diagram?.type !== "flowchart") throw new Error("Expected a flowchart.");
  return diagram.nodes.map((node) => node.icon);
}

function candidate(icons: Record<string, unknown>) {
  return candidateFromText({
    model: "gemini-test",
    provider: "fixture",
    text: responseText(icons),
  });
}

describe("generation logo guidance", () => {
  it("lists only the scenario's logos for flowcharts", () => {
    const { user } = buildDiagramGenerationMessages(request().prompt);
    expect(user).toContain("Available logos (flowchart only):");
    expect(user).toContain("- github: GitHub\n- docker: Docker");
    expect(user).toContain("Never invent a slug.");
  });

  it("adds nothing when no logos apply or another family is required", () => {
    for (const prompt of [
      request({ logos: [] }).prompt,
      request({ requestedType: "mindmap" }).prompt,
    ]) {
      expect(buildDiagramGenerationMessages(prompt).user).not.toContain(
        "Available logos",
      );
    }
  });
});

describe("generated node icons", () => {
  it("normalizes slug case and drops malformed icons without failing", () => {
    const result = candidate({
      push: { slug: "GitHub" },
      build: { slug: "Docker Logo" },
      ship: "cloudflare",
    });

    expect(result.error).toBeUndefined();
    expect(nodeIcons(result)).toEqual([
      { slug: "github" },
      undefined,
      undefined,
    ]);
    expect(result.diagnostics).toEqual([
      expect.stringContaining('icon_dropped: node "build"'),
      expect.stringContaining('icon_dropped: node "ship"'),
    ]);
  });

  it("keeps only logos the prompt offered", () => {
    const enforced = enforceCandidateRequestRequirements(
      candidate({
        push: { slug: "github" },
        build: { slug: "kubernetes" },
        ship: { slug: "constructor" },
      }),
      request(),
    );

    expect(enforced.error).toBeUndefined();
    expect(nodeIcons(enforced)).toEqual([
      { slug: "github" },
      undefined,
      undefined,
    ]);
    expect(enforced.diagnostics).toEqual([
      expect.stringContaining(
        'icon_not_in_prompt: node "build" icon "kubernetes"',
      ),
      expect.stringContaining(
        'icon_not_in_prompt: node "ship" icon "constructor"',
      ),
    ]);
  });

  it("drops every icon when the prompt offered no logos", () => {
    const enforced = enforceCandidateRequestRequirements(
      candidate({ push: { slug: "github" } }),
      request({ logos: [] }),
    );
    expect(nodeIcons(enforced).every((icon) => !icon)).toBe(true);
  });
});
