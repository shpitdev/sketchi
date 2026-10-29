import type { Meta, StoryObj } from "@storybook/react-vite";

import { wireframeFixture, wireframeStressFixtures } from "@sketchi/diagram-core";
import { wireframeScenarios } from "@sketchi/diagram-scenarios";

import { GenerationWorkspace } from "../components/generation-workspace/index.js";
import "../styles.css";

const meta = {
	title: "Diagram Types/Wireframe",
	component: GenerationWorkspace,
	args: {
		diagram: wireframeFixture,
		status: "ready",
	},
} satisfies Meta<typeof GenerationWorkspace>;

export default meta;

type Story = StoryObj<typeof meta>;

function scenarioDiagram(id: string) {
	const scenario = wireframeScenarios.find((entry) => entry.id === id);
	if (!scenario) throw new Error(`Unknown wireframe scenario ${id}`);
	return scenario.expectedDiagram;
}

/** A phone login screen: a logo, copy, two fields, a checked checkbox, a primary button and links. */
export const Ready: Story = {};

/** The login prompt's own screen, top to bottom on a phone. */
export const MobileLogin: Story = {
	args: { diagram: scenarioDiagram("mobile-login-wireframe") },
};

/** A desktop dashboard: a sidebar nav, a header search, four KPI cards, a chart and a table. */
export const SaasDashboard: Story = {
	args: { diagram: scenarioDiagram("saas-dashboard-wireframe") },
};

/** Tabs with one active, sections of toggles on and off, selects showing values, and a save bar. */
export const AccountSettings: Story = {
	args: { diagram: scenarioDiagram("account-settings-wireframe") },
};

/** A header, breadcrumbs, an image column beside a details column, and a reviews section. */
export const ProductPage: Story = {
	args: { diagram: scenarioDiagram("product-page-wireframe") },
};

/** Three phone screens side by side. */
export const SignupFlow: Story = {
	args: { diagram: wireframeStressFixtures["signupFlow"]! },
};

/** A tablet screen with a dialog over a dimmed list. */
export const TabletModal: Story = {
	args: { diagram: wireframeStressFixtures["tabletModal"]! },
};

/** A crowded phone screen: wrapping tabs and badges, a grid that drops a column, a table and a pie. */
export const DenseMobile: Story = {
	args: { diagram: wireframeStressFixtures["dense"]! },
};
