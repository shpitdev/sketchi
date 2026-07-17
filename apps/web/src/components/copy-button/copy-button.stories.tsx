import type { Meta, StoryObj } from "@storybook/react-vite";

import { CopyButton } from "./copy-button";
import "../../styles/app.css";

const meta = {
  title: "Web/Components/CopyButton",
  component: CopyButton,
  tags: ["test"],
} satisfies Meta<typeof CopyButton>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    label: "install command",
    value: "codex plugin marketplace add shpitdev/sketchi",
  },
  render: (args) => (
    <div className="code-snippet" style={{ maxWidth: 460 }}>
      <pre className="docs-codeblock">
        <code>{args.value}</code>
      </pre>
      <CopyButton {...args} />
    </div>
  ),
};
