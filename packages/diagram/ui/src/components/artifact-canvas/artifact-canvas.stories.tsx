import type { Meta, StoryObj } from "@storybook/react-vite";

import { flowchartFixture } from "@sketchi/diagram-core";
import { renderIntermediateDiagram } from "@sketchi/diagram-renderer";

import { nodeLogoScene } from "../excalidraw-scene-canvas/node-logo-scene.fixtures";
import { ArtifactCanvas } from "./artifact-canvas";
import "../../styles.css";

const scene = renderIntermediateDiagram(flowchartFixture);

const meta = {
  title: "Diagram UI/Components/ArtifactCanvas",
  component: ArtifactCanvas,
  args: {
    scene,
  },
} satisfies Meta<typeof ArtifactCanvas>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Editable: Story = {
  args: {
    mode: "edit",
  },
};

export const NodeLogos: Story = {
  args: {
    scene: nodeLogoScene(),
  },
};

export const EditableNodeLogos: Story = {
  args: {
    mode: "edit",
    scene: nodeLogoScene("LR"),
  },
};
