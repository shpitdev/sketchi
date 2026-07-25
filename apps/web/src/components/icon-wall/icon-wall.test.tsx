import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { IconWall } from "./icon-wall";

describe("IconWall", () => {
  it("links to the configured icon library", () => {
    render(<IconWall iconsHref="https://icons.example.test" />);

    expect(
      screen.getByRole("heading", {
        name: "Every logo you need, already sketched.",
      }),
    ).toBeTruthy();
    expect(
      screen.getByRole("link", { name: /Browse the library/ }),
    ).toHaveProperty("href", "https://icons.example.test/");
  });

  it("keeps every logo unique within each marquee cycle", () => {
    const { container } = render(<IconWall />);
    const cycles = [...container.querySelectorAll("[data-icon-cycle]")];

    expect(cycles).toHaveLength(4);
    for (const cycle of cycles) {
      const sources = [...cycle.querySelectorAll("img")].map((image) =>
        image.getAttribute("src"),
      );
      expect(sources.length).toBeGreaterThanOrEqual(13);
      expect(new Set(sources).size).toBe(sources.length);
    }
  });
});
