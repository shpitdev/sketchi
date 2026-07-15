import type { Meta, StoryObj } from "@storybook/react-vite";

import { IconConversionPreview } from "./icon-conversion-preview";
import "../../styles/app.css";

const supportedSvg =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path fill="#ff6b35" fill-rule="evenodd" d="M5 5H95V95H5Z M30 30H70V70H30Z"/></svg>';
const warnedSvg =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><linearGradient id="g"><stop stop-color="#f00"/><stop offset="1" stop-color="#00f"/></linearGradient></defs><circle cx="50" cy="50" r="45" fill="url(#g)"/></svg>';
const blockedSvg =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><filter id="f"><feGaussianBlur stdDeviation="4"/></filter><circle cx="50" cy="50" r="45" filter="url(#f)"/></svg>';
const icon = {
  bytes: 256,
  collection: "storybook",
  fileName: "ace.svg",
  flags: [],
  id: "storybook:ace",
  slug: "ace",
  urlPath: "/output/upload-ready/svg/ai-apps-agents/ace.svg",
};

const meta = {
  title: "Icons/Components/IconConversionPreview",
  component: IconConversionPreview,
  args: {
    icon,
    iconsOrigin: "https://sketchi-icons-pr-91.dimethyl.workers.dev",
    initialMode: "native",
    initialSource: supportedSvg,
  },
  decorators: [
    (Story) => (
      <div style={{ height: 680, maxWidth: 760 }}>
        <Story />
      </div>
    ),
  ],
  tags: ["test"],
} satisfies Meta<typeof IconConversionPreview>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Supported: Story = {};

export const Warned: Story = {
  args: {
    initialSource: warnedSvg,
  },
};

export const Blocked: Story = {
  args: {
    initialSource: blockedSvg,
  },
};

export const Original: Story = {
  args: {
    initialMode: "original",
  },
};
