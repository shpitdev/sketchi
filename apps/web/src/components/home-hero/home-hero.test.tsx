import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { HomeHero } from "./home-hero";

describe("HomeHero", () => {
  it("renders the headline and primary actions", () => {
    render(<HomeHero />);

    expect(
      screen.getByRole("heading", { name: /validated diagrams/i }),
    ).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open the app" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Read the docs" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open the app" })).toHaveProperty(
      "href",
      "https://sketchi-excalidraw.dimethyl.workers.dev/",
    );
  });

  it("labels the diagram illustration", () => {
    render(<HomeHero />);

    expect(
      screen.getByRole("img", {
        name: /playground rendering a validated flowchart/i,
      }),
    ).toBeTruthy();
  });
});
