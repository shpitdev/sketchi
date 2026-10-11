import type { Meta, StoryObj } from "@storybook/react-vite";
import { buildScenarioPromptParts, getFlowchartScenario } from "@sketchi/diagram-scenarios";

import { PromptMessageViewer } from "./prompt-message-viewer";

const promptParts = buildScenarioPromptParts(getFlowchartScenario("pharma-batch-disposition"));

const meta = {
	title: "Diagram UI/Components/PromptMessageViewer",
	component: PromptMessageViewer,
	args: {
		system: promptParts.system,
		title: "Prompt messages",
		user: promptParts.user,
	},
} satisfies Meta<typeof PromptMessageViewer>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};
