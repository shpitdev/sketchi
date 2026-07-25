import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SiteHeader } from "./site-header";

describe("SiteHeader", () => {
  it("renders the brand, primary nav, and playground CTA", () => {
    render(<SiteHeader activePath="/docs" />);

    const brand = screen.getByRole("link", { name: "Sketchi home" });
    expect(brand.getAttribute("href")).toBe("/");
    expect(brand.querySelector(".site-header__brand-icon")).toBeTruthy();
    expect(brand.querySelector(".sk-wordmark")?.textContent).toBe("Sketchi");
    expect(screen.getByRole("link", { name: "Product" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Agents" })).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Playground" }).classList,
    ).toContain("sk-btn--accent");
    expect(
      screen
        .getByRole("link", { name: "Sketchi on GitHub" })
        .getAttribute("href"),
    ).toBe("https://github.com/shpitdev/sketchi");
    expect(
      screen.getByRole("link", { name: "Docs" }).getAttribute("aria-current"),
    ).toBe("page");
  });

  it("uses configured surface action URLs", () => {
    render(
      <SiteHeader
        surfaceUrls={{
          icons: "https://sketchi-icons-pr-42.dimethyl.workers.dev",
          playground: "https://sketchi-studio-pr-42.dimethyl.workers.dev",
        }}
      />,
    );

    expect(
      screen.getByRole("link", { name: "Icons" }).getAttribute("href"),
    ).toBe("https://sketchi-icons-pr-42.dimethyl.workers.dev");
    expect(
      screen.getByRole("link", { name: "Playground" }).getAttribute("href"),
    ).toBe("https://sketchi-studio-pr-42.dimethyl.workers.dev");
  });

  it("toggles the mobile menu", () => {
    render(<SiteHeader />);

    const toggle = screen.getByRole("button", { name: "Toggle menu" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
  });
});
