import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { SketchiIcon } from "../../lib/icon-data";
import { IconDetail } from "./icon-detail";

const icon: SketchiIcon = {
  aliases: ["postgres", "psql"],
  bytes: 1901,
  collection: "data-storage",
  keywords: ["data", "database"],
  name: "PostgreSQL",
  slug: "postgresql",
  svgPath: "/output/upload-ready/svg/data-storage/postgresql.svg",
  viewBox: { height: 512, minX: 0, minY: 0, width: 512 },
};

describe("IconDetail", () => {
  it("shows preview, metadata, permanent URL, and every use action", () => {
    render(
      <IconDetail
        icon={icon}
        permanentUrl="https://icons.sketchi.app/api/icons/postgresql.svg"
      />,
    );

    expect(screen.getByRole("heading", { name: "PostgreSQL" })).toBeTruthy();
    const dialog = screen.getByRole("dialog", { name: "PostgreSQL details" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Close icon details" }),
    );
    expect(screen.getByText("512 × 512")).toBeTruthy();
    expect(screen.getByText("1.9 KB")).toBeTruthy();
    expect(screen.getByText(/api\/icons\/postgresql.svg/)).toBeTruthy();
    for (const name of [
      "Copy SVG",
      "Copy URL",
      "Copy JSX",
      "Copy data URI",
      "Download SVG",
    ]) {
      expect(screen.getByRole("button", { name })).toBeTruthy();
    }
  });

  it("reports action and preview changes", () => {
    const onAction = vi.fn();
    const onPreviewModeChange = vi.fn();
    render(
      <IconDetail
        icon={icon}
        onAction={onAction}
        onPreviewModeChange={onPreviewModeChange}
        permanentUrl="https://icons.test/api/icons/postgresql.svg"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Copy JSX" }));
    fireEvent.click(screen.getByRole("button", { name: "Dark" }));
    expect(onAction).toHaveBeenCalledWith("copy-jsx", icon);
    expect(onPreviewModeChange).toHaveBeenCalledWith("dark");
  });

  it("traps focus, closes with Escape, and restores the opener", () => {
    const onClose = vi.fn();
    const opener = document.createElement("button");
    document.body.append(opener);
    opener.focus();
    const { unmount } = render(
      <IconDetail
        icon={icon}
        onClose={onClose}
        permanentUrl="https://icons.test/api/icons/postgresql.svg"
        returnFocusTo={opener}
      />,
    );
    const close = screen.getByRole("button", { name: "Close icon details" });
    const download = screen.getByRole("button", { name: "Download SVG" });

    expect(document.activeElement).toBe(close);
    fireEvent.keyDown(window, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(download);
    fireEvent.keyDown(window, { key: "Tab" });
    expect(document.activeElement).toBe(close);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();

    unmount();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });
});
