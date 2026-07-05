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
