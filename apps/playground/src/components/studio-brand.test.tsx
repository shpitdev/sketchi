import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { StudioBrand } from "./studio-brand";

describe("StudioBrand", () => {
  it("uses the shared Sketchi icon and wordmark treatment", () => {
    render(<StudioBrand />);

    const home = screen.getByRole("link", { name: "Sketchi home" });
    expect(home.getAttribute("href")).toBe("https://sketchi.app");
    expect(home.querySelector("img")?.getAttribute("src")).toBe("/icon.svg");
    expect(screen.getByText("Sketchi")).toBeTruthy();
    expect(screen.getByText("Playground")).toBeTruthy();
  });
});
