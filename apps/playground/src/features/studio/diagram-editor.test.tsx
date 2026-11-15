import { RegistryProvider } from "@effect/atom-react";
import { type ExcalidrawScene } from "@sketchi/drawing/excalidraw";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const canvas = vi.hoisted(
	(): { change?: (scene: ExcalidrawScene) => void; initial?: ExcalidrawScene } => ({}),
);
vi.mock("@sketchi/editor", () => ({
	downloadBlob: vi.fn(),
	DrawingEditor: ({
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

const drafts = vi.hoisted(() => ({ clear: vi.fn(async () => undefined), write: vi.fn() }));
vi.mock("./drawing-drafts", async () => {
	const { Atom } = await import("effect/reactivity");
	const { Effect, Stream } = await import("effect");
	return {
		drawingDraft: Atom.family(() =>
			Atom.fn((drawing: unknown) =>
				Stream.fromEffect(
					Effect.promise(async () => {
						if (drawing === undefined) await drafts.clear();
						else drafts.write(drawing);
					}),
				),
			),
		),
	};
});

import { drawingFromScene } from "./diagram-drawing";
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
		<RegistryProvider defaultIdleTTL={1} timeoutResolution={1}>
			<DiagramEditor
				diagramId="dia_test"
				draft={draft}
				headerLinks={null}
				scene={saved}
				title="Test diagram"
			/>
		</RegistryProvider>,
	);
}

const saveButton = (name: string) => screen.getByRole("button", { name });

beforeEach(() => {
	studio.save.mockResolvedValue({});
	vi.stubGlobal(
		"fetch",
		vi.fn(async (_url: unknown, init: RequestInit) => {
			const payload: unknown = await new Response(init.body).json();
			await studio.save("dia_test", payload);
			return Response.json({
				ok: true,
				auth: { status: "anonymous", message: "Anonymous" },
				session: { kind: "anonymous" },
				diagram: {
					id: "dia_test",
					projectId: "proj_test",
					artifactId: "artifact",
					title: "Saved",
					createdAt: "2026-11-15",
					updatedAt: "2026-11-15",
					source: { kind: "playground-artifact", artifactId: "artifact" },
					editUrl: "/diagrams/dia_test/edit",
					reviewUrl: "/diagrams/dia_test",
				},
			});
		}),
	);
});
afterEach(() => {
	vi.clearAllMocks();
	vi.unstubAllGlobals();
});

describe("Studio diagram editor", () => {
	it("hydrates a restored draft idle, then saves only on request and retries failure", async () => {
		const errors = vi.spyOn(console, "error");
		const draft = edit(saved, "box", 5);
		const page = () => (
			<RegistryProvider>
				<DiagramEditor
					diagramId="dia_test"
					draft={draft}
					headerLinks={null}
					scene={saved}
					title="Test diagram"
				/>
			</RegistryProvider>
		);
		const container = document.createElement("div");
		container.innerHTML = renderToString(page());
		document.body.append(container);
		expect(studio.save).not.toHaveBeenCalled();
		expect(container.querySelector("button[aria-label='Save']")).toHaveProperty("disabled", false);
		let root: ReturnType<typeof hydrateRoot> | undefined;
		try {
			await act(async () => {
				root = hydrateRoot(container, page());
			});
			expect(studio.save).not.toHaveBeenCalled();
			expect(saveButton("Save")).toHaveProperty("disabled", false);
			expect(errors.mock.calls).toEqual([]);
			studio.save.mockRejectedValueOnce(new Error("offline"));
			fireEvent.click(saveButton("Save"));
			await screen.findByRole("button", { name: "Save failed, retry" });
			expect(drafts.clear).not.toHaveBeenCalled();
			fireEvent.click(saveButton("Save failed, retry"));
			await waitFor(() => expect(saveButton("Saved")).toHaveProperty("disabled", true));
			expect(studio.save).toHaveBeenCalledTimes(2);
			expect(studio.save).toHaveBeenLastCalledWith("dia_test", drawingFromScene(draft));
			expect(drafts.clear).toHaveBeenCalledOnce();
		} finally {
			await act(async () => root?.unmount());
			container.remove();
			errors.mockRestore();
		}
	});
	it("captures each content edit, but not selection or scrolling", async () => {
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

		await waitFor(() =>
			expect(drafts.write).toHaveBeenLastCalledWith(drawingFromScene(movedAgain)),
		);
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

	it("saves native elements with undefined optional customData through the real HTTP codec", async () => {
		renderEditor();
		act(() => canvas.change?.(saved));
		const edited = {
			...edit(saved, "box", 2),
			elements: edit(saved, "box", 2).elements.map((element) => ({
				...element,
				customData: undefined,
			})),
		};
		act(() => canvas.change?.(edited));
		fireEvent.click(saveButton("Save"));
		await waitFor(() => expect(saveButton("Saved")).toHaveProperty("disabled", true));
		expect(studio.save).toHaveBeenCalledWith("dia_test", drawingFromScene(edit(saved, "box", 2)));
	});

	it("retains the durable baseline through a pending Save and later scene notification when the request fails", async () => {
		const pending = Promise.withResolvers<unknown>();
		studio.save.mockReturnValue(pending.promise);
		renderEditor();
		act(() => canvas.change?.(saved));
		act(() => canvas.change?.(edit(saved, "box", 2)));
		fireEvent.click(saveButton("Save"));
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 20));
		});
		act(() => canvas.change?.(edit(saved, "box", 3)));
		await act(async () => pending.reject(new Error("offline")));
		await waitFor(() => expect(saveButton("Save failed, retry")).toHaveProperty("disabled", false));
		expect(drafts.clear).not.toHaveBeenCalled();
		expect(studio.save).toHaveBeenCalledOnce();
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
		await waitFor(() => expect(drafts.write).toHaveBeenLastCalledWith(drawingFromScene(saved)));

		await act(async () => finish({}));
		expect(studio.save).toHaveBeenCalledWith(
			"dia_test",
			expect.objectContaining({ elements: added.elements }),
		);
		expect(drafts.clear).not.toHaveBeenCalled();
		await waitFor(() => expect(drafts.write).toHaveBeenLastCalledWith(drawingFromScene(saved)));
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

		expect(drafts.write).toHaveBeenLastCalledWith(drawingFromScene(newer));
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
