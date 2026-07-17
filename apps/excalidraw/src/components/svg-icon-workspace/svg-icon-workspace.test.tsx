import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@sketchi/diagram-ui", () => ({
  ExcalidrawSceneCanvas: ({
    onChange,
    scene,
    title,
  }: {
    onChange?: (elements: readonly ExcalidrawElement[]) => void;
    scene: { readonly elements: readonly ExcalidrawElement[] };
    title: string;
  }) => (
    <section aria-label={title}>
      Editable canvas
      <button
        onClick={() => {
          onChange?.(
            scene.elements.map((element, index) =>
              index === 0
                ? {
                    ...element,
                    groupIds: ["workspace-edited"],
                    strokeColor: "#ff006e",
                    version: element.version + 1,
                    x: element.x + 24,
                  }
                : element,
            ),
          );
        }}
        type="button"
      >
        Apply representative edit
      </button>
    </section>
  ),
}));

import type { SvgHandoff } from "../../lib/svg-handoff";
import { SvgIconWorkspace } from "./svg-icon-workspace";

const handoff: SvgHandoff = {
  options: {
    colorProfile: { kind: "preserve" },
    fillStyle: "solid",
    roughness: 1,
  },
  sourceUrl:
    "https://sketchi-icons-pr-91.dimethyl.workers.dev/output/upload-ready/svg/testing/sample.svg",
};
const supportedSvg =
  '<svg viewBox="0 0 20 20"><path fill="#f00" d="M0 0H20V20H0Z"/></svg>';
const blockedSvg =
  '<svg viewBox="0 0 20 20"><filter id="f"><feGaussianBlur stdDeviation="2"/></filter><rect width="20" height="20" filter="url(#f)"/></svg>';

describe("SvgIconWorkspace", () => {
  it("renders a URL-imported SVG as an editable native scene", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      headers: new Headers({ "content-type": "image/svg+xml" }),
      ok: true,
      text: () => Promise.resolve(supportedSvg),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<SvgIconWorkspace handoff={handoff} />);

    await waitFor(() => {
      expect(screen.getByLabelText("sample.svg editable canvas")).toBeTruthy();
    });
    expect(fetchMock).toHaveBeenCalledWith(handoff.sourceUrl, {
      redirect: "error",
    });
    expect(screen.getByText("Editable native elements")).toBeTruthy();
    expect(screen.getByText("Elements").parentElement?.textContent).toBe(
      "Elements1",
    );
    expect(
      screen.getByRole("button", { name: "Download library" }),
    ).not.toHaveProperty("disabled", true);
  });

  it("downloads the current edited scene instead of the source conversion", async () => {
    const createObjectUrl = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:edited-library");
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);
    render(<SvgIconWorkspace handoff={handoff} initialSource={supportedSvg} />);

    fireEvent.click(
      screen.getByRole("button", { name: "Apply representative edit" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Download library" }));

    const blob = createObjectUrl.mock.calls[0]?.[0];
    expect(blob).toBeInstanceOf(Blob);
    if (!(blob instanceof Blob)) {
      return;
    }
    const library = JSON.parse(await blob.text());
    expect(library.libraryItems[0].elements[0]).toMatchObject({
      groupIds: ["workspace-edited"],
      strokeColor: "#ff006e",
      x: 24,
    });
    expect(click).toHaveBeenCalledOnce();
  });

  it("keeps blocked capability diagnostics out of the editor", () => {
    render(<SvgIconWorkspace handoff={handoff} initialSource={blockedSvg} />);

    expect(screen.getByText("Native import unavailable")).toBeTruthy();
    expect(screen.queryByText("Editable canvas")).toBeNull();
    expect(screen.getByLabelText("Import diagnostics")).toBeTruthy();
    expect(
      screen
        .getByRole("button", { name: "Download library" })
        .getAttribute("disabled"),
    ).not.toBeNull();
  });

  it("rejects non-SVG and oversized allowlisted responses", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        headers: new Headers({ "content-type": "text/html" }),
        ok: true,
        text: () => Promise.resolve("<svg />"),
      })
      .mockResolvedValueOnce({
        headers: new Headers({
          "content-length": "1000001",
          "content-type": "image/svg+xml",
        }),
        ok: true,
        text: () => Promise.resolve("<svg />"),
      });
    vi.stubGlobal("fetch", fetchMock);
    const { rerender } = render(<SvgIconWorkspace handoff={handoff} />);

    expect(
      await screen.findByText(
        "Icon source did not return an SVG content type.",
      ),
    ).toBeTruthy();
    rerender(
      <SvgIconWorkspace
        handoff={{
          ...handoff,
          sourceUrl: handoff.sourceUrl.replace("sample", "large"),
        }}
      />,
    );
    expect(
      await screen.findByText(
        "Icon SVG exceeds the 1 MB workspace import limit.",
      ),
    ).toBeTruthy();
  });

  it("surfaces cross-origin fetch failures", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 403 }),
    );
    render(<SvgIconWorkspace handoff={handoff} />);

    await waitFor(() => {
      expect(screen.getByText("Icon SVG returned HTTP 403.")).toBeTruthy();
    });
  });
});
