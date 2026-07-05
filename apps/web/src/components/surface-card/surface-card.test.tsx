import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SurfaceCard } from "./surface-card";

describe("SurfaceCard", () => {
  it("renders the surface details and links out", () => {
    render(
      <SurfaceCard
        cta="Open Playground"
        desc="Anonymous prompt-to-diagram generation."
        domain="playground.sketchi.app"
        href="https://playground.sketchi.app"
        name="Sketchi Playground"
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Sketchi Playground" }),
    ).toBeTruthy();
    expect(screen.getByText("playground.sketchi.app")).toBeTruthy();
    expect(screen.getByText("No-auth preview")).toBeTruthy();
    expect(screen.getByRole("link").getAttribute("href")).toBe(
      "https://playground.sketchi.app",
    );
  });

  it("shows a live status when requested", () => {
    render(
      <SurfaceCard
        desc="Docs"
        domain="sketchi.app/docs"
        href="/docs"
        name="Documentation"
        status="live"
      />,
    );

    expect(screen.getByText("Live")).toBeTruthy();
  });

  it("shows a beta status when requested", () => {
    render(
      <SurfaceCard
        desc="Persisted projects are not public yet."
        domain="studio.sketchi.app"
        href="/docs#studio-beta"
        name="Studio"
        status="beta"
      />,
    );

    expect(screen.getByText("Private beta")).toBeTruthy();
  });
});
