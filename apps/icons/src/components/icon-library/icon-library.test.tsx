import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { IconLibrary, type IconLibraryData } from "./icon-library";

const fixtureData: IconLibraryData = {
  icons: [
    {
      bytes: 1802,
      collection: "ai-apps-agents",
      fileName: "codex.svg",
      flags: [],
      id: "ai-apps-agents:codex",
      slug: "codex",
      urlPath: "/output/upload-ready/svg/ai-apps-agents/codex.svg",
    },
    {
      bytes: 1901,
      collection: "auth-identity",
      fileName: "workos.svg",
      flags: ["duplicate-raster"],
      id: "auth-identity:workos",
      slug: "workos",
      urlPath: "/output/upload-ready/svg/auth-identity/workos.svg",
    },
    {
      bytes: 901,
      collection: "auth-identity",
      fileName: "workos-text.svg",
      flags: [],
      id: "auth-identity:workos-text",
      slug: "workos-text",
      urlPath: "/output/upload-ready/svg/auth-identity/workos-text.svg",
      variant: "text",
    },
  ],
  summary: {
    collectionCounts: {
      "ai-apps-agents": 1,
      "auth-identity": 2,
    },
    flagCounts: {
      "duplicate-raster": 1,
    },
    totalIcons: 3,
  },
};

describe("IconLibrary", () => {
  it("renders the summary and filters by query", () => {
    render(<IconLibrary data={fixtureData} />);

    expect(
      screen.getByRole("heading", { name: "Curated icon output" }),
    ).toBeTruthy();
    expect(screen.getByLabelText("Icon summary").textContent).toContain(
      "3 icons",
    );

    fireEvent.change(screen.getByLabelText("Search icons"), {
      target: { value: "workos" },
    });

    expect(screen.getByText("workos")).toBeTruthy();
    expect(screen.queryByText("codex")).toBeNull();
  });

  it("filters by asset kind and sorts dense results", () => {
    render(<IconLibrary data={fixtureData} />);

    fireEvent.change(screen.getByLabelText("Asset kind"), {
      target: { value: "text" },
    });

    expect(screen.getByText("workos-text")).toBeTruthy();
    expect(screen.queryByText("workos")).toBeNull();

    fireEvent.change(screen.getByLabelText("Asset kind"), {
      target: { value: "all" },
    });
    fireEvent.change(screen.getByLabelText("Sort icons"), {
      target: { value: "largest" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Compact" }));

    expect(document.querySelector(".icon-card")?.textContent).toContain(
      "workos",
    );
    expect(
      screen
        .getByRole("button", { name: "Compact" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("opens an icon's detail when selected", () => {
    render(<IconLibrary data={fixtureData} />);

    fireEvent.click(screen.getByText("workos"));

    expect(screen.getByRole("heading", { name: "workos" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy SVG" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Download" })).toBeTruthy();
  });

  it("closes stale details when filters exclude the selected icon", () => {
    render(<IconLibrary data={fixtureData} />);

    fireEvent.click(screen.getByText("workos"));
    expect(screen.getByRole("heading", { name: "workos" })).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Search icons"), {
      target: { value: "codex" },
    });

    expect(screen.queryByRole("heading", { name: "workos" })).toBeNull();
    expect(screen.getByText("codex")).toBeTruthy();
  });

  it("shows a loading state", () => {
    render(<IconLibrary status="loading" />);

    expect(screen.getByRole("status").textContent).toContain(
      "Loading icon output",
    );
  });
});
