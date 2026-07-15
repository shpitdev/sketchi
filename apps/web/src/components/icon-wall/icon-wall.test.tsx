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
});
