import { type Meta, type StoryObj } from "@storybook/react-vite";

import { pharmaBatchDispositionFlowchart } from "@sketchi/diagrams/families/flowchart/fixtures";
import { convertSceneToExcalidraw } from "@sketchi/drawing/excalidraw";
import { renderFlowchartDiagram } from "@sketchi/diagrams/families/flowchart/render";

import { DiagramInspector } from "./diagram-inspector";
import "../../styles/app.css";

const scene = convertSceneToExcalidraw(renderFlowchartDiagram(pharmaBatchDispositionFlowchart));

const meta = {
	title: "Excalidraw/Components/DiagramInspector",
	component: DiagramInspector,
	args: {
		diagram: pharmaBatchDispositionFlowchart,
		scene,
	},
	tags: ["test"],
} satisfies Meta<typeof DiagramInspector>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};
