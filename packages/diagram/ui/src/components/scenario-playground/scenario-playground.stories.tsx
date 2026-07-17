import type { Meta, StoryObj } from "@storybook/react-vite";
import { flowchartFixture } from "@sketchi/diagram-core";

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
