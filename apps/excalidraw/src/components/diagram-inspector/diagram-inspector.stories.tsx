import type { Meta, StoryObj } from "@storybook/react-vite";

import { pharmaBatchDispositionFlowchart } from "@sketchi/diagram-core";
import { convertSceneToExcalidraw } from "@sketchi/diagram-excalidraw";
import { renderIntermediateDiagram } from "@sketchi/diagram-renderer";

import { DiagramInspector } from "./diagram-inspector";
import "../../styles/app.css";

const scene = convertSceneToExcalidraw(
  renderIntermediateDiagram(pharmaBatchDispositionFlowchart),
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
