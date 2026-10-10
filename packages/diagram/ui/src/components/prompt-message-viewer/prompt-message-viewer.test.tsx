import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PromptMessageViewer } from "./prompt-message-viewer";

describe("PromptMessageViewer", () => {
  it("renders separated prompt messages", () => {
    render(
      <PromptMessageViewer
        system="Return only JSON."
        title="Prompt parts"
        user="Create a flowchart."
      />,
    );

    expect(screen.getByRole("heading", { name: "Prompt parts" })).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: "System instructions" }),
    ).toBeTruthy();
    expect(
      screen.getByLabelText("System instructions prompt").textContent,
    ).toContain("Return only JSON.");
    expect(screen.getByLabelText("User request prompt").textContent).toContain(
      "Create a flowchart.",
    );
  });
});
