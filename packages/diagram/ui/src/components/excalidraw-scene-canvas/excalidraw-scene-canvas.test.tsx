import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const excalidrawMock = vi.hoisted(() => ({
	editors: [] as Array<{
		readonly change: (elements: readonly unknown[]) => void;
		readonly load: (elements?: readonly unknown[]) => void;
		readonly resize: (width: number, height: number) => void;
	}>,
	mutateElement: vi.fn(),
	props: vi.fn(),
	updateScene: vi.fn(),
	scrollToContent: vi.fn(),
	viewport: { height: 400, width: 1280 },
}));

vi.mock("@excalidraw/excalidraw", async () => {
	const React = await import("react");

	return {
		// Every mocked scene spans a wide 1500 by 1070 diagram.
		getCommonBounds: () => [0, 0, 1500, 1070],
		mutateElement: excalidrawMock.mutateElement,
		Excalidraw: (props: {
			excalidrawAPI?: (api: {
				getAppState: () => object;
				getSceneElementsIncludingDeleted: () => readonly unknown[];
				scrollToContent: typeof excalidrawMock.scrollToContent;
				updateScene: (scene: { elements?: readonly unknown[] }) => void;
			}) => void;
			gridModeEnabled?: boolean;
			initialData?: { appState?: Record<string, unknown> };
			onChange?: (elements: readonly unknown[], appState: object, files: object) => void;
		}) => {
			excalidrawMock.props(props);
			// Like Excalidraw's App: hand over the API from the constructor, during
			// render, and report changes once the mounted editor has loaded its
			// scene (`load` stands in for that). A resize commits a new app state
			// with the new viewport size and reports it the same way.
			React.useState(() => {
				let appState = { ...excalidrawMock.viewport, offsetLeft: 0, offsetTop: 0 };
				let sceneElements: readonly unknown[] = [];
				props.excalidrawAPI?.({
					getAppState: () => appState,
					getSceneElementsIncludingDeleted: () => sceneElements,
					scrollToContent: excalidrawMock.scrollToContent,
					updateScene: (scene) => {
						excalidrawMock.updateScene(scene);
						if (scene.elements) sceneElements = scene.elements;
					},
				});
				excalidrawMock.editors.push({
					change: (elements) => {
						sceneElements = elements;
						props.onChange?.(elements, appState, {});
					},
					load: (elements = []) => {
						sceneElements = elements;
						props.onChange?.(elements, appState, {});
					},
					resize: (width, height) => {
						appState = { height, offsetLeft: 0, offsetTop: 0, width };
						props.onChange?.([], appState, {});
					},
				});
				return null;
			});

			return (
				<div data-testid="mock-excalidraw">
					Mock Excalidraw
					<button aria-label="Menu" className="main-menu-trigger" type="button" />
				</div>
			);
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

function loadEditor(index: number, elements?: readonly unknown[]) {
	const editor = excalidrawMock.editors[index];
	if (!editor) throw new Error(`Editor ${index} was never constructed.`);
	act(() => editor.load(elements));
}

/** Place Excalidraw's menu button where it sits on a laptop stage. */
function drawMenuAtTopLeft() {
	const menu = document.querySelector(".main-menu-trigger");
	if (!menu) throw new Error("The mocked editor draws no menu button.");
	vi.spyOn(menu, "getBoundingClientRect").mockReturnValue(
		DOMRect.fromRect({ height: 36, width: 36, x: 16, y: 16 }),
	);
}

describe("ExcalidrawSceneCanvas", () => {
	afterEach(() => {
		vi.restoreAllMocks();
		excalidrawMock.editors.length = 0;
		excalidrawMock.mutateElement.mockReset();
		excalidrawMock.props.mockReset();
		excalidrawMock.scrollToContent.mockReset();
		excalidrawMock.updateScene.mockReset();
		excalidrawMock.viewport = { height: 400, width: 1280 };
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

	it("refits a read-only canvas when its viewport resizes", async () => {
		const scene = convertSceneToExcalidraw(renderIntermediateDiagram(flowchartFixture));
		render(<ExcalidrawSceneCanvas scene={scene} title="Read-only canvas" viewModeEnabled />);
		await screen.findByTestId("mock-excalidraw");
		loadEditor(0);
		expect(excalidrawMock.scrollToContent).toHaveBeenCalledOnce();

		// Wide load, then a phone-width viewport: the scene must fit again.
		act(() => excalidrawMock.editors[0]?.resize(390, 400));
		expect(excalidrawMock.scrollToContent).toHaveBeenCalledTimes(2);
		expect(excalidrawMock.scrollToContent).toHaveBeenLastCalledWith(undefined, fitToViewport);

		// Changes at the same size do not refit.
		loadEditor(0);
		expect(excalidrawMock.scrollToContent).toHaveBeenCalledTimes(2);
	});

	it("keeps the user's camera when an editable canvas resizes", async () => {
		const scene = convertSceneToExcalidraw(renderIntermediateDiagram(flowchartFixture));
		render(<ExcalidrawSceneCanvas scene={scene} title="Editable canvas" />);
		await screen.findByTestId("mock-excalidraw");
		loadEditor(0);
		act(() => excalidrawMock.editors[0]?.resize(390, 400));
		expect(excalidrawMock.scrollToContent).toHaveBeenCalledOnce();
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

	it("fits a read-only diagram exactly, clear of Excalidraw's menu", async () => {
		excalidrawMock.viewport = { height: 564, width: 820 };
		const scene = convertSceneToExcalidraw(renderIntermediateDiagram(flowchartFixture));
		render(<ExcalidrawSceneCanvas scene={scene} title="Wide diagram" viewModeEnabled />);
		await screen.findByTestId("mock-excalidraw");
		drawMenuAtTopLeft();

		loadEditor(0, [{ isDeleted: false }]);
		// The menu alone costs this wide diagram least as a strip beside it, and the
		// zoom stays exact rather than rounded down to a tenth.
		expect(excalidrawMock.scrollToContent).toHaveBeenCalledExactlyOnceWith(undefined, {
			...fitToViewport,
			canvasOffsets: { bottom: 16, left: 60, right: 16, top: 16 },
			maxZoom: 744 / 1500,
			minZoom: 744 / 1500,
		});
	});

	it("leaves an editable diagram's first fit to Excalidraw", async () => {
		excalidrawMock.viewport = { height: 564, width: 820 };
		const scene = convertSceneToExcalidraw(renderIntermediateDiagram(flowchartFixture));
		render(<ExcalidrawSceneCanvas scene={scene} title="Wide diagram" />);
		await screen.findByTestId("mock-excalidraw");
		drawMenuAtTopLeft();

		loadEditor(0, [{ isDeleted: false }]);
		expect(excalidrawMock.scrollToContent).toHaveBeenCalledExactlyOnceWith(
			undefined,
			fitToViewport,
		);
	});
	it("releases a route a drag folds through its own shape to Excalidraw's elbow routing", async () => {
		const shape = (id: string, x: number) => ({
			id,
			type: "rectangle",
			x,
			y: 0,
			width: 100,
			height: 60,
			angle: 0,
			isDeleted: false,
			roundness: null,
			version: 1,
		});
		const route = (x: number, version: number) => ({
			id: "route",
			type: "arrow",
			x,
			y: 30,
			points: [
				[0, 0],
				[250 - x, 0],
				[250 - x, 169],
			],
			angle: 0,
			elbowed: false,
			roundness: null,
			isDeleted: false,
			version,
			startBinding: { elementId: "a", focus: 0, gap: 1 },
			endBinding: { elementId: "b", focus: 0, gap: 1 },
		});
		const b = { ...shape("b", 200), y: 200 };
		const scene = convertSceneToExcalidraw(renderIntermediateDiagram(flowchartFixture));

		render(<ExcalidrawSceneCanvas scene={scene} title="Folded route" />);
		await screen.findByTestId("mock-excalidraw");
		loadEditor(0, [shape("a", 0), b, route(101, 1)]);
		expect(excalidrawMock.updateScene).not.toHaveBeenCalled();

		// Dragged right past its route's bend, a's end is aimed from inside it.
		act(() => excalidrawMock.editors[0]!.change([shape("a", 180), b, route(230, 2)]));

		const released = expect.objectContaining({ id: "route", elbowed: true, fixedSegments: [] });
		expect(excalidrawMock.updateScene).toHaveBeenCalledWith({
			elements: expect.arrayContaining([released]),
		});
		expect(excalidrawMock.mutateElement).toHaveBeenCalledWith(released, {
			points: [
				[0, 0],
				[20, 169],
			],
		});
	});
});
