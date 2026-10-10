import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const excalidrawMock = vi.hoisted(() => ({
	editors: [] as Array<{ readonly load: () => void }>,
	props: vi.fn(),
	scrollToContent: vi.fn(),
}));

vi.mock("@excalidraw/excalidraw", async () => {
	const React = await import("react");

	return {
		Excalidraw: (props: {
			excalidrawAPI?: (api: {
				getAppState: () => object;
				scrollToContent: typeof excalidrawMock.scrollToContent;
			}) => void;
			gridModeEnabled?: boolean;
			initialData?: { appState?: Record<string, unknown> };
			onChange?: (elements: readonly unknown[], appState: object, files: object) => void;
		}) => {
			excalidrawMock.props(props);
			// Like Excalidraw's App: hand over the API from the constructor, during
			// render, and report changes once the mounted editor has loaded its
			// scene (`load` stands in for that).
			React.useState(() => {
				const appState = {};
				props.excalidrawAPI?.({
					getAppState: () => appState,
					scrollToContent: excalidrawMock.scrollToContent,
				});
				excalidrawMock.editors.push({
					load: () => props.onChange?.([], appState, {}),
				});
				return null;
			});

			return <div data-testid="mock-excalidraw">Mock Excalidraw</div>;
		},
	};
});

import { convertSceneToExcalidraw } from "@sketchi/diagram-excalidraw";
import {
	deployPipelineLogoFlowchart,
	embedCanvasIcons,
	flowchartFixture,
} from "@sketchi/diagram-core";
import { renderIntermediateDiagram } from "@sketchi/diagram-renderer";

import { ExcalidrawSceneCanvas } from "./excalidraw-scene-canvas";

const fitToViewport = {
	animate: false,
	fitToViewport: true,
	viewportZoomFactor: 1,
};

function loadEditor(index: number) {
	const editor = excalidrawMock.editors[index];
	if (!editor) throw new Error(`Editor ${index} was never constructed.`);
	act(() => editor.load());
}

describe("ExcalidrawSceneCanvas", () => {
	afterEach(() => {
		vi.restoreAllMocks();
		excalidrawMock.editors.length = 0;
		excalidrawMock.props.mockReset();
		excalidrawMock.scrollToContent.mockReset();
	});

	it("renders a client-only Excalidraw shell", () => {
		const scene = convertSceneToExcalidraw(renderIntermediateDiagram(flowchartFixture));

		render(<ExcalidrawSceneCanvas scene={scene} title="Sketchi onboarding decision flow" />);

		expect(screen.getByTestId("excalidraw-scene-canvas").getAttribute("aria-label")).toBe(
			"Sketchi onboarding decision flow",
		);
		expect(screen.getByTestId("excalidraw-scene-canvas").getAttribute("data-view-mode")).toBe(
			"false",
		);
		expect(screen.getByText("Loading canvas")).toBeTruthy();
	});

	it("fits the scene once the editor has loaded it, and only once", async () => {
		const scene = convertSceneToExcalidraw(renderIntermediateDiagram(flowchartFixture));

		render(<ExcalidrawSceneCanvas scene={scene} title="Sketchi onboarding decision flow" />);

		expect(await screen.findByTestId("mock-excalidraw")).toBeTruthy();
		expect(excalidrawMock.scrollToContent).not.toHaveBeenCalled();

		loadEditor(0);
		expect(excalidrawMock.scrollToContent).toHaveBeenCalledExactlyOnceWith(
			undefined,
			fitToViewport,
		);

		// Later edits report changes too; they must not refit the user's view.
		loadEditor(0);
		expect(excalidrawMock.scrollToContent).toHaveBeenCalledOnce();
		expect(excalidrawMock.props).toHaveBeenLastCalledWith(
			expect.objectContaining({ gridModeEnabled: false }),
		);
	});

	it("does not remount or refit on geometry and viewport changes without a new revision", async () => {
		const scene = convertSceneToExcalidraw(renderIntermediateDiagram(flowchartFixture));
		const { rerender } = render(
			<ExcalidrawSceneCanvas scene={scene} revision={1} title="Stable canvas" />,
		);
		const canvas = await screen.findByTestId("mock-excalidraw");
		loadEditor(0);
		expect(excalidrawMock.scrollToContent).toHaveBeenCalledOnce();
		excalidrawMock.scrollToContent.mockClear();
		rerender(
			<ExcalidrawSceneCanvas
				scene={{
					appState: { scrollX: 100, zoom: { value: 2 } },
					elements: scene.elements.map((element) => ({ ...element, x: 200 })),
				}}
				revision={1}
				title="Stable canvas"
			/>,
		);
		expect(screen.getByTestId("mock-excalidraw")).toBe(canvas);
		expect(excalidrawMock.editors).toHaveLength(1);
		expect(excalidrawMock.scrollToContent).not.toHaveBeenCalled();
		rerender(<ExcalidrawSceneCanvas scene={scene} revision={2} title="Stable canvas" />);
		expect(screen.getByTestId("mock-excalidraw")).not.toBe(canvas);
	});

	it("fits only the editor for the current revision", async () => {
		const scene = { appState: {}, elements: [] };
		const { rerender } = render(
			<ExcalidrawSceneCanvas revision={1} scene={scene} title="Revised canvas" />,
		);
		await screen.findByTestId("mock-excalidraw");
		rerender(<ExcalidrawSceneCanvas revision={2} scene={scene} title="Revised canvas" />);
		expect(excalidrawMock.editors).toHaveLength(2);

		// A replaced editor that reports late does not belong to the current API.
		loadEditor(0);
		expect(excalidrawMock.scrollToContent).not.toHaveBeenCalled();

		loadEditor(1);
		expect(excalidrawMock.scrollToContent).toHaveBeenCalledExactlyOnceWith(
			undefined,
			fitToViewport,
		);
	});

	it("hands node-logo files to Excalidraw with the first frame and on change", async () => {
		const scene = convertSceneToExcalidraw(
			embedCanvasIcons(renderIntermediateDiagram(deployPipelineLogoFlowchart), (slug) => ({
				name: slug,
				svg: '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"/>',
			})).scene,
		);
		const onSceneChange = vi.fn();
		render(
			<ExcalidrawSceneCanvas onSceneChange={onSceneChange} scene={scene} title="Deploy pipeline" />,
		);

		expect(await screen.findByTestId("mock-excalidraw")).toBeTruthy();
		expect(Object.keys(scene.files ?? {})).toHaveLength(4);
		const props = excalidrawMock.props.mock.lastCall?.[0] as {
			initialData: { files?: unknown };
			onChange: (elements: unknown, appState: unknown, files: unknown) => void;
		};
		expect(props.initialData.files).toEqual(scene.files);

		props.onChange(scene.elements, { viewBackgroundColor: "#fff" }, scene.files);
		expect(onSceneChange).toHaveBeenCalledWith(expect.objectContaining({ files: scene.files }));
	});

	it("uses the Sketchi card color when a scene has no background", async () => {
		render(
			<ExcalidrawSceneCanvas scene={{ appState: {}, elements: [] }} title="Empty Sketchi canvas" />,
		);

		expect(await screen.findByTestId("mock-excalidraw")).toBeTruthy();
		expect(excalidrawMock.props).toHaveBeenLastCalledWith(
			expect.objectContaining({
				initialData: expect.objectContaining({
					appState: expect.objectContaining({
						viewBackgroundColor: "#fffdf8",
					}),
				}),
			}),
		);
	});
});
