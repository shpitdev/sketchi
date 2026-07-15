import type { Meta, StoryObj } from "@storybook/react-vite";

import { flowchartFixture } from "@sketchi/diagram-core";
import { renderIntermediateDiagram } from "@sketchi/diagram-renderer";

import { DiagramPreview } from "./diagram-preview";
import "../../styles.css";

const meta = {
  title: "Diagram Studio/Components/DiagramPreview",
  component: DiagramPreview,
  args: {
    scene: renderIntermediateDiagram(flowchartFixture),
  },
} satisfies Meta<typeof DiagramPreview>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};
