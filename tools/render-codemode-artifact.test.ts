import { describe, expect, it } from "vitest";

import { renderSceneSvg, sceneFromPayload } from "./render-codemode-artifact";

function svgDimension(svg: string, attribute: "width" | "height"): number {
  const match = new RegExp(`${attribute}="(\\d+)"`).exec(svg);
  if (!match?.[1]) {
    throw new Error(`Missing SVG ${attribute}.`);
  }

  return Number(match[1]);
}

describe("render-codemode-artifact", () => {
  it("renders wrapped artifact payloads without flattening multiline labels", () => {
    const title =
      "Shipping pipeline with a deliberately long visual proof title";
    const scene = sceneFromPayload({
      inline: {
        title,
        width: 320,
        height: 240,
        backgroundColor: "#ffffff",
        elements: [
          {
            type: "node",
            id: "node-requirements",
            nodeId: "requirements",
            shape: "rectangle",
            x: 0,
            y: 0,
            width: 140,
            height: 70,
            label: "Collect requirements",
          },
          {
            type: "text",
            id: "label-requirements",
            containerId: "node-requirements",
            text: "Collect\nrequirements",
            x: 10,
            y: 22,
            fontSize: 14,
            maxWidth: 120,
          },
          {
            type: "arrow",
            id: "edge-long",
            edgeId: "edge-long",
            sourceNodeId: "requirements",
            targetNodeId: "ship",
            points: [
              { x: 140, y: 35 },
              { x: 500, y: 35 },
            ],
            label: "exceptionally long edge label",
          },
        ],
      },
    });

    const svg = renderSceneSvg(scene);

    expect(svg).toContain(">Collect</text>");
    expect(svg).toContain(">requirements</text>");
    expect(svg).toContain("exceptionally long edge label");
    expect(svgDimension(svg, "width")).toBeGreaterThanOrEqual(
      title.length * 10 + 112,
    );
  });
});
