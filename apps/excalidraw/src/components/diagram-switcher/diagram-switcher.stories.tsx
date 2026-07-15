import type { Meta, StoryObj } from "@storybook/react-vite";
import { mindmapFixture } from "@sketchi/diagram-core";

import { DiagramSwitcher } from "./diagram-switcher";
import "../../styles/app.css";

const meta = {
  title: "Excalidraw/Components/DiagramSwitcher",
  component: DiagramSwitcher,
  args: {
    activeId: "pharma-batch-disposition",
    diagrams: [
      {
        edgeCount: 7,
        id: "pharma-batch-disposition",
        nodeCount: 7,
        title: "Pharma batch disposition flow",
        type: "flowchart",
      },
      {
        edgeCount: 5,
        id: "onboarding-flow",
        nodeCount: 5,
        title: "Sketchi onboarding decision flow",
        type: "flowchart",
      },
      {
        edgeCount: mindmapFixture.edges.length,
        id: mindmapFixture.id,
        nodeCount: mindmapFixture.nodes.length,
        title: mindmapFixture.title,
        type: mindmapFixture.type,
      },
    ],
    onSelect: () => {},
  },
  tags: ["test"],
} satisfies Meta<typeof DiagramSwitcher>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};
