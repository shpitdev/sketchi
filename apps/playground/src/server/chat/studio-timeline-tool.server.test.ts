import { expect, it } from "vitest";
import { Effect } from "effect";
import {
	buildTimeline,
	CodeModeArtifactStorage,
	CodeModeRuntimeEnvironment,
	makeMemoryArtifactStorage,
} from "@sketchi/diagram-agent";
import type { UIMessage } from "ai";
import { deriveBuildState } from "../../features/playground/build-result";
import { makeStudioTimelineToolExecutor } from "./studio-timeline-tool.server";

it("repairs a timeline through the Studio host and displays its real accepted scene", async () => {
	const storage = makeMemoryArtifactStorage();
	const executor = await Effect.runPromise(
		makeStudioTimelineToolExecutor((input) =>
			buildTimeline(input).pipe(
				Effect.provideService(CodeModeArtifactStorage, storage),
				Effect.provideService(CodeModeRuntimeEnvironment, {
					createId: (prefix) => `${prefix}_studio_timeline`,
				}),
			),
		),
	);
	const invalid = await Effect.runPromise(
		executor.execute({
			spec: {
				title: "Release",
				events: [{ id: "beta", label: "Public beta", date: "2026-02-30" }],
			},
		}),
	);
	expect(invalid).toMatchObject({ ok: false, status: "invalid_timeline" });
	const spec = {
		title: "Release",
		events: [
			{ id: "beta", label: "Public beta", date: "2026-09-15" },
			{ id: "ship", label: "Ship", date: "2026-10-01" },
		],
	};
	const drawing: UIMessage = {
		id: "drawing",
		role: "assistant",
		parts: [
			{
				type: "tool-build_timeline",
				toolCallId: "timeline",
				state: "input-available",
				input: { spec },
			},
		],
	};
	expect(deriveBuildState([drawing], true).ghostLabels).toEqual(["Public beta", "Ship"]);
	const accepted = await Effect.runPromise(executor.execute({ spec }));
	expect(accepted.ok).toBe(true);
	const message: UIMessage = {
		...drawing,
		parts: [
			{
				type: "tool-build_timeline",
				toolCallId: "timeline",
				state: "output-available",
				input: { spec },
				output: accepted,
			},
		],
	};
	const state = deriveBuildState([message], false);
	// The accepted scene shows humanized dates, never the raw ISO input.
	const texts = (state.scene?.elements ?? []).flatMap((element) =>
		element.type === "text" ? [element.text] : [],
	);
	expect(texts).toContain("Sep 15, 2026");
	expect(texts.some((text) => text.includes("2026-09-15"))).toBe(false);
	expect(state.artifact?.editUrl).toContain("/artifacts/");
	expect(state.acceptedResult?.ok).toBe(true);
});
