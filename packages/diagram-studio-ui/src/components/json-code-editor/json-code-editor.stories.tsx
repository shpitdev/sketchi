import type { Meta, StoryObj } from "@storybook/react-vite";

import { JsonCodeEditor } from "./json-code-editor";

const meta = {
  title: "Diagram Studio/Components/JsonCodeEditor",
  component: JsonCodeEditor,
  args: {
    label: "Candidate IR",
    value: JSON.stringify(
      {
        id: "example-flow",
        title: "Example flow",
        type: "flowchart",
        nodes: [
          { id: "start", label: "Start", kind: "start" },
          { id: "done", label: "Done", kind: "end" },
        ],
        edges: [{ id: "start-done", source: "start", target: "done" }],
      },
      null,
      2,
    ),
  },
} satisfies Meta<typeof JsonCodeEditor>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const ReadOnly: Story = {
  args: {
    label: "Excalidraw JSON",
    readOnly: true,
  },
};
