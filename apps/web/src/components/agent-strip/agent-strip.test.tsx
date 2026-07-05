import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AgentStrip } from "./agent-strip";

describe("AgentStrip", () => {
  it("links every supported agent to its setup page", () => {
    render(<AgentStrip />);

    expect(
      screen.getByRole("heading", {
        name: "Ask your coding agent for a diagram.",
      }),
    ).toBeTruthy();
    expect(screen.getByRole("link", { name: /Claude Code/ })).toHaveProperty(
      "href",
      "http://localhost:3000/agents/claude-code",
    );
    expect(screen.getByRole("link", { name: /Antigravity/ })).toHaveProperty(
      "href",
      "http://localhost:3000/agents/antigravity",
    );
  });
});
