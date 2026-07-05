import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AgentDetailPage, AgentsPage } from "./-agent-pages";

const previewSurfaceUrls = {
  icons: "https://sketchi-icons-pr-456.dimethyl.workers.dev",
  playground: "https://sketchi-studio-pr-456.dimethyl.workers.dev",
};

describe("AgentsPage", () => {
  it("uses configured preview surface URLs in shared chrome", () => {
    render(<AgentsPage surfaceUrls={previewSurfaceUrls} />);

    expect(
      screen
        .getAllByRole("link", { name: "Icons" })
        .map((link) => link.getAttribute("href")),
    ).toContain(previewSurfaceUrls.icons);
    expect(
      screen
        .getAllByRole("link", { name: "Playground" })
        .map((link) => link.getAttribute("href")),
    ).toEqual([previewSurfaceUrls.playground, previewSurfaceUrls.playground]);
    expect(
      screen
        .getAllByRole("link", { name: "Agents" })
        .some((link) => link.getAttribute("aria-current") === "page"),
    ).toBe(true);
  });
});

describe("AgentDetailPage", () => {
  it("renders an agent-specific route inside shared chrome", () => {
    render(
      <AgentDetailPage
        agentId="antigravity"
        surfaceUrls={previewSurfaceUrls}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Antigravity", level: 1 }),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "agy plugin install ./plugins/sketchi-code-mode-antigravity",
      ),
    ).toBeTruthy();
    expect(screen.getByText("agy plugin list")).toBeTruthy();
    expect(
      screen
        .getAllByRole("link", { name: "Agents" })
        .some((link) => link.getAttribute("aria-current") === "page"),
    ).toBe(true);
  });
});
