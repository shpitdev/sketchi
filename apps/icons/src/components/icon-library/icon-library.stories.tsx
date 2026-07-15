import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent } from "storybook/test";

import type { IconLibraryData } from "../../lib/icon-data";
import { IconLibrary } from "./icon-library";
import "../../styles/app.css";

const red =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Crect x='3' y='3' width='18' height='18' rx='5' fill='%23e5431d'/%3E%3C/svg%3E";
const blue =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Ccircle cx='12' cy='12' r='9' fill='%231f44c9'/%3E%3C/svg%3E";

const fixtureData: IconLibraryData = {
  generatedAt: "2026-06-06T16:05:35.422Z",
  icons: [
    {
      bytes: 1802,
      collection: "ai-apps-agents",
      fileName: "codex.svg",
      flags: [],
      id: "ai-apps-agents:codex",
      slug: "codex",
      urlPath: red,
      viewBox: { height: 512, minX: 0, minY: 0, width: 512 },
    },
    {
      bytes: 714,
      collection: "ai-apps-agents",
      fileName: "akashchat.svg",
      flags: [],
      id: "ai-apps-agents:akashchat",
      slug: "akashchat",
      urlPath: blue,
    },
    {
      bytes: 1901,
      collection: "auth-identity",
      fileName: "workos.svg",
      flags: ["duplicate-raster"],
      id: "auth-identity:workos",
      slug: "workos",
      urlPath: red,
      viewBox: { height: 512, minX: 0, minY: 0, width: 512 },
    },
    {
      bytes: 1420,
      collection: "frontend-frameworks",
      fileName: "react.svg",
      flags: [],
      id: "frontend-frameworks:react",
      slug: "react",
      urlPath: blue,
    },
  ],
  summary: {
    collectionCounts: {
      "ai-apps-agents": 2,
      "auth-identity": 1,
      "frontend-frameworks": 1,
    },
    flagCounts: {
      "duplicate-raster": 1,
    },
    totalIcons: 4,
  },
};

const meta = {
  title: "Icons/Components/IconLibrary",
  component: IconLibrary,
  args: {
    data: fixtureData,
    status: "ready",
  },
  parameters: {
    layout: "fullscreen",
  },
  tags: ["test"],
} satisfies Meta<typeof IconLibrary>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const FilteredSearch: Story = {
  play: async ({ canvas }) => {
    await userEvent.type(canvas.getByLabelText("Search icons"), "workos");
    await expect(canvas.getByText("workos")).toBeDefined();
    await expect(canvas.queryByText("codex")).toBeNull();
  },
};

export const Loading: Story = {
  args: {
    status: "loading",
  },
};

export const ErrorState: Story = {
  args: {
    errorMessage: "review-data.json is missing",
    status: "error",
  },
};
