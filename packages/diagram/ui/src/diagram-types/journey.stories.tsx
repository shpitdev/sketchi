import type { Meta, StoryObj } from "@storybook/react-vite";

import { journeyFixture, journeyStressFixtures } from "@sketchi/diagram-core";
import { journeyScenarios } from "@sketchi/diagram-scenarios";

import { GenerationWorkspace } from "../components/generation-workspace";
import "../styles.css";

const meta = {
	title: "Diagram Types/Journey Map",
	component: GenerationWorkspace,
	args: {
		diagram: journeyFixture,
		status: "ready",
	},
} satisfies Meta<typeof GenerationWorkspace>;

export default meta;

type Story = StoryObj<typeof meta>;

function scenarioDiagram(id: string) {
	const scenario = journeyScenarios.find((entry) => entry.id === id);
	if (!scenario) throw new Error(`Unknown journey scenario ${id}`);
	return scenario.expectedDiagram;
}

/** A first-time buyer's three stages: cards, an emotion curve through a face per step, and notes. */
export const Ready: Story = {};

/** Four stages, each step with its touchpoint, and a pain point and an opportunity under two. */
export const OnlinePurchase: Story = {
	args: { diagram: scenarioDiagram("online-purchase-journey-v2") },
};

/** Six uneven stages with five actors and long labels: two bands, the curve running on between them. */
export const SaasOnboarding: Story = {
	args: { diagram: scenarioDiagram("saas-onboarding-journey-v2") },
};

/** A support ticket from a double charge to a refund, rising from very negative to very positive. */
export const SupportTicket: Story = {
	args: { diagram: scenarioDiagram("support-ticket-journey-v2") },
};

/** One stage of eight steps runs on into a second band, its header marked as continued. */
export const LongStage: Story = {
	args: { diagram: journeyStressFixtures.longStage },
};

/** Forty steps, the most a journey holds, wrapped into bands of whole stages. */
export const FortySteps: Story = {
	args: { diagram: journeyStressFixtures.longest },
};
