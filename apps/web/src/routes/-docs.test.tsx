import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DocsPage } from "./docs";

const previewSurfaceUrls = {
  excalidraw: "https://sketchi-excalidraw-pr-123.dimethyl.workers.dev",
  icons: "https://sketchi-icons-pr-123.dimethyl.workers.dev",
  playground: "https://sketchi-playground-pr-123.dimethyl.workers.dev",
};

describe("DocsPage", () => {
  it("uses configured preview surface URLs in the header and footer", () => {
    render(<DocsPage surfaceUrls={previewSurfaceUrls} />);

    expect(
      screen
        .getAllByRole("link", { name: "Icons" })
        .map((link) => link.getAttribute("href")),
    ).toContain(previewSurfaceUrls.icons);
    expect(
      screen.getByRole("link", { name: "Open app" }).getAttribute("href"),
    ).toBe(previewSurfaceUrls.excalidraw);
    expect(
      screen.getByRole("link", { name: "Excalidraw app" }).getAttribute("href"),
    ).toBe(previewSurfaceUrls.excalidraw);
    expect(
      screen.getByRole("link", { name: "Playground" }).getAttribute("href"),
    ).toBe(previewSurfaceUrls.playground);
  });
});
