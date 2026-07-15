import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { type DiagramOption, DiagramSwitcher } from "./diagram-switcher";

const diagrams: DiagramOption[] = [
  { edgeCount: 4, id: "alpha", nodeCount: 5, title: "Alpha flow", type: "flowchart" },
  { edgeCount: 2, id: "beta", nodeCount: 3, title: "Beta map", type: "mindmap" },
];

describe("DiagramSwitcher", () => {
  it("marks the active diagram and reports selections", () => {
    const onSelect = vi.fn();
    render(
      <DiagramSwitcher activeId="alpha" diagrams={diagrams} onSelect={onSelect} />,
    );

    const active = screen.getByRole("button", { name: /Alpha flow/ });
    expect(active.getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: /Beta map/ }));
    expect(onSelect).toHaveBeenCalledWith("beta");
  });
});
