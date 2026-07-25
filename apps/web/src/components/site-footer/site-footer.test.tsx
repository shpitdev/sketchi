import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SiteFooter } from "./site-footer";

describe("SiteFooter", () => {
  it("renders the footer columns", () => {
    render(<SiteFooter />);

    expect(screen.getByRole("heading", { name: "Product" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Agents" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "More" })).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: "Sketchi on GitHub" })
        .getAttribute("href"),
    ).toBe("https://github.com/shpitdev/sketchi");
  });

  /**
   * The hero already states the thesis. The footer restated it twice more, in
   * the brand blurb and the colophon; both are gone and neither comes back.
   */
  it("does not restate the hero thesis", () => {
    const { container } = render(<SiteFooter />);
    const text = container.textContent ?? "";

    expect(text).not.toMatch(/rather describe a diagram than draw one/);
    expect(text).not.toMatch(/Prompts become real, editable diagrams/);
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

  /**
   * The npm wordmark is the word, so the link carries the mark and an
   * accessible name rather than the mark plus "npm package" beside it.
   */
  it("lists the CLI as a product and links npm by its wordmark", () => {
    render(<SiteFooter />);

    expect(screen.getByRole("link", { name: "CLI" }).getAttribute("href")).toBe(
      "/#cli",
    );

    const npmLink = screen.getByRole("link", { name: "sketchi on npm" });
    expect(npmLink.getAttribute("href")).toBe(
      "https://www.npmjs.com/package/sketchi",
    );
    expect(npmLink.querySelector(".npm-mark")).toBeTruthy();
    expect(screen.queryByText("npm package")).toBeNull();
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
