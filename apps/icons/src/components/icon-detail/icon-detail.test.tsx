import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { SketchiIcon } from "../../lib/icon-data";
import { IconDetail } from "./icon-detail";

const icon: SketchiIcon = {
  bytes: 1901,
  collection: "auth-identity",
  fileName: "workos.svg",
  flags: ["duplicate-raster"],
  id: "auth-identity:workos",
  slug: "workos",
  urlPath: "/output/upload-ready/svg/auth-identity/workos.svg",
  viewBox: { height: 512, minX: 0, minY: 0, width: 512 },
};

describe("IconDetail", () => {
  it("renders metadata, flags, and copy/download actions", () => {
    render(<IconDetail icon={icon} />);

    expect(screen.getByRole("heading", { name: "workos" })).toBeTruthy();
    expect(screen.getByText("workos.svg")).toBeTruthy();
    expect(screen.getByText("512×512")).toBeTruthy();
    expect(screen.getByText("duplicate-raster")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy SVG" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy path" })).toBeTruthy();

    const download = screen.getByRole("link", { name: "Download" });
    expect(download.getAttribute("href")).toBe(icon.urlPath);
    expect(download.getAttribute("download")).toBe("workos.svg");
  });

  it("copies the SVG markup and path", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve("<svg />"),
      }),
    );

    render(<IconDetail icon={icon} />);

    fireEvent.click(screen.getByRole("button", { name: "Copy SVG" }));
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith("<svg />");
    });

    fireEvent.click(screen.getByRole("button", { name: "Copy path" }));
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(icon.urlPath);
    });

    expect(screen.getByText("Copied to clipboard.")).toBeTruthy();
  });
});
