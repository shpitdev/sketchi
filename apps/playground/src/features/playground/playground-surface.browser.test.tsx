import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { convertSceneToExcalidraw } from "@sketchi/diagram-excalidraw";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const excalidrawMock = vi.hoisted(() => ({
  props: vi.fn(),
}));

vi.mock("@excalidraw/excalidraw", () => ({
  Excalidraw: (props: {
    initialData?: {
      appState?: Record<string, unknown>;
      elements?: readonly unknown[];
    };
  }) => {
    excalidrawMock.props(props);

    return <div className="excalidraw" data-testid="mock-excalidraw" />;
  },
}));

import "../../styles/app.css";
import { DEPLOY_PIPELINE_SCENE } from "./deploy-pipeline-sample";
import { PlaygroundComposer, PlaygroundEmptyState } from "./playground-surface";

afterEach(() => {
  cleanup();
  excalidrawMock.props.mockReset();
  document.documentElement.scrollTop = 0;
});

const nextFrame = () =>
  new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

describe("playground short viewport layout", () => {
  it("routes the genuine deploy scene through the DiagramPreview canvas contract", async () => {
    render(<PlaygroundEmptyState onSelect={() => undefined} />);

    expect(await screen.findByTestId("mock-excalidraw")).toBeTruthy();

    const sampleCanvas = document.querySelector(".studio__sample-canvas");
    const sceneCanvas = sampleCanvas?.querySelector(
      ".sketchi-excalidraw-scene-canvas",
    );
    const bottomBar = sampleCanvas?.querySelector(".App-bottom-bar");
    const brandPath = screen.getByLabelText("GitHub to Docker to Cloudflare");

    expect(sceneCanvas).not.toBeNull();
    if (!sampleCanvas || !sceneCanvas) {
      return;
    }

    const expectedScene = convertSceneToExcalidraw(DEPLOY_PIPELINE_SCENE);
    const excalidrawProps = excalidrawMock.props.mock.calls.at(-1)?.[0];

    expect(excalidrawProps?.initialData?.elements).toEqual(
      expectedScene.elements,
    );
    expect(excalidrawProps?.initialData?.appState).toEqual(
      expectedScene.appState,
    );
    expect(excalidrawProps?.initialData?.elements).toHaveLength(
      expectedScene.elements.length,
    );
    expect(
      excalidrawProps?.initialData?.elements?.filter(
        (element: unknown) =>
          typeof element === "object" &&
          element !== null &&
          "type" in element &&
          element.type === "arrow",
      ),
    ).toHaveLength(3);
    expect(excalidrawProps?.initialData?.elements).toHaveLength(12);
    expect(JSON.stringify(excalidrawProps?.initialData)).not.toMatch(
      /fix build|retry/i,
    );
    expect(sceneCanvas.getBoundingClientRect()).toMatchObject({
      height: sampleCanvas.getBoundingClientRect().height,
      width: sampleCanvas.getBoundingClientRect().width,
    });
    if (bottomBar) {
      expect(getComputedStyle(bottomBar).display).toBe("none");
    }
    expect(brandPath.closest("figcaption")).not.toBeNull();
    expect(brandPath.closest(".studio__sample-canvas")).toBeNull();
  });

  it("states the sample is real output without shouting it", () => {
    render(<PlaygroundEmptyState onSelect={() => undefined} />);

    const claim = screen.getByText("Rendered in Sketchi");
    const style = getComputedStyle(claim);

    expect(claim.closest("figcaption")).not.toBeNull();
    expect(style.textTransform).toBe("none");
    expect(style.letterSpacing).toBe("normal");
  });

  it("gives the empty state the same shell width as every other surface", () => {
    render(
      <main className="studio">
        <div className="studio__body">
          <section className="studio__chat">
            <PlaygroundEmptyState onSelect={() => undefined} />
          </section>
        </div>
      </main>,
    );

    const studio = document.querySelector(".studio");
    const empty = document.querySelector(".studio__empty");
    const wrap = document.querySelector(".studio__empty-wrap");
    expect(studio).not.toBeNull();
    expect(empty).not.toBeNull();
    expect(wrap).not.toBeNull();
    if (!studio || !empty || !wrap) {
      return;
    }

    const shell = getComputedStyle(document.documentElement)
      .getPropertyValue("--shell")
      .trim();

    expect(shell).toBe("1180px");
    expect(getComputedStyle(studio).maxWidth).toBe(shell);

    // The empty state fills the shell instead of sitting in its own narrower
    // column, so the first screen is not visibly narrower than the rest.
    const wrapStyle = getComputedStyle(wrap);
    const inner =
      wrap.getBoundingClientRect().width -
      Number.parseFloat(wrapStyle.paddingLeft) -
      Number.parseFloat(wrapStyle.paddingRight);

    expect(empty.getBoundingClientRect().width).toBeCloseTo(inner, 1);
    expect(getComputedStyle(empty).maxWidth).toBe("none");
  });

  it("keeps every starter in document flow and hit-testable at 1280x577", async () => {
    const selections: string[] = [];

    render(
      <main className="studio">
        <div className="studio__body">
          <section className="studio__chat">
            <PlaygroundEmptyState
              onSelect={(prompt) => selections.push(prompt)}
            />
            <PlaygroundComposer
              buildMode={false}
              composerRef={createRef<HTMLTextAreaElement>()}
              onSubmit={() => undefined}
              status="ready"
            />
          </section>
        </div>
      </main>,
    );

    expect({ height: innerHeight, width: innerWidth }).toEqual({
      height: 577,
      width: 1280,
    });

    const starterRegion = screen.getByLabelText("Starter prompts");
    const starters = within(starterRegion).getAllByRole("button");
    const composer = screen
      .getByRole("textbox", { name: "Describe your diagram" })
      .closest(".studio__composer");
    const emptyWrap = starterRegion.closest(".studio__empty-wrap");

    expect(composer).not.toBeNull();
    expect(emptyWrap).not.toBeNull();
    if (!composer || !emptyWrap) {
      return;
    }

    expect(getComputedStyle(emptyWrap).overflowY).toBe("visible");
    expect(composer.getBoundingClientRect().top).toBeGreaterThan(
      starters.at(-1)?.getBoundingClientRect().bottom ?? 0,
    );
    expect(document.documentElement.scrollHeight).toBeGreaterThan(innerHeight);

    for (const starter of starters) {
      starter.scrollIntoView({ block: "center" });
      await nextFrame();

      const bounds = starter.getBoundingClientRect();
      const hit = document.elementFromPoint(
        bounds.left + bounds.width / 2,
        bounds.top + bounds.height / 2,
      );

      expect(bounds.top).toBeGreaterThanOrEqual(0);
      expect(bounds.bottom).toBeLessThanOrEqual(innerHeight);
      expect(hit?.closest("button")).toBe(starter);
      fireEvent.click(starter);
    }

    expect(selections).toHaveLength(starters.length);
  });
});
