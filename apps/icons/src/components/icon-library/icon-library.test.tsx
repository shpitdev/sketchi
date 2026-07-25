import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
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
    // The script font is Excalifont, self-hosted from this surface's own
    // public/ rather than fetched from Google, so the wordmark renders in the
    // same face the diagrams do. Preloading the Latin subset is what keeps it
    // from painting the fallback first.
    expect(rootRoute).not.toContain("family=Dancing+Script");
    expect(rootRoute).toContain(
      "/fonts/Excalifont/Excalifont-Regular-a88b72a24fb54c9f94e3b5fdaa7481c9.woff2",
    );
  });

  it("calls the agent entry point llms.txt everywhere it appears", () => {
    render(<IconLibrary data={fixtureData} />);
    const links = screen.getAllByRole("link", { name: "llms.txt" });
    expect(links).toHaveLength(2);
    for (const link of links) {
      expect(link.getAttribute("href")).toBe("/llms.txt");
    }
    expect(screen.queryByText("Agent API")).toBeNull();
    expect(screen.queryByText("For agents")).toBeNull();
    // The hero rail carries counts only; the agent link lives in the nav.
    expect(screen.getByLabelText("Library summary").textContent).toBe(
      "3Icons3Collections",
    );
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
    fireEvent.keyDown(document, { key: "/" });
    const search = screen.getByLabelText("Search icons");
    expect(document.activeElement).toBe(search);
    fireEvent.change(search, { target: { value: "psql" } });
    fireEvent.keyDown(search, { key: "Enter" });
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
  });

  it("focuses search from layouts where slash is a shifted key", () => {
    render(<IconLibrary data={fixtureData} />);
    // German QWERTZ produces "/" as Shift+7.
    fireEvent.keyDown(document, { code: "Digit7", key: "/", shiftKey: true });
    expect(document.activeElement).toBe(screen.getByLabelText("Search icons"));
  });

  it("starts with no active card and only highlights once the user navigates", () => {
    const { container } = render(<IconLibrary data={fixtureData} />);
    const activeCards = () =>
      container.querySelectorAll('[data-active="true"]');
    expect(activeCards()).toHaveLength(0);

    fireEvent.keyDown(document, { key: "ArrowDown" });
    expect(activeCards()).toHaveLength(1);
    expect(activeCards()[0]?.textContent).toContain("Codex");

    fireEvent.keyDown(document, { key: "ArrowDown" });
    expect(activeCards()[0]?.textContent).toContain("Kubernetes");

    // Escape drops the highlight again rather than parking it on a card.
    fireEvent.keyDown(document, { key: "Escape" });
    expect(activeCards()).toHaveLength(0);
  });

  it("does not run result shortcuts while an action control is focused", () => {
    const { container } = render(<IconLibrary data={fixtureData} />);
    fireEvent.keyDown(document, { key: "ArrowDown" });
    const selectButton = screen.getByRole("button", {
      name: "Add Codex to selection",
    });
    selectButton.focus();

    fireEvent.keyDown(selectButton, { key: "Enter" });
    expect(writeText).not.toHaveBeenCalled();

    // Arrow keys belong to the focused control too: the highlight must not
    // move and the default scroll must not be swallowed.
    const moved = fireEvent.keyDown(selectButton, { key: "ArrowDown" });
    expect(moved).toBe(true);
    expect(
      container.querySelector('[data-active="true"]')?.textContent,
    ).toContain("Codex");
  });

  it("selects every filtered result and clears the selection by shortcut", () => {
    render(<IconLibrary data={fixtureData} />);
    fireEvent.keyDown(document, { key: "a", ctrlKey: true });
    expect(screen.getByLabelText("Selected icons").textContent).toContain(
      "3icons selected",
    );

    fireEvent.keyDown(document, { key: "d", ctrlKey: true });
    expect(screen.queryByLabelText("Selected icons")).toBeNull();
  });

  it("keeps every toggle when several land in one batch", () => {
    // Handlers reading the selection from their render closure lose all but the
    // last update when they run without a re-render in between — verified in a
    // real browser, where five same-tick clicks left one icon selected.
    render(<IconLibrary data={fixtureData} />);
    const selectButtons = screen.getAllByRole("button", {
      name: /to selection$/,
    });
    expect(selectButtons).toHaveLength(3);

    act(() => {
      for (const button of selectButtons) button.click();
    });
    expect(screen.getByLabelText("Selected icons").textContent).toContain(
      "3icons selected",
    );

    // ...and the reverse: three deselects in one batch clear all three.
    act(() => {
      for (const button of screen.getAllByRole("button", {
        name: /from selection$/,
      })) {
        button.click();
      }
    });
    expect(screen.queryByLabelText("Selected icons")).toBeNull();
  });

  it("clears the selection from the search field, where filtering happens", () => {
    render(<IconLibrary data={fixtureData} />);
    fireEvent.click(screen.getByRole("button", { name: "Select all 3" }));
    expect(screen.getByLabelText("Selected icons")).toBeTruthy();

    // Mod+A deliberately yields to text selection in the field, but Mod+D has
    // no in-field behaviour to protect, so it must still clear.
    const search = screen.getByLabelText("Search icons");
    search.focus();
    fireEvent.keyDown(search, { ctrlKey: true, key: "d" });
    expect(screen.queryByLabelText("Selected icons")).toBeNull();
  });

  it("leaves the browser's own shortcuts alone when it has nothing to do", () => {
    // A registered hotkey suppresses the native default even when the callback
    // bails, so these must not register in states where they cannot act.
    const { unmount } = render(
      <IconLibrary data={fixtureData} initialQuery="missing" />,
    );
    // No results to gather, and no selection to clear.
    expect(fireEvent.keyDown(document, { ctrlKey: true, key: "a" })).toBe(true);
    expect(fireEvent.keyDown(document, { ctrlKey: true, key: "d" })).toBe(true);
    // There is a query, so Escape still belongs to us here.
    expect(fireEvent.keyDown(document, { key: "Escape" })).toBe(false);
    // ...but not once there is nothing left to clear.
    expect(fireEvent.keyDown(document, { key: "Escape" })).toBe(true);
    expect(screen.queryByLabelText("Selected icons")).toBeNull();
    unmount();

    // Select-all also passes through once everything shown is already selected.
    render(<IconLibrary data={fixtureData} />);
    expect(fireEvent.keyDown(document, { ctrlKey: true, key: "a" })).toBe(
      false,
    );
    expect(screen.getByLabelText("Selected icons").textContent).toContain(
      "3icons selected",
    );
    expect(fireEvent.keyDown(document, { ctrlKey: true, key: "a" })).toBe(true);
  });

  it("scopes the select-all control to the current filter", () => {
    render(<IconLibrary data={fixtureData} initialQuery="psql" />);
    fireEvent.click(screen.getByRole("button", { name: "Select all 1" }));
    expect(screen.getByLabelText("Selected icons").textContent).toContain(
      "1icon selected",
    );
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
    fireEvent.keyDown(document, { key: "/" });
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
