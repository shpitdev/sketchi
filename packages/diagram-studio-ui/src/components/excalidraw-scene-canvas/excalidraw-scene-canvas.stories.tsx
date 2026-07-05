import type { Meta, StoryObj } from "@storybook/react-vite";

import { flowchartFixture } from "@sketchi/diagram-core";
import { convertSceneToExcalidraw } from "@sketchi/diagram-excalidraw";
import { renderIntermediateDiagram } from "@sketchi/diagram-renderer";

import { ExcalidrawSceneCanvas } from "./excalidraw-scene-canvas";

const scene = convertSceneToExcalidraw(
  renderIntermediateDiagram(flowchartFixture),
);

const meta = {
  title: "Diagram Studio/Components/ExcalidrawSceneCanvas",
  component: ExcalidrawSceneCanvas,
  args: {
    scene,
    title: "Sketchi onboarding decision flow",
  },
} satisfies Meta<typeof ExcalidrawSceneCanvas>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};
