import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { JsonCodeEditor } from "./json-code-editor";

describe("JsonCodeEditor", () => {
  it("renders a labelled JSON editor", () => {
    render(
      <JsonCodeEditor
        label="Candidate IR"
        value={JSON.stringify({ type: "flowchart" }, null, 2)}
      />,
    );

    expect(screen.getByText("Candidate IR")).toBeTruthy();
    expect(screen.getByText(/flowchart/)).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Search Candidate IR" }),
    ).toBeTruthy();
  });

  it("keeps the editor content controlled by value", () => {
    const { rerender } = render(
      <JsonCodeEditor
        label="Excalidraw JSON"
        value={JSON.stringify({ title: "Before" }, null, 2)}
      />,
    );

    expect(screen.getByText(/Before/)).toBeTruthy();

    rerender(
      <JsonCodeEditor
        label="Excalidraw JSON"
        value={JSON.stringify({ title: "After" }, null, 2)}
      />,
    );

    expect(screen.getByText(/After/)).toBeTruthy();
  });
});
