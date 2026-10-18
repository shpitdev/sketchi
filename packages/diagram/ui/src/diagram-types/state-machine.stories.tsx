import type { Meta, StoryObj } from "@storybook/react-vite";

import { mediaPlayerStateMachine, stateMachineFixture } from "@sketchi/diagram-core";
import { stateMachineScenarios } from "@sketchi/diagram-scenarios";

import { GenerationWorkspace } from "../components/generation-workspace";
import "../styles.css";

const meta = {
	title: "Diagram Types/StateMachine",
	component: GenerationWorkspace,
	args: {
		diagram: stateMachineFixture,
		status: "ready",
	},
} satisfies Meta<typeof GenerationWorkspace>;

export default meta;

type Story = StoryObj<typeof meta>;

function scenarioDiagram(id: string) {
	const scenario = stateMachineScenarios.find((entry) => entry.id === id);
	if (!scenario) throw new Error(`Unknown state-machine scenario ${id}`);
	return scenario.expectedDiagram;
}

/** A guarded payment, a self-loop, a return and two ends. */
export const Ready: Story = {};

/** A composite entered and left at its frame, with its own initial dot. */
export const Composite: Story = {
	args: { diagram: mediaPlayerStateMachine },
};

/** A transition and its return as parallel lines; three ends, each its own bullseye. */
export const OrderLifecycle: Story = {
	args: { diagram: scenarioDiagram("order-lifecycle-state-machine") },
};

/** Two states with a self-loop each and a guarded unlock. */
export const SelfLoops: Story = {
	args: { diagram: scenarioDiagram("turnstile-state-machine") },
};

/** A guarded choice, a labeled final and a composite. */
export const ChoiceAndComposite: Story = {
	args: { diagram: scenarioDiagram("connection-retry-state-machine") },
};
