import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CtaBand } from "./cta-band";

describe("CtaBand", () => {
  it("points the primary action at the playground", () => {
    render(<CtaBand playgroundHref="https://play.example.test" />);

    expect(
      screen.getByRole("heading", { name: "Start with a sentence." }),
    ).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Open the playground" }),
    ).toHaveProperty("href", "https://play.example.test/");
    expect(
      screen.getByRole("link", { name: "Add to your agent" }),
    ).toHaveProperty("href", "http://localhost:3000/agents");
  });
});
