import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CtaBand } from "./cta-band";

describe("CtaBand", () => {
  it("points the primary action at the playground", () => {
    render(<CtaBand playgroundHref="https://play.example.test" />);

    expect(
      screen.getByRole("heading", { name: "Start with a sentence." }),
    ).toBeTruthy();
    const primaryAction = screen.getByRole("link", {
      name: "Open the playground",
    });
    expect(primaryAction).toHaveProperty("href", "https://play.example.test/");
    expect(primaryAction.classList).toContain("sk-btn--accent");
    expect(
      screen.getByRole("link", { name: /add it to your coding agent/ }),
    ).toHaveProperty("href", "http://localhost:3000/agents");
  });

  /**
   * Three trailing routes out of one closing sheet is clutter. The playground
   * is the primary, the agent hub is the one alternative, and the CLI keeps
   * its own full section further up the page.
   */
  it("closes on one primary action and one alternative", () => {
    const { container } = render(<CtaBand />);

    expect(container.querySelectorAll(".cta-band__actions a")).toHaveLength(2);
    expect(screen.queryByRole("link", { name: /install the CLI/ })).toBeNull();
  });
});
