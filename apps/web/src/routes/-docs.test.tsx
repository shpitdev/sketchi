import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DocsPage } from "./docs";

const previewSurfaceUrls = {
  icons: "https://sketchi-icons-pr-123.dimethyl.workers.dev",
  playground: "https://sketchi-studio-pr-123.dimethyl.workers.dev",
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
      screen
        .getAllByRole("link", { name: "Playground" })
        .map((link) => link.getAttribute("href")),
    ).toEqual([previewSurfaceUrls.playground, previewSurfaceUrls.playground]);
    expect(screen.queryByRole("link", { name: "Excalidraw app" })).toBeNull();
  });
});
