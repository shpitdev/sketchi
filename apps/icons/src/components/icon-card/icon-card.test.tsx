import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { SketchiIcon } from "../../lib/icon-data";
import { IconCard } from "./icon-card";

const icon: SketchiIcon = {
  bytes: 1802,
  collection: "ai-apps-agents",
  fileName: "codex.svg",
  flags: [],
  id: "ai-apps-agents:codex",
  slug: "codex",
  urlPath: "/output/upload-ready/svg/ai-apps-agents/codex.svg",
};

describe("IconCard", () => {
  it("renders the icon and reports selection", () => {
    const onSelect = vi.fn();
    render(<IconCard icon={icon} onSelect={onSelect} />);

    expect(screen.getByText("codex")).toBeTruthy();
    expect(screen.getByText("ai-apps-agents")).toBeTruthy();
    expect(screen.getByRole("img", { name: "codex icon" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button"));
    expect(onSelect).toHaveBeenCalledWith(icon);
  });
});
