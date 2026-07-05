import type { Meta, StoryObj } from "@storybook/react-vite";

import { ScenarioSuitePanel } from "./scenario-suite-panel";

const scenarios = [
  { difficulty: "smoke", id: "onboarding", title: "Onboarding flow" },
  { difficulty: "standard", id: "support", title: "Support ticket triage" },
  { difficulty: "challenge", id: "pharma", title: "Pharma batch disposition" },
];

const meta = {
  title: "Diagram Studio/Harness/ScenarioSuitePanel",
  component: ScenarioSuitePanel,
  args: {
    activeScenarioId: "support",
    results: [
      {
        durationMs: 812,
        message: "Passed deterministic checks",
        scenarioId: "onboarding",
        status: "pass",
        title: "Onboarding flow",
      },
      {
        message: "Running",
        scenarioId: "support",
        status: "running",
        title: "Support ticket triage",
      },
      {
        durationMs: 1044,
        message: "Missing reject branch label.",
        scenarioId: "pharma",
        status: "fail",
        title: "Pharma batch disposition",
      },
    ],
    scenarios,
    selectedScenarioIds: ["onboarding", "support", "pharma"],
  },
} satisfies Meta<typeof ScenarioSuitePanel>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const EmptySelection: Story = {
  args: {
    results: [],
    selectedScenarioIds: [],
  },
};
