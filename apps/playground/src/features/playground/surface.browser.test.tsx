import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
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
import { PlaygroundComposer, PlaygroundIntro, PlaygroundStarters } from "./surface";

afterEach(() => {
	cleanup();
	excalidrawMock.props.mockReset();
	document.documentElement.scrollTop = 0;
});

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

function EmptyPlayground({ onSelect = () => undefined }: { onSelect?: (prompt: string) => void }) {
	return (
		<main className="studio studio--empty">
			<div className="studio__body">
				<section className="studio__chat">
					<PlaygroundIntro />
					<PlaygroundComposer
						buildMode={false}
						composerRef={createRef<HTMLTextAreaElement>()}
						onSubmit={() => undefined}
						status="ready"
					/>
					<PlaygroundStarters onSelect={onSelect} />
				</section>
			</div>
		</main>
	);
}

describe("playground empty layout", () => {
	it("routes the genuine deploy scene through the DiagramPreview canvas contract", async () => {
		render(<EmptyPlayground />);

		expect(await screen.findByTestId("mock-excalidraw")).toBeTruthy();

		const sampleCanvas = document.querySelector(".studio__sample-canvas");
		const sceneCanvas = sampleCanvas?.querySelector(".sketchi-excalidraw-scene-canvas");
		const bottomBar = sampleCanvas?.querySelector(".App-bottom-bar");

		expect(sceneCanvas).not.toBeNull();
		if (!sampleCanvas || !sceneCanvas) {
			return;
		}

		const expectedScene = convertSceneToExcalidraw(DEPLOY_PIPELINE_SCENE);
		const excalidrawProps = excalidrawMock.props.mock.calls.at(-1)?.[0];

		expect(excalidrawProps?.initialData?.elements).toEqual(expectedScene.elements);
		expect(excalidrawProps?.initialData?.appState).toEqual(expectedScene.appState);
		expect(excalidrawProps?.initialData?.elements).toHaveLength(expectedScene.elements.length);
		expect(
			excalidrawProps?.initialData?.elements?.filter(
				(element: unknown) =>
					typeof element === "object" &&
					element !== null &&
					"type" in element &&
					element.type === "arrow",
			),
		).toHaveLength(3);
		// 4 nodes, 4 labels, 3 arrows, 1 edge label, and 3 node logos.
		expect(excalidrawProps?.initialData?.elements).toHaveLength(15);
		expect(excalidrawProps?.initialData?.files).toEqual(expectedScene.files);
		expect(JSON.stringify(excalidrawProps?.initialData)).not.toMatch(/fix build|retry/i);
		// The scene fills the sample frame inside its border.
		expect(sceneCanvas.getBoundingClientRect()).toMatchObject({
			height: sampleCanvas.clientHeight,
			width: sampleCanvas.clientWidth,
		});
		if (bottomBar) {
			expect(getComputedStyle(bottomBar).display).toBe("none");
		}
	});

	it("puts the composer under the heading, then the starters, in one centred column", () => {
		render(<EmptyPlayground />);

		const heading = screen.getByRole("heading", { level: 1, name: "What should we draw?" });
		const composer = screen
			.getByRole("textbox", { name: "Describe your diagram" })
			.closest(".studio__composer");
		const starters = screen.getByLabelText("Starter prompts");
		const column = document.querySelector(".studio--empty .studio__chat");
		expect(composer).not.toBeNull();
		expect(column).not.toBeNull();
		if (!composer || !column) {
			return;
		}

		expect(composer.getBoundingClientRect().top).toBeGreaterThan(
			heading.getBoundingClientRect().bottom,
		);
		expect(starters.getBoundingClientRect().top).toBeGreaterThan(
			composer.getBoundingClientRect().bottom,
		);
		const bounds = column.getBoundingClientRect();
		expect(bounds.width).toBeLessThanOrEqual(760);
		expect(bounds.left + bounds.width / 2).toBeCloseTo(document.documentElement.clientWidth / 2, 0);
	});

	it("keeps every starter in document flow and hit-testable at 1280x577", async () => {
		const selections: string[] = [];

		render(<EmptyPlayground onSelect={(prompt) => selections.push(prompt)} />);

		expect({ height: innerHeight, width: innerWidth }).toEqual({
			height: 577,
			width: 1280,
		});

		const starterRegion = screen.getByLabelText("Starter prompts");
		const starters = within(starterRegion).getAllByRole("button");
		const composer = screen
			.getByRole("textbox", { name: "Describe your diagram" })
			.closest(".studio__composer");
		const column = starterRegion.closest(".studio__chat");

		expect(composer).not.toBeNull();
		expect(column).not.toBeNull();
		if (!composer || !column) {
			return;
		}

		// The page scrolls, not a hidden inner panel.
		expect(getComputedStyle(column).overflowY).toBe("visible");
		expect(composer.getBoundingClientRect().bottom).toBeLessThan(
			starters[0]?.getBoundingClientRect().top ?? 0,
		);
		expect(document.documentElement.scrollHeight).toBeGreaterThan(innerHeight);
		expect(document.documentElement.scrollWidth).toBe(document.documentElement.clientWidth);

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
