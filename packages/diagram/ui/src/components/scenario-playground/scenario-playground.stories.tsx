import type { Meta, StoryObj } from "@storybook/react-vite";
import { flowchartFixture } from "@sketchi/diagram-core";
import { getScenario } from "@sketchi/diagram-scenarios";

import { ScenarioPlayground } from "./scenario-playground";

const meta = {
  title: "Diagram UI/Harness/ScenarioHarness",
  component: ScenarioPlayground,
} satisfies Meta<typeof ScenarioPlayground>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const PharmaBatchDisposition: Story = {
  args: {
    initialScenarioId: "pharma-batch-disposition",
  },
};

export const GeneratedCandidate: Story = {
  args: {
    onGenerateScenario: async ({ scenarioId }) => ({
      candidates: [
        {
          diagnostics: [],
          diagramValid: true,
          durationMs: 812,
          model: "google/gemini-3.1-flash-lite",
          provider: "cloudflare-google-ai-studio",
          text: JSON.stringify(
            { ...flowchartFixture, title: "Generated onboarding flow" },
            null,
            2,
          ),
          usage: { totalTokens: 644 },
        },
      ],
      scenarioId,
    }),
  },
};

// An offline delayed result makes switching scenarios mid-run reproducible.
export const DelayedCandidate: Story = {
  args: {
    onGenerateScenario: async ({ scenarioId }) => {
      await new Promise((resolve) => window.setTimeout(resolve, 5000));
      return {
        candidates: [
          {
            diagnostics: [],
            diagramValid: true,
            model: "Storybook fixture",
            provider: "cloudflare-google-ai-studio",
            text: JSON.stringify(getScenario(scenarioId).expectedDiagram),
          },
        ],
        scenarioId,
      };
    },
  },
};
