import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SiteHeader } from "./site-header";

describe("SiteHeader", () => {
  it("renders the brand, primary nav, and app CTA", () => {
    render(<SiteHeader activePath="/docs" />);

    expect(screen.getByRole("link", { name: "Sketchi home" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Pipeline" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open app" })).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Docs" }).getAttribute("aria-current"),
    ).toBe("page");
  });

  it("uses configured surface action URLs", () => {
    render(
      <SiteHeader
        surfaceUrls={{
          excalidraw: "https://sketchi-excalidraw-pr-42.dimethyl.workers.dev",
          icons: "https://sketchi-icons-pr-42.dimethyl.workers.dev",
          playground: "https://sketchi-playground-pr-42.dimethyl.workers.dev",
        }}
      />,
    );

    expect(screen.getByRole("link", { name: "Icons" }).getAttribute("href")).toBe(
      "https://sketchi-icons-pr-42.dimethyl.workers.dev",
    );
    expect(
      screen.getByRole("link", { name: "Open app" }).getAttribute("href"),
    ).toBe("https://sketchi-excalidraw-pr-42.dimethyl.workers.dev");
  });

  it("toggles the mobile menu", () => {
    render(<SiteHeader />);

    const toggle = screen.getByRole("button", { name: "Toggle menu" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
  });
});
