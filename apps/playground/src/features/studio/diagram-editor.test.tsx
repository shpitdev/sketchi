import type { ExcalidrawScene } from "@sketchi/diagram-excalidraw";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const canvas = vi.hoisted(
	(): { change?: (scene: ExcalidrawScene) => void; initial?: ExcalidrawScene } => ({}),
);
vi.mock("@sketchi/diagram-ui", () => ({
	downloadBlob: vi.fn(),
	ExcalidrawSceneCanvas: ({
		onSceneChange,
		scene,
	}: {
		onSceneChange: (scene: ExcalidrawScene) => void;
		scene: ExcalidrawScene;
	}) => {
		canvas.change = onSceneChange;
		canvas.initial = scene;
		return <div>Canvas</div>;
	},
}));
const studio = vi.hoisted(() => ({ save: vi.fn() }));
vi.mock("@sketchi/studio-projects/client", () => ({ saveStudioDiagramDrawing: studio.save }));
const drafts = vi.hoisted(() => ({ clear: vi.fn(async () => undefined), write: vi.fn() }));
vi.mock("./drawing-drafts", () => ({ createDrawingDraftCapture: () => drafts }));

import { DiagramEditor } from "./diagram-editor";

const saved: ExcalidrawScene = {
	appState: { viewBackgroundColor: "#fffdf8" },
	elements: [
		{ id: "box", type: "rectangle", version: 1, x: 0 },
		{ id: "label", type: "text", version: 1, x: 0 },
	],
};

function edit(scene: ExcalidrawScene, id: string, version: number): ExcalidrawScene {
	return {
		...scene,
		elements: scene.elements.map((element) =>
			element.id === id ? { ...element, version, x: version * 10 } : element,
		),
	};
}

function renderEditor(draft?: ExcalidrawScene) {
	render(
		<DiagramEditor
			diagramId="dia_test"
			draft={draft}
			headerLinks={null}
			scene={saved}
			title="Test diagram"
		/>,
	);
}

const saveButton = (name: string) => screen.getByRole("button", { name });

beforeEach(() => {
	studio.save.mockResolvedValue({});
});
afterEach(() => {
	vi.clearAllMocks();
});

describe("Studio diagram editor", () => {
	it("captures each content edit, but not selection or scrolling", () => {
		renderEditor();
		act(() => canvas.change?.(saved));
		expect(saveButton("Saved")).toHaveProperty("disabled", true);

		act(() => canvas.change?.({ ...saved, appState: { ...saved.appState, scrollX: 90 } }));
		expect(drafts.write).not.toHaveBeenCalled();

		const moved = edit(saved, "box", 2);
		act(() => canvas.change?.(moved));
		act(() => canvas.change?.({ ...moved, appState: { ...moved.appState, scrollX: 10 } }));
		const movedAgain = edit(moved, "box", 3);
		act(() => canvas.change?.(movedAgain));

		expect(drafts.write.mock.calls.map(([scene]) => scene)).toEqual([moved, movedAgain]);
		expect(saveButton("Save")).toHaveProperty("disabled", false);
	});

	it("saves the current drawing, then drops the draft it covered", async () => {
		renderEditor();
		act(() => canvas.change?.(saved));
		const moved = edit(saved, "box", 2);
		const removed = {
			...moved,
			elements: moved.elements.map((element) =>
				element.id === "label" ? { ...element, isDeleted: true, version: 2 } : element,
			),
		};
		act(() => canvas.change?.(removed));

		fireEvent.click(saveButton("Save"));
		await waitFor(() => expect(saveButton("Saved")).toHaveProperty("disabled", true));

		expect(studio.save).toHaveBeenCalledWith("dia_test", {
			appState: { viewBackgroundColor: "#fffdf8" },
			elements: [moved.elements[0]],
			files: {},
		});
		expect(drafts.clear).toHaveBeenCalledOnce();
	});

	it("keeps an edit made while saving as unsaved", async () => {
		let finish: (value: unknown) => void = () => undefined;
		studio.save.mockReturnValue(new Promise((resolve) => (finish = resolve)));
		renderEditor();
		act(() => canvas.change?.(saved));
		act(() => canvas.change?.(edit(saved, "box", 2)));
		fireEvent.click(saveButton("Save"));
		expect(saveButton("Saving")).toHaveProperty("disabled", true);

		act(() => canvas.change?.(edit(saved, "box", 3)));
		await act(async () => finish({}));

		expect(saveButton("Save")).toHaveProperty("disabled", false);
		expect(drafts.clear).not.toHaveBeenCalled();
	});

	it("keeps the newest drawing as the draft when it is undone during a Save", async () => {
		let finish: (value: unknown) => void = () => undefined;
		studio.save.mockReturnValue(new Promise((resolve) => (finish = resolve)));
		renderEditor();
		act(() => canvas.change?.(saved));
		const added = {
			...saved,
			elements: [...saved.elements, { id: "extra", type: "ellipse", version: 1 }],
		};
		act(() => canvas.change?.(added));
		fireEvent.click(saveButton("Save"));

		// Back to the previous Save while the request still carries the added ellipse.
		act(() => canvas.change?.(saved));
		expect(drafts.clear).not.toHaveBeenCalled();
		expect(drafts.write).toHaveBeenLastCalledWith(saved);

		await act(async () => finish({}));
		expect(studio.save).toHaveBeenCalledWith(
			"dia_test",
			expect.objectContaining({ elements: added.elements }),
		);
		expect(drafts.clear).not.toHaveBeenCalled();
		expect(drafts.write).toHaveBeenLastCalledWith(saved);
		expect(saveButton("Save")).toHaveProperty("disabled", false);
	});

	it("shows an edit made while the saved draft is being dropped as unsaved", async () => {
		let dropped: () => void = () => undefined;
		drafts.clear.mockReturnValueOnce(
			new Promise<undefined>((resolve) => (dropped = () => resolve(undefined))),
		);
		renderEditor();
		act(() => canvas.change?.(saved));
		act(() => canvas.change?.(edit(saved, "box", 2)));
		fireEvent.click(saveButton("Save"));
		await waitFor(() => expect(drafts.clear).toHaveBeenCalledOnce());

		const newer = edit(saved, "box", 3);
		act(() => canvas.change?.(newer));
		await act(async () => dropped());

		expect(drafts.write).toHaveBeenLastCalledWith(newer);
		expect(saveButton("Save")).toHaveProperty("disabled", false);
	});

	it("opens a restored draft as unsaved and keeps it when Save fails", async () => {
		const draft = edit(saved, "box", 5);
		studio.save.mockRejectedValue(new Error("offline"));
		renderEditor(draft);
		expect(canvas.initial).toBe(draft);
		act(() => canvas.change?.(draft));
		expect(saveButton("Save")).toHaveProperty("disabled", false);

		fireEvent.keyDown(screen.getByText("Canvas"), { ctrlKey: true, key: "s" });
		await waitFor(() => expect(saveButton("Save failed, retry")).toBeTruthy());

		expect(studio.save).toHaveBeenCalledOnce();
		expect(drafts.clear).not.toHaveBeenCalled();
	});
});
