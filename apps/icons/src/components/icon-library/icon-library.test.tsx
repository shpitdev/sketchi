import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { IconManifest } from "../../lib/icon-data";
import { IconLibrary } from "./icon-library";

const fixtureData: IconManifest = {
  icons: [
    {
      aliases: [],
      bytes: 1802,
      collection: "ai-apps-agents",
      keywords: ["ai", "agents"],
      name: "Codex",
      slug: "codex",
      svgPath: "/icons/codex.svg",
      viewBox: { height: 512, minX: 0, minY: 0, width: 512 },
    },
    {
      aliases: ["k8s"],
      bytes: 1901,
      collection: "devtools-ci",
      keywords: ["containers"],
      name: "Kubernetes",
      slug: "kubernetes",
      svgPath: "/icons/kubernetes.svg",
      viewBox: { height: 512, minX: 0, minY: 0, width: 512 },
    },
    {
      aliases: ["psql", "postgres"],
      bytes: 901,
      collection: "data-storage",
      keywords: ["database"],
      name: "PostgreSQL",
      slug: "postgresql",
      svgPath: "/icons/postgresql.svg",
      viewBox: { height: 512, minX: 0, minY: 0, width: 512 },
    },
  ],
  summary: {
    collectionCounts: {
      "ai-apps-agents": 1,
      "data-storage": 1,
      "devtools-ci": 1,
    },
    totalIcons: 3,
  },
  version: 1,
};

describe("IconLibrary", () => {
  const writeText = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    writeText.mockClear();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve('<svg viewBox="0 0 1 1" />'),
      }),
    );
  });

  it("keeps the header wordmark on the shared script font", () => {
    const styles = readFileSync(
      resolve(process.cwd(), "apps/icons/src/styles/app.css"),
      "utf8",
    );
    const rootRoute = readFileSync(
      resolve(process.cwd(), "apps/icons/src/routes/__root.tsx"),
      "utf8",
    );
    expect(styles).toMatch(
      /\.icons-brand \.sk-wordmark\s*\{[^}]*font-family:\s*var\(--font-script\)/u,
    );
    expect(rootRoute).toContain("family=Dancing+Script");
  });

  it("renders the public product and finds a seeded alias", () => {
    render(<IconLibrary data={fixtureData} />);
    expect(
      screen.getByRole("heading", { name: "Icons, ready when you are." }),
    ).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Search icons"), {
      target: { value: "k8s" },
    });
    expect(screen.getByText("Kubernetes")).toBeTruthy();
    expect(screen.queryByText("Codex")).toBeNull();
  });

  it("copies raw SVG with one tile click and confirms it", async () => {
    render(<IconLibrary data={fixtureData} />);
    fireEvent.click(screen.getByRole("button", { name: "Copy Codex SVG" }));
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('<svg viewBox="0 0 1 1" />');
    });
    expect(screen.getByText("Codex SVG copied.")).toBeTruthy();
  });

  it("supports selection, detail actions, and preview backgrounds", () => {
    render(<IconLibrary data={fixtureData} />);
    fireEvent.click(screen.getByRole("button", { name: /add postgresql/i }));
    expect(screen.getByLabelText("Selected icons").textContent).toContain(
      "1icon selected",
    );
    fireEvent.click(
      screen.getByRole("button", { name: "View PostgreSQL details" }),
    );
    expect(
      screen.getByRole("dialog", { name: "PostgreSQL details" }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy data URI" })).toBeTruthy();
    const darkButton = screen.getAllByRole("button", { name: "Dark" })[0];
    if (!darkButton) throw new Error("Dark preview button was not rendered.");
    fireEvent.click(darkButton);
    expect(darkButton.getAttribute("aria-pressed")).toBe("true");
  });

  it("focuses search with slash and copies the keyboard result with Enter", async () => {
    render(<IconLibrary data={fixtureData} />);
    fireEvent.keyDown(window, { key: "/" });
    expect(document.activeElement).toBe(screen.getByLabelText("Search icons"));
    fireEvent.change(screen.getByLabelText("Search icons"), {
      target: { value: "psql" },
    });
    fireEvent.keyDown(window, { key: "Enter" });
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
  });

  it("does not run result shortcuts while an action control is focused", () => {
    render(<IconLibrary data={fixtureData} />);
    const selectButton = screen.getByRole("button", {
      name: "Add Codex to selection",
    });
    selectButton.focus();
    fireEvent.keyDown(selectButton, { key: "Enter" });
    expect(writeText).not.toHaveBeenCalled();
  });

  it("keeps background shortcuts inert while details are open and restores focus", () => {
    render(<IconLibrary data={fixtureData} initialQuery="psql" />);
    const opener = screen.getByRole("button", {
      name: "View PostgreSQL details",
    });
    opener.focus();
    fireEvent.click(opener);

    const search = screen.getByLabelText("Search icons");
    const main = search.closest("main");
    expect(main?.hasAttribute("inert")).toBe(true);
    fireEvent.keyDown(window, { key: "/" });
    expect(document.activeElement).not.toBe(search);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(opener);
    expect(search.getAttribute("value")).toBe("psql");
  });

  it("renders accessible loading, error, and empty states", () => {
    const { rerender } = render(<IconLibrary status="loading" />);
    expect(screen.getByLabelText("Loading icons")).toBeTruthy();
    rerender(
      <IconLibrary
        errorMessage="Connection failed."
        onRetry={() => undefined}
        status="error"
      />,
    );
    expect(screen.getByRole("alert").textContent).toContain(
      "Connection failed.",
    );
    rerender(
      <IconLibrary data={fixtureData} initialQuery="missing" key="empty" />,
    );
    expect(
      screen.getByRole("heading", { name: "No icons found." }),
    ).toBeTruthy();
  });
});
