import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SiteFooter } from "./site-footer";

describe("SiteFooter", () => {
  it("renders the footer columns and colophon", () => {
    render(<SiteFooter />);

    expect(screen.getByRole("heading", { name: "Product" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Agents" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "More" })).toBeTruthy();
    expect(
      screen.getByText(
        "Made for people who'd rather describe a diagram than draw one.",
      ),
    ).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: "Sketchi on GitHub" })
        .getAttribute("href"),
    ).toBe("https://github.com/shpitdev/sketchi");
  });

  it("links to llms.txt under its own name", () => {
    render(<SiteFooter />);

    expect(
      screen.getByRole("link", { name: "llms.txt" }).getAttribute("href"),
    ).toBe("/llms.txt");
    expect(screen.queryByRole("link", { name: "Agent API" })).toBeNull();
  });

  it("lets a surface point llms.txt somewhere it actually resolves", () => {
    render(<SiteFooter llmsTxtUrl="https://sketchi.app/llms.txt" />);

    expect(
      screen.getByRole("link", { name: "llms.txt" }).getAttribute("href"),
    ).toBe("https://sketchi.app/llms.txt");
  });

  it("lists the CLI as a product and links the npm package with its mark", () => {
    render(<SiteFooter />);

    expect(screen.getByRole("link", { name: "CLI" }).getAttribute("href")).toBe(
      "/#cli",
    );

    const npmLink = screen.getByRole("link", { name: /npm package/ });
    expect(npmLink.getAttribute("href")).toBe(
      "https://www.npmjs.com/package/sketchi",
    );
    expect(npmLink.querySelector("img")?.getAttribute("src")).toBe(
      "/brand/npm.svg",
    );
  });

  it("uses configured surface links", () => {
    render(
      <SiteFooter
        surfaceUrls={{
          icons: "https://sketchi-icons-pr-42.dimethyl.workers.dev",
          playground: "https://sketchi-studio-pr-42.dimethyl.workers.dev",
        }}
      />,
    );

    expect(
      screen.getByRole("link", { name: "Playground" }).getAttribute("href"),
    ).toBe("https://sketchi-studio-pr-42.dimethyl.workers.dev");
    expect(
      screen.getByRole("link", { name: "Icons" }).getAttribute("href"),
    ).toBe("https://sketchi-icons-pr-42.dimethyl.workers.dev");
    expect(
      screen.getByRole("link", { name: "Claude Code" }).getAttribute("href"),
    ).toBe("/agents/claude-code");
  });
});
