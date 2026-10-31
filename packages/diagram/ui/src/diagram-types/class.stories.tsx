import type { Meta, StoryObj } from "@storybook/react-vite";

import { classFixture, classStressFixtures } from "@sketchi/diagram-core";
import { classScenarios } from "@sketchi/diagram-scenarios";

import { GenerationWorkspace } from "../components/generation-workspace";
import "../styles.css";

const meta = {
	title: "Diagram Types/Class",
	component: GenerationWorkspace,
	args: {
		diagram: classFixture,
		status: "ready",
	},
} satisfies Meta<typeof GenerationWorkspace>;

export default meta;

type Story = StoryObj<typeof meta>;

function scenarioDiagram(id: string) {
	const scenario = classScenarios.find((entry) => entry.id === id);
	if (!scenario) throw new Error(`Unknown class scenario ${id}`);
	return scenario.expectedDiagram;
}

/** An interface, an abstract base and its subclasses top-down, and a canvas aggregating shapes. */
export const Ready: Story = {};

/** Associations with multiplicities and roles, a composition, an aggregation and an enum. */
export const DomainModel: Story = {
	args: { diagram: scenarioDiagram("online-shop-domain-class-v2") },
};

/** Interfaces realized by concrete classes, a navigable association and a named dependency. */
export const ObserverPattern: Story = {
	args: { diagram: scenarioDiagram("observer-pattern-class-v2") },
};

/** Two named dependencies running opposite ways between two interfaces, each name beside its own line. */
export const OpposingDependencies: Story = {
	args: { diagram: classStressFixtures.opposingDependencies },
};

/** Fifteen classes in rows, two hierarchies and the associations between them. */
export const LargeModel: Story = {
	args: { diagram: scenarioDiagram("library-system-class-v2") },
};
