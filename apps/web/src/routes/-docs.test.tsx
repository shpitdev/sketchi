import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Route } from "./docs";

const DocsRoute = Route.options.component;
if (!DocsRoute) throw new Error("Missing docs route component.");

const previewSurfaceUrls = vi.hoisted(() => ({
  icons: "https://sketchi-icons-pr-123.dimethyl.workers.dev",
  playground: "https://sketchi-studio-pr-123.dimethyl.workers.dev",
}));

vi.mock("../lib/surface-urls-rpc", () => ({ getWebSurfaceUrls: vi.fn() }));
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: object) => ({
    options,
    useLoaderData: () => previewSurfaceUrls,
  }),
}));

describe("DocsRoute", () => {
  it("uses configured preview surface URLs in the header and footer", () => {
    render(<DocsRoute />);

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
