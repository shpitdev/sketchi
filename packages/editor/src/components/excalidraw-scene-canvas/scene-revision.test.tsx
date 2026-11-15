import { DrawingEditor } from "./excalidraw-scene-canvas";
import { convertSceneToExcalidraw } from "@sketchi/drawing/excalidraw";
// Positive fixtures deliberately unwrap Results: failure here is invalid test/story data, not user input.
import { Result } from "effect";
import {
	flowchartFixture,
	parseFlowchartDiagram,
} from "@sketchi/diagrams/families/flowchart/diagram";
import { renderIntermediateDiagram } from "@sketchi/diagrams/graph/scene";

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// Like the real editor, this shell initializes only on mount. Do not mock the
// shared canvas adapter: its actual React key must replace the editor.
vi.mock("@excalidraw/excalidraw", async () => {
	const { useState } = await import("react");
	return {
		getCommonBounds: () => [0, 0, 0, 0],
		mutateElement: vi.fn(),
		Excalidraw: ({ initialData }: { initialData?: { elements?: readonly unknown[] } }) => {
			const [initialScene] = useState(() => initialData);
			return <div data-testid="revision-editor" data-scene={JSON.stringify(initialScene)} />;
		},
	};
});

const firstScene = renderIntermediateDiagram(flowchartFixture).pipe(Result.getOrThrow);
const followUpDiagram = parseFlowchartDiagram({
	...flowchartFixture,
	nodes: [...flowchartFixture.nodes, { id: "proof", label: "Verify follow-up", kind: "process" }],
	edges: [
		...flowchartFixture.edges.filter((edge) => edge.id !== "draft-review"),
		{ id: "draft-proof", source: "draft", target: "proof" },
		{ id: "proof-review", source: "proof", target: "review" },
	],
}).pipe(Result.getOrThrow);
const nextScene = renderIntermediateDiagram(followUpDiagram).pipe(Result.getOrThrow);

describe("source scene revisions", () => {
	it("passes an explicit artifact revision through the studio preview", async () => {
		const { rerender } = render(
			<DrawingEditor
				revision="artifact:first"
				title={firstScene.title}
				scene={convertSceneToExcalidraw(firstScene)}
			/>,
		);
		const original = await screen.findByTestId("revision-editor");
		rerender(
			<DrawingEditor
				revision="artifact:follow-up"
				title={nextScene.title}
				scene={convertSceneToExcalidraw(nextScene)}
			/>,
		);
		expect(screen.getByTestId("revision-editor")).not.toBe(original);
		expect(screen.getByTestId("revision-editor").getAttribute("data-scene")).toContain(
			"Verify follow-up",
		);
	});
});
