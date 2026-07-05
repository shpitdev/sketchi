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
    expect(
      screen.getByText("https://sketchi-studio.dimethyl.workers.dev/mcp"),
    ).toBeTruthy();
    expect(screen.queryByRole("link", { name: /Eval harness/ })).toBeNull();
    expect(screen.queryByRole("link", { name: /Excalidraw app/ })).toBeNull();
  });

  it("renders the OpenCode setup as a plain server connection", () => {
    render(<AgentSetupView agentId="opencode" />);

    expect(
      screen.getByRole("heading", { name: "OpenCode", level: 1 }),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "opencode mcp add sketchi-code-mode --url https://sketchi-studio.dimethyl.workers.dev/mcp",
      ),
    ).toBeTruthy();
    expect(screen.getByText(/No plugin to install/)).toBeTruthy();
  });

  it("renders the Codex plugin marketplace commands", () => {
    render(<AgentSetupView agentId="codex" />);

    expect(screen.getByText("codex plugin marketplace add .")).toBeTruthy();
    expect(
      screen.getByText(
        "codex plugin add sketchi-code-mode-codex --marketplace sketchi-agent-plugins",
      ),
    ).toBeTruthy();
  });
});
