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
    expect(screen.queryByRole("link", { name: "Product" })).toBeNull();
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
      screen.getByRole("link", { name: "sketchi on npm" }).getAttribute("href"),
    ).toBe("https://www.npmjs.com/package/sketchi");
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

  /**
   * The CLI is a peer of the playground and the agent route, so it has to be
   * reachable from the nav on every page, in the desktop bar and the mobile
   * sheet alike.
   */
  it("offers the CLI in both the desktop nav and the mobile sheet", () => {
    render(<SiteHeader />);

    expect(screen.getByRole("link", { name: "CLI" }).getAttribute("href")).toBe(
      "/#cli",
    );

    fireEvent.click(screen.getByRole("button", { name: "Toggle menu" }));

    expect(
      screen
        .getAllByRole("link", { name: "CLI" })
        .map((link) => link.getAttribute("href")),
    ).toEqual(["/#cli", "/#cli"]);
  });

  /**
   * The header actions are hidden on narrow viewports, so both source marks
   * have to survive into the sheet or they vanish on mobile entirely.
   */
  it("carries the GitHub and npm marks into the mobile sheet", () => {
    render(<SiteHeader />);

    fireEvent.click(screen.getByRole("button", { name: "Toggle menu" }));

    expect(
      screen.getByRole("link", { name: "GitHub" }).getAttribute("href"),
    ).toBe("https://github.com/shpitdev/sketchi");
    expect(
      screen
        .getAllByRole("link", { name: "sketchi on npm" })
        .map((link) => link.getAttribute("href")),
    ).toEqual([
      "https://www.npmjs.com/package/sketchi",
      "https://www.npmjs.com/package/sketchi",
    ]);
  });

  it("toggles the mobile menu", () => {
    render(<SiteHeader />);

    const toggle = screen.getByRole("button", { name: "Toggle menu" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
  });
});
