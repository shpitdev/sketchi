import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { flowchartFixture } from "@sketchi/diagram-core";
import { convertSceneToExcalidraw } from "@sketchi/diagram-excalidraw";
import { renderIntermediateDiagram } from "@sketchi/diagram-renderer";
import { ExcalidrawSceneCanvas } from "@sketchi/diagram-ui";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";

import "@sketchi/diagram-ui/styles.css";
import "../../styles/app.css";

afterEach(cleanup);

function shown(element: Element | null | undefined) {
	if (!element) return false;
	const { height, width } = element.getBoundingClientRect();
	return width > 0 && height > 0;
}

describe("read-only canvas on a phone", () => {
	it("hides empty chrome but keeps Scroll back to content working", async () => {
		await page.viewport(390, 800);
		let editorApi: ExcalidrawImperativeAPI | null = null;
		render(
			<div style={{ height: 500, width: 390 }}>
				<ExcalidrawSceneCanvas
					onApiChange={(api) => {
						editorApi = api;
					}}
					scene={convertSceneToExcalidraw(renderIntermediateDiagram(flowchartFixture))}
					title="Read-only canvas"
					viewModeEnabled
				/>
			</div>,
		);
		const api = await waitFor(
			() => {
				if (!editorApi || !document.querySelector(".excalidraw--mobile .App-bottom-bar")) {
					throw new Error("Mobile Excalidraw is not ready");
				}
				return editorApi;
			},
			{ timeout: 20_000 },
		);
		const bottomBar = () => document.querySelector(".excalidraw--mobile > .App-bottom-bar");
		const recenter = () => document.querySelector<HTMLElement>(".scroll-back-to-content");

		// With the diagram in view the read-only bottom bar has nothing to offer.
		expect(recenter()).toBeNull();
		expect(shown(bottomBar())).toBe(false);

		// Pan the diagram out of view: Excalidraw offers its recovery button. The
		// canvas fits the scene on the editor's first change, which can land after
		// an early pan, so pan until the button appears.
		const button = await waitFor(
			() => {
				const found = recenter();
				if (found) return found;
				act(() => api.updateScene({ appState: { scrollX: 50_000, scrollY: 50_000 } }));
				throw new Error("Scroll back to content is not rendered");
			},
			{ timeout: 10_000 },
		);
		expect(shown(button)).toBe(true);
		const bounds = button.getBoundingClientRect();
		expect(
			document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2),
		).toBe(button);
		// Only the button shows: no menu or toolbar island around it.
		expect(shown(bottomBar()?.querySelector(".App-toolbar-content"))).toBe(false);
		expect(shown(document.querySelector(".excalidraw--mobile .main-menu-trigger"))).toBe(false);

		await userEvent.click(button);
		await waitFor(() => {
			expect(recenter()).toBeNull();
			expect(api.getAppState().scrolledOutside).toBe(false);
		});
		expect(shown(bottomBar())).toBe(false);
	});
});
