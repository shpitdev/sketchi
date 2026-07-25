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

  it("offers the CLI as the third closing route", () => {
    render(<CtaBand />);

    expect(
      screen
        .getByRole("link", { name: /install the CLI/ })
        .getAttribute("href"),
    ).toBe("/#cli");
  });
});
