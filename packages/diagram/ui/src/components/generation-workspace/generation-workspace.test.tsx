import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@excalidraw/excalidraw", () => ({
	Excalidraw: () => <div data-testid="mock-excalidraw">Mock Excalidraw</div>,
}));

import * as renderer from "@sketchi/diagram-renderer";
import { flowchartFixture } from "@sketchi/diagram-core";

import { GenerationWorkspace } from "./generation-workspace";

afterEach(() => vi.restoreAllMocks());
describe("GenerationWorkspace", () => {
	it("reuses layout and validation when only status changes", () => {
		const renderDiagram = vi.spyOn(renderer, "renderIntermediateDiagram");
		const { rerender } = render(<GenerationWorkspace diagram={flowchartFixture} status="ready" />);
		rerender(<GenerationWorkspace diagram={flowchartFixture} status="generating" />);
		expect(renderDiagram).toHaveBeenCalledTimes(1);
		rerender(<GenerationWorkspace diagram={{ ...flowchartFixture, title: "Changed diagram" }} />);
		expect(renderDiagram).toHaveBeenCalledTimes(2);
	});

	it("renders the diagram title and health metadata", () => {
		render(<GenerationWorkspace diagram={flowchartFixture} />);

		expect(screen.getByRole("heading", { name: "Sketchi onboarding decision flow" })).toBeTruthy();
		expect(screen.getByText("5 nodes")).toBeTruthy();
		expect(screen.getByText("5 edges")).toBeTruthy();
		expect(screen.getByText("Validated flowchart IR")).toBeTruthy();
		expect(screen.getByText("All arrows are bound")).toBeTruthy();
	});
});
