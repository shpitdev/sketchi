import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  waitForElementToBeRemoved,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import "@sketchi/diagram-ui/styles.css";
import "../../styles/app.css";
import type { SvgHandoff } from "../../lib/svg-handoff";
import { SvgIconWorkspace } from "./svg-icon-workspace";

const handoff: SvgHandoff = {
  options: {
    colorProfile: { kind: "preserve" },
    fillStyle: "hachure",
    roughness: 2,
  },
  sourceUrl:
    "https://sketchi-icons.dimethyl.workers.dev/output/upload-ready/svg/testing/editable.svg",
};
const source =
  '<svg viewBox="0 0 100 100"><path fill="#5f3dc4" fill-rule="evenodd" d="M5 5H95V95H5Z M30 30H70V70H30Z"/></svg>';

afterEach(cleanup);

describe("SVG icon real-editor handoff", () => {
  it("edits real native elements and downloads the changed scene", async () => {
    const downloads: Blob[] = [];
    vi.spyOn(URL, "createObjectURL").mockImplementation((value) => {
      if (value instanceof Blob) {
        downloads.push(value);
      }
      return `blob:workspace-download-${downloads.length}`;
    });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
      () => undefined,
    );
    let editorApi: ExcalidrawImperativeAPI | null = null;
    render(
      <SvgIconWorkspace
        handoff={handoff}
        initialSource={source}
        onEditorApi={(api) => {
          editorApi = api;
        }}
      />,
    );

    expect(await screen.findByText("Editable native elements")).toBeTruthy();
    expect(
      await screen.findByLabelText("editable.svg editable canvas"),
    ).toBeTruthy();
    await waitForElementToBeRemoved(
      () => screen.queryByText("Loading canvas"),
      {
        timeout: 20_000,
      },
    );

    const api = await waitFor(() => {
      expect(editorApi).not.toBeNull();
      if (!editorApi) {
        throw new Error("Excalidraw API is not ready");
      }
      return editorApi;
    });
    const initialElements = api.getSceneElements();
    const initialElement = initialElements[0];
    expect(initialElement).toBeDefined();
    if (!initialElement) {
      return;
    }
    await act(async () => {
      api.updateScene({
        elements: initialElements.map((element, index) =>
          index === 0
            ? {
                ...element,
                version: element.version + 1,
                x: element.x + 24,
                y: element.y + 12,
              }
            : element,
        ),
      });
    });
    const download = screen.getByRole("button", { name: "Download library" });
    expect(download).toHaveProperty("disabled", false);
    fireEvent.click(download);
    const editedBlob = downloads[0];
    expect(editedBlob).toBeDefined();
    if (!editedBlob) {
      return;
    }
    const edited = JSON.parse(await editedBlob.text());
    const editedElement = edited.libraryItems[0].elements.find(
      (element: { readonly id: string }) => element.id === initialElement.id,
    );
    expect(editedElement).toMatchObject({
      x: initialElement.x + 24,
      y: initialElement.y + 12,
    });

    const rectangle = await screen.findByRole(
      "radio",
      { name: /^Rectangle/ },
      { timeout: 10_000 },
    );
    fireEvent.click(rectangle);
    expect(rectangle).toHaveProperty("checked", true);
  }, 30_000);
});
