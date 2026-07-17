import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { GenerationRunPanel } from "./generation-run-panel";

describe("GenerationRunPanel", () => {
  it("renders the title", () => {
    render(<GenerationRunPanel title="Generated component" />);

    expect(
      screen.getByRole("heading", { name: "Generated component" }),
    ).toBeTruthy();
  });

  it("runs the comparison action", () => {
    const onRun = vi.fn();

    render(<GenerationRunPanel onRun={onRun} />);
    fireEvent.click(screen.getByRole("button", { name: "Run" }));

    expect(onRun).toHaveBeenCalledTimes(1);
  });

  it("switches cache mode before a run", () => {
    const onCacheModeChange = vi.fn();

    render(
      <GenerationRunPanel
        cacheMode="default"
        onCacheModeChange={onCacheModeChange}
      />,
    );
    fireEvent.click(screen.getByText("Run settings"));
    fireEvent.click(screen.getByLabelText("Fresh"));

    expect(onCacheModeChange).toHaveBeenCalledWith("fresh");
  });

  it("shows provider candidate status", () => {
    render(
      <GenerationRunPanel
        candidates={[
          {
            cacheMode: "fresh",
            diagnostics: [],
            diagramValid: false,
            durationMs: 42,
            model: "google/gemini-3.1-flash-lite",
            provider: "cloudflare-google-ai-studio",
            text: "{}",
            usage: { totalTokens: 11 },
          },
        ]}
      />,
    );

    expect(screen.getAllByText("Returned").length).toBeGreaterThan(0);
    expect(screen.getAllByText("42 ms / 11 tokens").length).toBeGreaterThan(0);
    expect(screen.getByText("Fresh run")).toBeTruthy();
  });

  it("shows provider error diagnostics", () => {
    render(
      <GenerationRunPanel
        candidates={[
          {
            diagnostics: [
              "bad json",
              "Google AI Studio Gateway request failed.",
            ],
            diagramValid: false,
            error: "bad json",
            model: "google/gemini-3.1-flash-lite",
            provider: "cloudflare-google-ai-studio",
            text: "",
          },
        ]}
      />,
    );

    expect(screen.getAllByText("Failed").length).toBeGreaterThan(0);
    expect(
      screen.getByText("Google AI Studio Gateway request failed."),
    ).toBeTruthy();
  });
});
