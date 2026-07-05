import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ScenarioSuitePanel } from "./scenario-suite-panel";

const scenarios = [
  { difficulty: "smoke", id: "onboarding", title: "Onboarding flow" },
  { difficulty: "challenge", id: "pharma", title: "Pharma batch" },
];

describe("ScenarioSuitePanel", () => {
  it("renders selectable scenarios and run summary", () => {
    render(
      <ScenarioSuitePanel
        results={[
          {
            durationMs: 812,
            message: "Passed deterministic checks",
            scenarioId: "onboarding",
            status: "pass",
            title: "Onboarding flow",
          },
        ]}
        scenarios={scenarios}
        activeScenarioId="onboarding"
        selectedScenarioIds={["onboarding"]}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "LLM eval suite" }),
    ).toBeTruthy();
    expect(screen.getByText("1 / 1 passed")).toBeTruthy();
    expect(
      screen.getByLabelText("Onboarding flow result").textContent,
    ).toContain("812 ms");
    expect(screen.getByLabelText("Pharma batch result").textContent).toContain(
      "Not run",
    );
    expect(
      screen
        .getByRole("button", { name: /Onboarding flow/ })
        .getAttribute("aria-current"),
    ).toBe("true");
  });

  it("notifies when a scenario is toggled or the selection is run", () => {
    const onActivateScenario = vi.fn();
    const onRunSelected = vi.fn();
    const onToggleScenario = vi.fn();

    render(
      <ScenarioSuitePanel
        onActivateScenario={onActivateScenario}
        onRunSelected={onRunSelected}
        onToggleScenario={onToggleScenario}
        scenarios={scenarios}
        selectedScenarioIds={["onboarding"]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Pharma batch/ }));
    fireEvent.click(screen.getByLabelText("Include Pharma batch"));
    fireEvent.click(screen.getByRole("button", { name: "Run selected" }));

    expect(onActivateScenario).toHaveBeenCalledWith("pharma");
    expect(onToggleScenario).toHaveBeenCalledWith("pharma");
    expect(onRunSelected).toHaveBeenCalledTimes(1);
  });

  it("disables running when nothing is selected", () => {
    render(
      <ScenarioSuitePanel scenarios={scenarios} selectedScenarioIds={[]} />,
    );

    expect(
      (
        screen.getByRole("button", {
          name: "Run selected",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });
});
