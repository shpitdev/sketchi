import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AgentSetupView } from "./agent-setup-view";

describe("AgentSetupView", () => {
  it("renders a hub for the supported agent setup routes", () => {
    render(<AgentSetupView />);

    expect(
      screen.getByRole("heading", {
        name: "Sketch diagrams without leaving your agent.",
      }),
    ).toBeTruthy();
    expect(screen.getByRole("link", { name: /Codex/ })).toHaveProperty(
      "href",
      "http://localhost:3000/agents/codex",
    );
    expect(screen.getByRole("link", { name: /OpenCode/ })).toHaveProperty(
      "href",
      "http://localhost:3000/agents/opencode",
    );
    expect(screen.getByText("https://playground.sketchi.app/mcp")).toBeTruthy();
    expect(screen.queryByRole("link", { name: /Eval harness/ })).toBeNull();
    expect(screen.queryByRole("link", { name: /Excalidraw app/ })).toBeNull();
  });

  it("renders the OpenCode portable skill and server setup", () => {
    render(<AgentSetupView agentId="opencode" />);

    expect(
      screen.getByRole("heading", { name: "OpenCode", level: 1 }),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "opencode mcp add sketchi-code-mode --url https://playground.sketchi.app/mcp",
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(/opencode\/skills\/sketchi-code-mode/),
    ).toBeTruthy();
    expect(
      screen.getByText("No account, API key, or local browser needed."),
    ).toBeTruthy();
  });

  it("renders the Codex plugin marketplace commands", () => {
    render(<AgentSetupView agentId="codex" />);

    expect(
      screen.getByText("codex plugin marketplace add shpitdev/sketchi"),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "codex plugin add sketchi-code-mode-codex@sketchi-agent-plugins",
      ),
    ).toBeTruthy();
    expect(screen.getByText("codex mcp get sketchi-code-mode")).toBeTruthy();
    expect(
      screen.getAllByRole("button", { name: /^Copy / }).length,
    ).toBeGreaterThanOrEqual(4);
  });

  it("names the Antigravity MCP config path and merge behavior", () => {
    render(<AgentSetupView agentId="antigravity" />);

    expect(
      screen.getByRole("heading", {
        name: "Save or merge .agents/mcp_config.json",
      }),
    ).toBeTruthy();
    expect(screen.getByText(/instead of overwriting it/)).toBeTruthy();
  });
});
