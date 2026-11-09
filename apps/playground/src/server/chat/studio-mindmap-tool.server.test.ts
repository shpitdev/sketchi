import { expect, it } from "vitest";
import { Effect } from "effect";
import {
	buildMindmap,
	CodeModeArtifactStorage,
	CodeModeRuntimeEnvironment,
	makeMemoryArtifactStorage,
} from "@sketchi/diagram-agent";
import type { UIMessage } from "ai";
import { deriveBuildState } from "../../features/playground/build-result";
import { makeStudioMindmapToolExecutor } from "./studio-mindmap-tool.server";

it("builds a mindmap through the Studio host and displays its accepted scene", async () => {
	const storage = makeMemoryArtifactStorage();
	const executor = await Effect.runPromise(
		makeStudioMindmapToolExecutor((input) =>
			buildMindmap(input).pipe(
				Effect.provideService(CodeModeArtifactStorage, storage),
				Effect.provideService(CodeModeRuntimeEnvironment, {
					createId: (prefix) => `${prefix}_studio_mindmap`,
				}),
			),
		),
	);
	const spec = {
		title: "Launch",
		layout: { direction: "LR" as const },
		root: {
			label: "Launch",
			children: [
				{ label: "Marketing", children: [{ label: "Blog post" }, { label: "Webinar" }] },
				{ label: "Engineering", children: [{ label: "Beta" }] },
			],
		},
	};
	const drawing: UIMessage = {
		id: "drawing",
		role: "assistant",
		parts: [
			{
				type: "tool-build_mindmap",
				toolCallId: "mindmap",
				state: "input-available",
				input: { spec },
			},
		],
	};
	// Topics show in the order the user gave them while the tree draws.
	expect(deriveBuildState([drawing], true).ghostLabels).toEqual([
		"Launch",
		"Marketing",
		"Blog post",
		"Webinar",
		"Engineering",
		"Beta",
	]);
	const accepted = await Effect.runPromise(executor.execute({ spec }));
	expect(accepted.ok).toBe(true);
	const message: UIMessage = {
		...drawing,
		parts: [
			{
				type: "tool-build_mindmap",
				toolCallId: "mindmap",
				state: "output-available",
				input: { spec },
				output: accepted,
			},
		],
	};
	const state = deriveBuildState([message], false);
	const texts = (state.scene?.elements ?? []).flatMap((element) =>
		element.type === "text" ? [element.text] : [],
	);
	expect(texts).toEqual(expect.arrayContaining(["Marketing", "Blog post", "Beta"]));
	expect(state.artifact?.editUrl).toContain("/artifacts/");
	expect(state.acceptedResult?.ok).toBe(true);
});
