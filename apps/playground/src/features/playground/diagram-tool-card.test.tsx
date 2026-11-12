import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { BuildFlowchartResult } from "@sketchi/diagram-agent";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@sketchi/diagram-ui", () => ({
	DiagramPreview: () => <div data-testid="diagram-preview" />,
}));

import type { DiagramToolPart } from "./build-result";
import { DEPLOY_PIPELINE_SPEC } from "./deploy-pipeline-sample";
import { DiagramToolCard, liveInputTail } from "./diagram-tool-card";

afterEach(cleanup);

const input = { spec: DEPLOY_PIPELINE_SPEC };

const accepted = {
	artifact: { artifactId: "artifact_pipeline", diagramId: "pipeline", formats: [] },
	buildId: "build_pipeline",
	issues: [],
	normalizedSpec: { ...DEPLOY_PIPELINE_SPEC, id: "pipeline" },
	ok: true,
	quality: {
		accepted: true,
		checks: [],
		score: 9,
		summary: { edgeCount: 3, nodeCount: 4 },
		threshold: 8,
	},
	status: "accepted",
} satisfies BuildFlowchartResult;

function part(state: DiagramToolPart["state"], partial: Partial<DiagramToolPart> = {}) {
	return {
		type: "tool-build_flowchart",
		toolCallId: "call",
		state,
		input,
		...(state === "output-available" ? { output: accepted } : {}),
		...partial,
	} satisfies DiagramToolPart;
}

const view = (toolPart: DiagramToolPart, active = true) => (
	<DiagramToolCard active={active} attempt={1} part={toolPart} />
);

const trigger = () => screen.getByRole("button", { name: /flowchart|diagram/i });
const liveBlock = () => document.querySelector(".studio__live-input");

describe("DiagramToolCard", () => {
	it("stays open on the input while it is written and checked, then collapses", () => {
		const { rerender } = render(view(part("input-streaming", { input: undefined })));
		expect(trigger().getAttribute("aria-expanded")).toBe("false");

		rerender(view(part("input-streaming", { input: { spec: { title: "Deploy" } } })));
		expect(trigger().getAttribute("aria-expanded")).toBe("true");
		expect(liveBlock()?.textContent).toContain('"title": "Deploy"');
		expect(liveBlock()?.querySelector(".studio__live-caret")).not.toBeNull();

		rerender(view(part("input-available")));
		expect(trigger().getAttribute("aria-expanded")).toBe("true");
		expect(liveBlock()?.querySelector(".studio__live-caret")).toBeNull();

		rerender(view(part("output-available")));
		expect(trigger().getAttribute("aria-expanded")).toBe("false");
		expect(screen.getByText("Diagram ready")).toBeTruthy();
	});

	it("opens a finished card on its result and full input", () => {
		render(view(part("output-available"), false));
		expect(trigger().getAttribute("aria-expanded")).toBe("false");
		fireEvent.click(trigger());
		expect(trigger().getAttribute("aria-expanded")).toBe("true");
		expect(liveBlock()).toBeNull();
		expect(screen.getByText("Drawing details")).toBeTruthy();
		expect(screen.getByText("Parameters")).toBeTruthy();
	});

	it("keeps a card the reader closed while writing closed", () => {
		const { rerender } = render(view(part("input-streaming")));
		fireEvent.click(trigger());
		expect(trigger().getAttribute("aria-expanded")).toBe("false");
		rerender(view(part("input-available")));
		expect(trigger().getAttribute("aria-expanded")).toBe("false");
		rerender(view(part("output-available")));
		expect(trigger().getAttribute("aria-expanded")).toBe("false");
	});

	it.each(["stopped", "failed"] as const)("collapses a %s call", (ending) => {
		const { rerender } = render(view(part("input-streaming")));
		expect(trigger().getAttribute("aria-expanded")).toBe("true");
		rerender(
			ending === "stopped"
				? view(part("input-streaming"), false)
				: view(part("output-error", { errorText: "boom" }), false),
		);
		expect(trigger().getAttribute("aria-expanded")).toBe("false");
		fireEvent.click(trigger());
		expect(liveBlock()).toBeNull();
		expect(screen.getByText("Parameters")).toBeTruthy();
		expect(
			screen.queryByText(
				"Sketchi couldn’t finish this diagram. Try again, or simplify the request.",
			) === null,
		).toBe(ending === "stopped");
	});
});

describe("liveInputTail", () => {
	it("keeps the newest lines of a long input", () => {
		const long = { nodes: Array.from({ length: 200 }, (_, index) => `node ${index}`) };
		const tail = liveInputTail(long, false);
		expect(tail.clipped).toBe(true);
		expect(tail.text.split("\n")).toHaveLength(40);
		expect(tail.text).toContain('"node 199"');
		expect(tail.text).not.toContain('"node 0"');
	});

	it("ends a streaming input on the value being written", () => {
		const partial = { spec: { nodes: { api: { label: "API" } } } };
		expect(liveInputTail(partial, true).text.split("\n").at(-1)).toBe('        "label": "API"');
		expect(liveInputTail(partial, false).text.split("\n").at(-1)).toBe("}");
		expect(liveInputTail({}, true).text).toBe("{}");
	});

	it("shows a short input whole", () => {
		expect(liveInputTail({ title: "Deploy" }, false)).toEqual({
			clipped: false,
			text: '{\n  "title": "Deploy"\n}',
		});
	});
});
