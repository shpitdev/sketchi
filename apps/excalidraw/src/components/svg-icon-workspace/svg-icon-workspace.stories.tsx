import type { Meta, StoryObj } from "@storybook/react-vite";

import { SvgIconWorkspace } from "./svg-icon-workspace";
import "../../styles/app.css";
import "@sketchi/diagram-studio-ui/styles.css";

const supportedSvg =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path fill="#ff6b35" fill-rule="evenodd" d="M5 5H95V95H5Z M30 30H70V70H30Z"/></svg>';
const blockedSvg =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><filter id="f"><feGaussianBlur stdDeviation="4"/></filter><circle cx="50" cy="50" r="45" filter="url(#f)"/></svg>';

const meta = {
  title: "Excalidraw/Components/SvgIconWorkspace",
  component: SvgIconWorkspace,
  args: {
    handoff: {
      options: {
        colorProfile: { color: "#5f3dc4", kind: "monochrome" },
        fillStyle: "hachure",
        roughness: 2,
      },
      sourceUrl:
        "https://sketchi-icons-pr-91.dimethyl.workers.dev/output/upload-ready/svg/storybook/native-fixture.svg",
    },
    initialSource: supportedSvg,
  },
  parameters: { layout: "fullscreen" },
  tags: ["test"],
} satisfies Meta<typeof SvgIconWorkspace>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Editable: Story = {};

export const Blocked: Story = {
  args: { initialSource: blockedSvg },
};
