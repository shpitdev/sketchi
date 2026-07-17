import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PromptMessageViewer } from "./prompt-message-viewer";

describe("PromptMessageViewer", () => {
  it("renders separated prompt messages", () => {
    render(
      <PromptMessageViewer
        messages={[
          { role: "system", content: "Return only JSON." },
          { role: "user", content: "Create a flowchart." },
        ]}
        title="Prompt parts"
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
