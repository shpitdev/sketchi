import { describe, expect, it } from "vitest";
import type { BuildFlowchartResult } from "@sketchi/diagram-agent";
import type { UIMessage } from "ai";
import {
	buildResultOf,
	deriveBuildState,
	diagramToolCardStatus,
	type DiagramToolPart,
} from "./build-result";
import { DEPLOY_PIPELINE_SCENE, DEPLOY_PIPELINE_SPEC } from "./deploy-pipeline-sample";

function pendingMessage(id: string): UIMessage {
	return {
		id,
		role: "assistant",
		parts: [
			{
				type: "tool-build_flowchart",
				toolCallId: id,
				state: "input-available",
				input: { spec: DEPLOY_PIPELINE_SPEC },
			},
		],
	};
}

describe("build result selectors", () => {
	it.each([false, true])("ignores an earlier unfinished call when busy=%s", (busy) => {
		const latest: UIMessage = {
			id: "latest",
			role: "assistant",
			parts: [{ type: "text", text: "Done" }],
		};
		const state = deriveBuildState([pendingMessage("stopped"), latest], busy);
		expect(state.activePart).toBeUndefined();
		expect(state.ghostLabels).toEqual([]);
	});
	it("clears the active stage when a call stops or fails", () => {
		expect(deriveBuildState([pendingMessage("stopped")], false).activePart).toBeUndefined();
		expect(deriveBuildState([pendingMessage("stopped")], false).ghostLabels).toEqual([]);
	});
	it("uses the latest assistant's active input during a new run", () => {
		const state = deriveBuildState([pendingMessage("old"), pendingMessage("new")], true);
		expect(state.activePart?.toolCallId).toBe("new");
		expect(state.ghostLabels).toEqual(DEPLOY_PIPELINE_SPEC.nodes.map((node) => node.label));
	});
	it("rejects malformed accepted payloads before selecting formats", () => {
		const part: DiagramToolPart = {
			type: "tool-build_flowchart",
			toolCallId: "bad",
			state: "output-available",
			output: {
				ok: true,
				status: "accepted",
				buildId: "bad",
				issues: [],
				normalizedSpec: {},
				quality: {},
				artifact: {},
			},
		};
		expect(buildResultOf(part)).toBeUndefined();
	});
	it("retains the latest accepted scene and downloads when a newer build fails", () => {
		const accepted = {
			ok: true,
			status: "accepted",
			buildId: "accepted",
			issues: [],
			normalizedSpec: {
				...DEPLOY_PIPELINE_SPEC,
				id: "pipeline",
				edges: DEPLOY_PIPELINE_SPEC.edges.map((edge, index) => ({
					...edge,
					id: `edge-${index}`,
				})),
			},
			quality: {
				accepted: true,
				checks: [],
				score: 9,
				threshold: 8,
				summary: { nodeCount: 4, edgeCount: 3 },
			},
			artifact: {
				artifactId: "artifact with space",
				diagramId: "pipeline",
				formats: [
					{
						format: "scene",
						mimeType: "application/json",
						inline: DEPLOY_PIPELINE_SCENE,
					},
					{ format: "excalidraw", mimeType: "application/json" },
				],
			},
		} satisfies BuildFlowchartResult;
		const message: UIMessage = {
			id: "builds",
			role: "assistant",
			parts: [
				{
					type: "tool-build_flowchart",
					toolCallId: "accepted",
					state: "output-available",
					input: {},
					output: accepted,
				},
				{
					type: "tool-build_flowchart",
					toolCallId: "failed",
					state: "output-available",
					input: {},
					output: { ok: false, status: "quality_failed", issues: [] },
				},
			],
		};
		const state = deriveBuildState([message], false);
		expect(state.displayResult).toMatchObject({
			ok: false,
			status: "quality_failed",
		});
		expect(state.acceptedResult?.ok).toBe(true);
		expect(state.scene).toEqual(DEPLOY_PIPELINE_SCENE);
		expect(state.artifact?.editUrl).toBe("/artifacts/artifact%20with%20space/edit");
		expect(state.activePart).toBeUndefined();
	});

	it("decodes a valid rejected result", () => {
		expect(
			buildResultOf({
				type: "tool-build_flowchart",
				toolCallId: "rejected",
				state: "output-available",
				output: { ok: false, status: "storage_failed", issues: [] },
			}),
		).toMatchObject({ ok: false, status: "storage_failed" });
	});

	it("reads sequence build parts: participant ghosts while drawing, then the accepted scene", () => {
		const spec = {
			title: "Checkout",
			participants: [
				{ id: "browser", label: "Browser" },
				{ id: "api", label: "API" },
			],
			messages: [{ source: "browser", target: "api", label: "Checkout" }],
		};
		const drawing: UIMessage = {
			id: "drawing",
			role: "assistant",
			parts: [
				{
					type: "tool-build_sequence_diagram",
					toolCallId: "sequence",
					state: "input-available",
					input: { spec },
				},
			],
		};
		expect(deriveBuildState([drawing], true).ghostLabels).toEqual(["Browser", "API"]);

		const accepted: UIMessage = {
			id: "accepted",
			role: "assistant",
			parts: [
				{
					type: "tool-build_sequence_diagram",
					toolCallId: "sequence",
					state: "output-available",
					input: { spec },
					output: {
						ok: true,
						status: "accepted",
						buildId: "build",
						issues: [],
						normalizedSpec: {
							id: "checkout",
							title: "Checkout",
							participants: spec.participants,
							messages: [{ id: "m1", source: "browser", target: "api", label: "Checkout" }],
							style: { accentColor: "#8f707f", backgroundColor: "#fffdf8" },
						},
						quality: {
							accepted: true,
							checks: [],
							score: 10,
							threshold: 8,
							summary: { nodeCount: 2, edgeCount: 1 },
						},
						artifact: {
							artifactId: "sequence-artifact",
							diagramId: "checkout",
							formats: [
								{ format: "scene", mimeType: "application/json", inline: DEPLOY_PIPELINE_SCENE },
								{ format: "excalidraw", mimeType: "application/json" },
							],
						},
					},
				},
			],
		};
		const state = deriveBuildState([accepted], false);
		expect(state.buildMode).toBe(true);
		expect(state.acceptedResult?.ok).toBe(true);
		expect(state.scene).toEqual(DEPLOY_PIPELINE_SCENE);
		expect(state.artifact?.viewUrl).toBe("/artifacts/sequence-artifact");
		expect(
			buildResultOf({
				type: "tool-build_sequence_diagram",
				toolCallId: "rejected",
				state: "output-available",
				output: { ok: false, status: "invalid_sequence", issues: [] },
			}),
		).toMatchObject({ ok: false, status: "invalid_sequence" });
	});

	it("titles a call left waiting after Stop as stopped, for both families", () => {
		for (const [type, family] of [
			["tool-build_flowchart", "flowchart"],
			["tool-build_sequence_diagram", "sequence diagram"],
		] as const) {
			for (const state of ["input-streaming", "input-available"] as const) {
				const part: DiagramToolPart = { type, toolCallId: "call", state, input: {} };
				expect(diagramToolCardStatus(part, false)).toEqual({
					stopped: true,
					title: `Stopped drawing your ${family}`,
				});
				expect(diagramToolCardStatus(part, true)).toEqual({
					stopped: false,
					title: `${state === "input-streaming" ? "Drawing" : "Checking"} your ${family}`,
				});
			}
		}
		expect(
			diagramToolCardStatus(
				{
					type: "tool-build_sequence_diagram",
					toolCallId: "done",
					state: "output-available",
					output: { ok: false, status: "invalid_sequence", issues: [] },
				},
				false,
			),
		).toEqual({ stopped: false, title: "Diagram needs changes" });
	});
});
