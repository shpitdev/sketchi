import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { SketchiIcon } from "../../lib/icon-data";
import { IconCard } from "./icon-card";

const icon: SketchiIcon = {
  aliases: [],
  bytes: 1802,
  collection: "ai-apps-agents",
  keywords: ["ai", "agents"],
  name: "Codex",
  slug: "codex",
  svgPath: "/output/upload-ready/svg/ai-apps-agents/codex.svg",
  viewBox: { height: 512, minX: 0, minY: 0, width: 512 },
};

describe("IconCard", () => {
  it("makes raw SVG copy the primary tile action", () => {
    const onCopy = vi.fn();
    render(<IconCard icon={icon} onCopy={onCopy} />);

    expect(screen.getByText("Codex")).toBeTruthy();
    expect(screen.getByText("AI Apps Agents")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Copy Codex SVG" }));
    expect(onCopy).toHaveBeenCalledWith(icon);
  });

  it("keeps selection and details as separate accessible actions", () => {
    const onDetails = vi.fn();
    const onToggleSelected = vi.fn();
    render(
      <IconCard
        icon={icon}
        onDetails={onDetails}
        onToggleSelected={onToggleSelected}
        selected
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /remove codex/i }));
    fireEvent.click(
      screen.getByRole("button", { name: /view codex details/i }),
    );
    expect(onToggleSelected).toHaveBeenCalledWith(icon);
    expect(onDetails).toHaveBeenCalledWith(icon);
  });
});
