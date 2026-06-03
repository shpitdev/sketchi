import { architectureFixture } from "@sketchi/diagram-core";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DiagramPreview } from "./diagram-preview";

describe("DiagramPreview", () => {
  it("renders the diagram scene as an image", () => {
    render(<DiagramPreview diagram={architectureFixture} />);

    expect(screen.getByRole("img", { name: "Diagram preview" })).toBeTruthy();
  });
});
