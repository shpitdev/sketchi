import { describe, expect, it } from "vitest";
import { Effect, Schema } from "effect";
import { groupRegionIssues, mediaPlayerStateMachine } from "@sketchi/diagram-core";
import { validateExcalidrawScene } from "@sketchi/diagram-excalidraw";
import type { RenderedDiagramScene } from "@sketchi/diagram-renderer";

import { CodeModeArtifactStorage, makeMemoryArtifactStorage } from "./artifacts.js";
import { BuildStateMachineResultSchema } from "./contract.js";
import { canonicalDocumentFromDiagram } from "./documents.js";
import { applyDiagramPatch, buildStateMachine, CodeModeRuntimeEnvironment } from "./runtime.js";

const storage = makeMemoryArtifactStorage();
function run<A>(
	effect: Effect.Effect<A, never, CodeModeRuntimeEnvironment | CodeModeArtifactStorage>,
) {
	return Effect.runPromise(
		effect.pipe(
			Effect.provideService(CodeModeRuntimeEnvironment, {
				createId: (prefix) => `${prefix}_${Math.random().toString(36).slice(2)}`,
			}),
			Effect.provideService(CodeModeArtifactStorage, storage),
		),
	);
}
function build(spec: unknown) {
	return run(
		buildStateMachine({
			spec,
			options: {
				inlineArtifacts: ["scene", "excalidraw"],
				artifactFormats: ["scene", "excalidraw"],
			},
		}),
	);
}

/** The documented example: ids omitted, a composite, a self-loop, a guard and a final. */
const playerSpec = {
	title: "Media player",
	initial: "stopped",
	states: [
		{ id: "stopped", label: "Stopped" },
		{ id: "active", label: "Active", initial: "playing" },
		{ id: "playing", label: "Playing", parent: "active" },
		{ id: "paused", label: "Paused", parent: "active" },
		{ id: "ejected", kind: "final" },
	],
	transitions: [
		{ source: "stopped", target: "active", event: "play" },
		{ source: "playing", target: "paused", event: "pause" },
		{ source: "paused", target: "playing", event: "resume" },
		{ source: "playing", target: "playing", event: "seek", action: "jump" },
		{ source: "active", target: "stopped", event: "stop" },
		{ source: "stopped", target: "ejected", event: "eject", guard: "tray open" },
	],
};

describe("Code Mode native state machine", () => {
	it("builds the exact unlabeled media-player spec from Frontierclimb round 13", async () => {
		const built = await build({
			title: "Media player",
			initial: "Stopped",
			states: [
				{ id: "Stopped" },
				{ id: "Active", initial: "Playing" },
				{ id: "Playing", parent: "Active" },
				{ id: "Paused", parent: "Active" },
				{ id: "End", kind: "final" },
			],
			transitions: [
				{ source: "Stopped", target: "Active", event: "Play" },
				{ source: "Playing", target: "Paused", event: "pause" },
				{ source: "Paused", target: "Playing", event: "resume" },
				{ source: "Playing", target: "Playing", event: "seek", action: "jump to position" },
				{ source: "Active", target: "Stopped", event: "Stop" },
				{ source: "Stopped", target: "End", event: "Eject" },
			],
		});
		if (!built.ok) throw new Error(JSON.stringify(built.issues));
		expect(built.normalizedSpec.states).toEqual([
			{ id: "Stopped", label: "Stopped" },
			{ id: "Active", label: "Active", initial: "Playing" },
			{ id: "Playing", label: "Playing", parent: "Active" },
			{ id: "Paused", label: "Paused", parent: "Active" },
			{ id: "End", kind: "final" },
		]);
		const scene = built.artifact.formats.find((format) => format.format === "scene")!
			.inline as RenderedDiagramScene;
		expect(groupRegionIssues(scene)).toEqual([]);
		expect(scene.elements).toContainEqual(
			expect.objectContaining({ type: "frame", name: "Active" }),
		);
		for (const label of ["Stopped", "Playing", "Paused"])
			expect(
				scene.elements.some((element) => element.type === "text" && element.text === label),
			).toBe(true);
	});

	it.each([undefined, "state"] as const)(
		"uses machine-like ids verbatim for kind %s and preserves explicit labels",
		async (kind) => {
			const built = await build({
				title: "Payment",
				initial: "waiting_for_payment",
				states: [
					{ id: "waiting_for_payment", ...(kind ? { kind } : {}) },
					{ id: "payment-received" },
					{ id: "done", label: "Payment complete" },
				],
				transitions: [
					{ source: "waiting_for_payment", target: "payment-received" },
					{ source: "payment-received", target: "done" },
				],
			});
			if (!built.ok) throw new Error(JSON.stringify(built.issues));
			expect(built.normalizedSpec.states.map((state) => state.label)).toEqual([
				"waiting_for_payment",
				"payment-received",
				"Payment complete",
			]);
		},
	);

	it.each(["  Stopped (ready)  ", "Stopped\nready", String.raw`Stopped\nready`])(
		"preserves the explicit label %j byte for byte",
		async (label) => {
			const built = await build({
				...playerSpec,
				states: playerSpec.states.map((state) =>
					state.id === "stopped" ? { ...state, label } : state,
				),
			});
			if (!built.ok) throw new Error(JSON.stringify(built.issues));
			expect(built.normalizedSpec.states[0]?.label).toBe(label);
		},
	);

	it.each([
		["", "invalid_input"],
		["   ", "invalid_state_machine"],
	])("rejects an explicitly blank label %j instead of defaulting it", async (label, status) => {
		const built = await build({
			title: "Blank label",
			initial: "start",
			states: [{ id: "start", label }],
			transitions: [],
		});
		expect(built.ok).toBe(false);
		expect(built.status).toBe(status);
		expect(built.issues).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ ref: { kind: "request", path: "spec.states.[0].label" } }),
			]),
		);
	});

	it("builds the documented spec into an editable artifact with a bound composite frame", async () => {
		const built = await build(playerSpec);
		if (!built.ok) throw new Error(JSON.stringify(built.issues));
		expect(() => Schema.decodeUnknownSync(BuildStateMachineResultSchema)(built)).not.toThrow();
		expect(built.normalizedSpec.transitions.map((transition) => transition.id)).toEqual([
			"transition-1-stopped-active",
			"transition-2-playing-paused",
			"transition-3-paused-playing",
			"transition-4-playing-playing",
			"transition-5-active-stopped",
			"transition-6-stopped-ejected",
		]);
		expect(built.quality.summary).toEqual({ nodeCount: 5, edgeCount: 6 });
		const formats = new Map(built.artifact.formats.map((format) => [format.format, format.inline]));
		const scene = formats.get("scene") as RenderedDiagramScene;
		expect(groupRegionIssues(scene)).toEqual([]);
		const excalidraw = formats.get("excalidraw") as Parameters<typeof validateExcalidrawScene>[0];
		expect(validateExcalidrawScene(excalidraw)).toEqual({ ok: true, issues: [] });
		// Transitions into and out of Active bind to its frame, which lists them.
		const frame = excalidraw.elements.find((element) => element.type === "frame")!;
		const bound = (frame["boundElements"] as { id: string }[]).map((entry) => entry.id).sort();
		expect(bound).toEqual(["edge:transition-1-stopped-active", "edge:transition-5-active-stopped"]);
		// A straight arrow cannot keep its binding to a moved frame; these are elbow arrows.
		for (const id of bound)
			expect(excalidraw.elements.find((element) => element.id === id)?.["elbowed"], id).toBe(true);
		const patched = await run(
			applyDiagramPatch({
				source: { artifactId: built.artifact.artifactId },
				operations: [
					{ op: "setStyle", selector: { nodeIds: ["paused"] }, style: { fillColor: "#fde68a" } },
				],
			}),
		);
		expect(patched.ok, JSON.stringify(patched.issues)).toBe(true);
	});

	it("keeps a grown choice a marker through a patch, with no drawn name", async () => {
		const branches = [1, 2, 3, 4, 5];
		const built = await build({
			title: "Request routing",
			initial: "intake",
			states: [
				{ id: "intake", label: "Intake" },
				{ id: "route", kind: "choice" },
				...branches.map((n) => ({ id: `handler-${n}`, label: `Handler ${n}` })),
			],
			transitions: [
				{ source: "intake", target: "route", event: "triage" },
				...branches.map((n) => ({
					source: "route",
					target: `handler-${n}`,
					guard: n === 5 ? "else" : `condition ${n} applies to this request`,
				})),
			],
		});
		if (!built.ok) throw new Error(JSON.stringify(built.issues));
		const patched = await run(
			applyDiagramPatch({
				source: { artifactId: built.artifact.artifactId },
				operations: [
					{ op: "setStyle", selector: { nodeIds: ["intake"] }, style: { fillColor: "#fde68a" } },
				],
				options: {
					artifactFormats: ["scene", "excalidraw"],
					inlineArtifacts: ["scene", "excalidraw"],
				},
			}),
		);
		if (!patched.ok) throw new Error(JSON.stringify(patched.issues));
		const formats = new Map(
			patched.artifact.formats.map((format) => [format.format, format.inline]),
		);
		const scene = formats.get("scene") as RenderedDiagramScene;
		const choice = scene.elements.find(
			(element) => element.type === "node" && element.nodeId === "route",
		);
		expect(choice).toMatchObject({ rendererRole: "state-marker", shape: "diamond" });
		expect(Math.max((choice as { width: number }).width, 0)).toBeGreaterThan(176);
		const excalidraw = formats.get("excalidraw") as Parameters<typeof validateExcalidrawScene>[0];
		expect(
			excalidraw.elements.filter(
				(element) => element.type === "text" && element["text"] === "Choice",
			),
		).toEqual([]);
	});

	it("round-trips a canonical machine through its Code Mode document", async () => {
		const document = canonicalDocumentFromDiagram(mediaPlayerStateMachine);
		expect(document.type).toBe("state-machine");
		const built = await build(document.spec);
		if (!built.ok) throw new Error(JSON.stringify(built.issues));
		expect(built.normalizedSpec.states).toEqual(mediaPlayerStateMachine.states);
		expect(built.normalizedSpec.transitions).toEqual(mediaPlayerStateMachine.transitions);
	});

	it.each([
		[{ initial: "nowhere" }, "unknown_initial_state"],
		[{ initial: "playing" }, "unknown_initial_state"],
		[
			{
				states: [
					...playerSpec.states.filter((state) => state.id !== "active"),
					{ id: "active", label: "Active" },
				],
			},
			"invalid_composite",
		],
		[
			{
				transitions: [
					...playerSpec.transitions,
					{ source: "ejected", target: "stopped", event: "reload" },
				],
			},
			"final_has_outgoing",
		],
		[
			{ transitions: [...playerSpec.transitions, { source: "stopped", target: "gone" }] },
			"missing_edge_target",
		],
	])("rejects %j with a structured repair issue", async (change, code) => {
		const result = await build({ ...playerSpec, ...change });
		expect(result.ok).toBe(false);
		expect(result.status).toBe("invalid_state_machine");
		expect(result.issues.map((issue) => issue.code)).toContain(code);
		expect(result.issues.every((issue) => issue.hint && issue.ref?.path?.startsWith("spec."))).toBe(
			true,
		);
	});
});
