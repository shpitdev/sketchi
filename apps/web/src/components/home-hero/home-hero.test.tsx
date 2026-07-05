import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { HomeHero } from "./home-hero";

describe("HomeHero", () => {
  it("renders the headline and primary actions", () => {
    render(<HomeHero />);

    expect(
      screen.getByRole("heading", { name: /Sketchi draws it/i }),
    ).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Open the playground" }),
    ).toHaveProperty("href", "https://sketchi-studio.dimethyl.workers.dev/");
    expect(
      screen.getByRole("link", { name: "Add to your agent" }),
    ).toHaveProperty("href", "http://localhost:3000/agents");
  });

  it("labels the sketched diagram illustration", () => {
    render(<HomeHero />);

    expect(
      screen.getByRole("img", { name: /hand-drawn flowchart/i }),
    ).toBeTruthy();
  });
});
