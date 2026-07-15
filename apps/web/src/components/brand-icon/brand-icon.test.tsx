import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { BrandIcon } from "./brand-icon";

describe("BrandIcon", () => {
  it("renders a labelled logo", () => {
    render(<BrandIcon label="GitHub" src="/brand/github.svg" />);

    const img = screen.getByRole("img", { name: "GitHub" });
    expect(img.getAttribute("src")).toBe("/brand/github.svg");
  });

  it("wraps the logo in a tile when requested", () => {
    const { container } = render(
      <BrandIcon label="Docker" src="/brand/docker.svg" tile />,
    );

    expect(container.querySelector(".brand-tile")).toBeTruthy();
  });
});
