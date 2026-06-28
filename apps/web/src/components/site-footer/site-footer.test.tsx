import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SiteFooter } from "./site-footer";

describe("SiteFooter", () => {
  it("renders the footer columns and colophon", () => {
    render(<SiteFooter />);

    expect(screen.getByRole("heading", { name: "Product" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Surfaces" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Project" })).toBeTruthy();
    expect(
      screen.getByText("Sketchi v2 — typed diagram generation"),
    ).toBeTruthy();
  });

  it("uses configured surface links", () => {
    render(
      <SiteFooter
        surfaceUrls={{
          excalidraw: "https://sketchi-excalidraw-pr-42.dimethyl.workers.dev",
          icons: "https://sketchi-icons-pr-42.dimethyl.workers.dev",
          playground: "https://sketchi-playground-pr-42.dimethyl.workers.dev",
        }}
      />,
    );

    expect(
      screen.getByRole("link", { name: "Playground" }).getAttribute("href"),
    ).toBe("https://sketchi-playground-pr-42.dimethyl.workers.dev");
    expect(
      screen.getByRole("link", { name: "Excalidraw app" }).getAttribute("href"),
    ).toBe("https://sketchi-excalidraw-pr-42.dimethyl.workers.dev");
    expect(screen.getByRole("link", { name: "Icons" }).getAttribute("href")).toBe(
      "https://sketchi-icons-pr-42.dimethyl.workers.dev",
    );
  });
});
