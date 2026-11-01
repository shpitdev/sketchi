import type { Meta, StoryObj } from "@storybook/react-vite";

import { BenefitStrip } from "./benefit-strip";
import "../../styles/app.css";

const meta = {
	title: "Web/Components/BenefitStrip",
	component: BenefitStrip,
	parameters: {
		layout: "fullscreen",
	},
	tags: ["test"],
} satisfies Meta<typeof BenefitStrip>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Mobile: Story = {
	parameters: {
		viewport: { defaultViewport: "mobile1" },
	},
};
