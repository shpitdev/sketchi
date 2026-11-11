import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { page } from "vitest/browser";
import type { ChatStatus, UIMessage } from "ai";
import type { BuildFlowchartResult } from "@sketchi/diagram-agent";
import { afterEach, describe, expect, it, vi } from "vitest";

const chat = vi.hoisted(() => ({
	messages: [] as UIMessage[],
	status: "ready" as ChatStatus,
	sendMessage: vi.fn(),
	stop: vi.fn(),
}));
vi.mock("@ai-sdk/react", () => ({ useChat: () => chat }));
vi.mock("@excalidraw/excalidraw", () => ({ Excalidraw: () => <div className="excalidraw" /> }));

import "../../styles/app.css";
import { Route } from "../../routes/index";
import { DEPLOY_PIPELINE_SCENE, DEPLOY_PIPELINE_SPEC } from "./deploy-pipeline-sample";

const Studio = Route.options.component!;
const prompt: UIMessage = {
	id: "request",
	role: "user",
	parts: [{ type: "text", text: "Draw a release pipeline" }],
};
const drawing: UIMessage = {
	id: "reply",
	role: "assistant",
	parts: [
		{ type: "tool-build_flowchart", toolCallId: "draw", state: "input-streaming", input: {} },
	],
};
const accepted = {
	ok: true,
	status: "accepted",
	buildId: "build-release",
	issues: [],
	normalizedSpec: { ...DEPLOY_PIPELINE_SPEC, id: DEPLOY_PIPELINE_SCENE.diagramId },
	quality: {
		accepted: true,
		checks: [],
		score: 9,
		threshold: 8,
		summary: { nodeCount: 4, edgeCount: 3 },
	},
	artifact: {
		artifactId: "release",
		diagramId: DEPLOY_PIPELINE_SCENE.diagramId,
		formats: [
			{ format: "scene", mimeType: "application/json", inline: DEPLOY_PIPELINE_SCENE },
			{ format: "excalidraw", mimeType: "application/json" },
		],
	},
} satisfies BuildFlowchartResult;
const completed: UIMessage = {
	...drawing,
	parts: [
		{
			type: "tool-build_flowchart",
			toolCallId: "draw",
			state: "output-available",
			input: {},
			output: accepted,
		},
	],
};
const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
const composerBox = () => {
	const { x, y, width, height } = screen
		.getByRole("textbox", { name: "Describe your diagram" })
		.getBoundingClientRect();
	return { x, y, width, height };
};

afterEach(() => {
	cleanup();
	chat.messages = [];
	chat.status = "ready";
});

describe("streaming workspace", () => {
	it.each([1280, 390])(
		"keeps the composer in place as a tool starts and its reply grows at %ipx",
		async (width) => {
			await page.viewport(width, 844);
			chat.messages = [prompt];
			chat.status = "submitted";
			const { rerender } = render(<Studio />);
			await frame();
			const before = composerBox();
			const stageBefore = document
				.querySelector(".studio__stage-card")
				?.getBoundingClientRect()
				.toJSON();
			chat.messages = [prompt, drawing];
			chat.status = "streaming";
			rerender(<Studio />);
			await frame();
			expect(composerBox()).toEqual(before);

			// Overflow the rail with realistic streamed text; only the conversation
			// may scroll, not the document or the composer containing the input.
			for (let count = 1; count <= 4; count += 1) {
				chat.messages = [
					prompt,
					{
						...drawing,
						parts: [
							...completed.parts,
							{
								type: "text",
								state: "streaming",
								text: "Build the package, run the tests, then deploy the release.\n\n".repeat(
									count * 8,
								),
							},
						],
					},
				];
				await act(async () => {
					rerender(<Studio />);
					await frame();
				});
				expect(composerBox()).toEqual(before);
				expect(
					document.querySelector(".studio__stage-card")?.getBoundingClientRect().toJSON(),
				).toEqual(stageBefore);
				expect(document.documentElement.scrollHeight).toBeLessThanOrEqual(innerHeight);
			}
		},
	);

	it("keeps the phone's selected view and input draft through streamed updates", async () => {
		await page.viewport(390, 844);
		chat.messages = [prompt];
		chat.status = "submitted";
		const { rerender } = render(<Studio />);
		const composer = screen.getByRole("textbox", { name: "Describe your diagram" });
		fireEvent.change(composer, { target: { value: "Also add a review step" } });
		fireEvent.click(screen.getByRole("button", { name: "Diagram" }));
		expect(screen.queryByRole("textbox")).toBeNull();
		chat.messages = [prompt, drawing];
		chat.status = "streaming";
		rerender(<Studio />);
		expect(screen.getByRole("button", { name: "Diagram" }).getAttribute("aria-pressed")).toBe(
			"true",
		);
		fireEvent.click(screen.getByRole("button", { name: "Conversation" }));
		expect(screen.getByRole("textbox")).toBe(composer);
		expect((composer as HTMLTextAreaElement).value).toBe("Also add a review step");
	});
});
