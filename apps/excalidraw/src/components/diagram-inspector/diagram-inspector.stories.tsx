// Positive fixtures deliberately unwrap Results: failure here is invalid test/story data, not user input.
import { Result } from "effect";
import { type Meta, type StoryObj } from "@storybook/react-vite";

import { pharmaBatchDispositionFlowchart } from "@sketchi/diagram-core";
import { convertSceneToExcalidraw } from "@sketchi/drawing/excalidraw";
import { renderIntermediateDiagram } from "@sketchi/diagram-renderer";

import { DiagramInspector } from "./diagram-inspector";
import "../../styles/app.css";

const scene = convertSceneToExcalidraw(
	renderIntermediateDiagram(pharmaBatchDispositionFlowchart).pipe(Result.getOrThrow),
);

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
