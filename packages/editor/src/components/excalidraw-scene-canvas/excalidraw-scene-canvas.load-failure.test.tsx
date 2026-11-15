import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@excalidraw/excalidraw", () => {
	throw new Error("chunk failed to load");
});

import { DrawingEditor } from "./excalidraw-scene-canvas";

describe("DrawingEditor load failure", () => {
	it("reports an unavailable canvas instead of crashing the page", async () => {
		render(<DrawingEditor scene={{ appState: {}, elements: [] }} title="Unavailable canvas" />);

		expect(screen.getByText("Loading canvas")).toBeTruthy();
		expect((await screen.findByRole("alert")).textContent).toBe("Canvas unavailable");
		expect(screen.getByLabelText("Unavailable canvas")).toBeTruthy();
	});
});
