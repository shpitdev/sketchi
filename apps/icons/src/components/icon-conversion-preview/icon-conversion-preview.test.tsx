import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@sketchi/diagram-studio-ui", () => ({
  ExcalidrawSceneCanvas: ({
    scene,
    title,
  }: {
    scene: { elements: readonly { type: string }[] };
    title: string;
  }) => (
    <section aria-label={title} data-elements={scene.elements.length}>
      Native canvas
    </section>
  ),
}));

import type { SketchiIcon } from "../../lib/icon-data";
import { IconConversionPreview } from "./icon-conversion-preview";

const icon: SketchiIcon = {
  bytes: 120,
  collection: "testing",
  fileName: "sample.svg",
  flags: [],
  id: "testing:sample",
  slug: "sample",
  urlPath: "/output/upload-ready/svg/testing/sample.svg",
};

const supportedSvg =
  '<svg viewBox="0 0 20 20"><path fill="#f00" d="M0 0H20V20H0Z"/></svg>';
const warnedSvg =
  '<svg viewBox="0 0 20 20"><defs><linearGradient id="g"><stop stop-color="#f00"/><stop offset="1" stop-color="#00f"/></linearGradient></defs><rect width="20" height="20" fill="url(#g)"/></svg>';
const blockedSvg =
  '<svg viewBox="0 0 20 20"><filter id="f"><feBlur stdDeviation="2"/></filter><rect width="20" height="20" filter="url(#f)"/></svg>';

describe("IconConversionPreview", () => {
  it("loads conversion only when Native is selected", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(supportedSvg),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <IconConversionPreview
        fetchSource={fetchMock as typeof fetch}
        icon={icon}
      />,
    );

    expect(screen.getByText("Not checked")).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("tab", { name: "Native" }));

    await waitFor(() => {
      expect(screen.getByText("Native supported")).toBeTruthy();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await screen.findByLabelText("sample native preview")).toBeTruthy();
    expect(screen.getByText("1 elements")).toBeTruthy();
  });

  it("can retry a failed lazy source fetch", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 503 });
    vi.stubGlobal("fetch", fetchMock);
    render(
      <IconConversionPreview
        fetchSource={fetchMock as typeof fetch}
        icon={icon}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: "Native" }));
    const retry = await screen.findByRole("button", {
      name: "Retry native preview",
    });
    fetchMock.mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(supportedSvg),
    });
    fireEvent.click(retry);

    expect(await screen.findByText("Native supported")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("reconverts controls and builds a preview-aware workspace handoff", async () => {
    render(
      <IconConversionPreview
        icon={icon}
        iconsOrigin="https://sketchi-icons-pr-91.dimethyl.workers.dev"
        initialMode="native"
        initialSource={supportedSvg}
      />,
    );

    fireEvent.change(screen.getByLabelText("Roughness"), {
      target: { value: "2" },
    });
    fireEvent.change(screen.getByLabelText("Fill style"), {
      target: { value: "hachure" },
    });
    fireEvent.change(screen.getByLabelText("Color mode"), {
      target: { value: "monochrome" },
    });

    const workspace = await screen.findByRole("link", {
      name: "Open in Workspace",
    });
    const href = new URL(workspace.getAttribute("href") ?? "");
    expect(href.origin).toBe(
      "https://sketchi-excalidraw-pr-91.dimethyl.workers.dev",
    );
    expect(href.searchParams.get("roughness")).toBe("2");
    expect(href.searchParams.get("fillStyle")).toBe("hachure");
    expect(href.searchParams.get("colorMode")).toBe("monochrome");
    expect(
      screen.getByRole("button", { name: "Download library" }),
    ).not.toHaveProperty("disabled", true);
  });

  it("distinguishes warned and blocked capabilities", async () => {
    const { rerender } = render(
      <IconConversionPreview
        icon={icon}
        initialMode="native"
        initialSource={warnedSvg}
      />,
    );
    expect(await screen.findByText("Native with warnings")).toBeTruthy();
    expect(screen.getByLabelText("Conversion diagnostics")).toBeTruthy();

    rerender(
      <IconConversionPreview
        icon={{ ...icon, id: "testing:blocked" }}
        key="blocked"
        initialMode="native"
        initialSource={blockedSvg}
      />,
    );
    expect(await screen.findByText("Native blocked")).toBeTruthy();
    expect(
      screen.getByText("Native conversion is unavailable for this SVG."),
    ).toBeTruthy();
    expect(
      screen.getByText("Open in Workspace").getAttribute("aria-disabled"),
    ).toBe("true");
  });
});
