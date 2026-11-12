import type { Meta, StoryObj } from "@storybook/react-vite";

import { HomeDiagram } from "./home-diagram";
import "../../styles/app.css";

const meta = {
	title: "Web/Components/HomeDiagram",
	component: HomeDiagram,
	tags: ["test"],
} satisfies Meta<typeof HomeDiagram>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Excalidraw's export of the scene; Edit opens Excalidraw on it in place. */
export const Default: Story = {};

export const Mobile: Story = {
	parameters: {
		viewport: { defaultViewport: "mobile1" },
	},
};
