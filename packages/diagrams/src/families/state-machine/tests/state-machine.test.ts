import { describe, expect, it } from "vitest";
import { Effect, Schema } from "effect";
import { groupRegionIssues, type CanvasSpec } from "@sketchi/drawing";
import { validateExcalidrawScene } from "@sketchi/drawing/excalidraw";

import { CodeModeArtifactStorage, makeMemoryArtifactStorage } from "../../../build/artifacts.js";
import { canonicalDocumentFromDiagram } from "../../../build/documents.js";
import { buildStateMachine } from "../../../build/builds.js";
import { CodeModeRuntimeEnvironment } from "../../../build/runtime.js";
import { applyDiagramPatch } from "../../../canvas/patch.js";
import { buildResponse } from "../../../build/operation.js";
import { stateMachineBuild } from "../build.js";
import {
	getStateMachineValidationIssues,
	mediaPlayerStateMachine,
	STATE_MACHINE_MAX_STATES,
	type StateMachineDiagram,
	StateMachineValidationIssueCodeSchema,
} from "../document.js";

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
		}).pipe(buildResponse),
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

describe("Code Mode state machine", () => {
	it("builds the documented spec into an editable artifact with a bound composite frame", async () => {
		const built = await build(playerSpec);
		if (!built.ok) throw new Error(JSON.stringify(built.issues));
		expect(() => Schema.decodeUnknownSync(stateMachineBuild.result)(built)).not.toThrow();
		expect(built.normalizedSpec.transitions.map((transition) => transition.id)).toEqual([
			"transition-1-stopped-active",
			"transition-2-playing-paused",
			"transition-3-paused-playing",
			"transition-4-playing-playing",
			"transition-5-active-stopped",
			"transition-6-stopped-ejected",
		]);
		expect(built.quality.summary).toEqual({ nodeCount: 5, edgeCount: 6 });
		expect(built.issues).toEqual([]);
		expect(built.artifact.formats.map(({ format }) => format)).toEqual(["scene", "excalidraw"]);
		const formats = new Map(built.artifact.formats.map((format) => [format.format, format.inline]));
		const scene = formats.get("scene") as CanvasSpec;
		expect(groupRegionIssues(scene)).toEqual([]);
		const excalidraw = formats.get("excalidraw") as Parameters<typeof validateExcalidrawScene>[0];
		expect(validateExcalidrawScene(excalidraw)).toEqual({ ok: true, issues: [] });
		// Transitions into and out of Active bind to its frame, which lists them.
		const frame = excalidraw.elements.find((element) => element.type === "frame")!;
		const bound = (frame["boundElements"] as { id: string }[]).map((entry) => entry.id).sort();
		expect(bound).toEqual(["edge:transition-1-stopped-active", "edge:transition-5-active-stopped"]);
		// Each of those transitions binds back to the frame.
		for (const id of bound) {
			const arrow = excalidraw.elements.find((element) => element.id === id);
			const ends = [arrow?.["startBinding"], arrow?.["endBinding"]].map(
				(binding) => (binding as { elementId?: string } | null)?.elementId,
			);
			expect(ends, id).toContain(frame.id);
		}
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

	it("round-trips a canonical machine through its Code Mode document", async () => {
		const document = canonicalDocumentFromDiagram(mediaPlayerStateMachine);
		expect(document.type).toBe("state-machine");
		const built = await build(document.spec);
		if (!built.ok) throw new Error(JSON.stringify(built.issues));
		expect(built.normalizedSpec.states).toEqual(mediaPlayerStateMachine.states);
		expect(built.normalizedSpec.transitions).toEqual(mediaPlayerStateMachine.transitions);
	});
});

// Real Frontierclimb builds that once failed; random state graphs would not reproduce them.
describe("state machine regressions", () => {
	it("accepts Sonnet round 18 first build and reports the chosen composite entry", async () => {
		// eval-20261020-030559-j3ng, sample 1, run 20261020-030559-2azp.
		const built = await build({
			title: "Media Player",
			initial: "Stopped",
			states: [
				{
					id: "Stopped",
				},
				{
					id: "Active",
				},
				{
					id: "Playing",
					parent: "Active",
				},
				{
					id: "Paused",
					parent: "Active",
				},
				{
					id: "End",
					kind: "final",
				},
			],
			transitions: [
				{
					source: "Stopped",
					target: "Active",
					event: "play",
				},
				{
					source: "Playing",
					target: "Paused",
					event: "pause",
				},
				{
					source: "Paused",
					target: "Playing",
					event: "resume",
				},
				{
					source: "Playing",
					target: "Playing",
					event: "seek",
					action: "jump to position",
				},
				{
					source: "Active",
					target: "Stopped",
					event: "stop",
				},
				{
					source: "Stopped",
					target: "End",
					event: "eject",
				},
			],
		});
		expect(built.ok, JSON.stringify(built.issues)).toBe(true);
		if (!built.ok) return;
		expect(built.normalizedSpec.states.find((state) => state.id === "Active")?.initial).toBe(
			"Playing",
		);
		expect(built.issues).toEqual([
			expect.objectContaining({
				code: "composite_initial_defaulted",
				severity: "warning",
				message:
					'Composite "Active" has no initial; defaulted to its first listed regular substate "Playing".',
			}),
		]);
		expect(() => Schema.decodeUnknownSync(stateMachineBuild.result)(built)).not.toThrow();
	});

	it.each([
		{
			sample: "20261019-151851-bghl",
			scenario: "connection-retry-state-machine",
			labels: ["Failed"],
			spec: {
				title: "Network connection",
				initial: "Disconnected",
				states: [
					{
						id: "Disconnected",
					},
					{
						id: "Connecting",
					},
					{
						id: "Connected",
						initial: "Idle",
					},
					{
						id: "Idle",
						parent: "Connected",
					},
					{
						id: "Streaming",
						parent: "Connected",
					},
					{
						id: "retryChoice",
						kind: "choice",
					},
					{
						id: "Failed",
						kind: "final",
					},
				],
				transitions: [
					{
						source: "Disconnected",
						target: "Connecting",
						event: "Connect",
					},
					{
						source: "Connecting",
						target: "Connected",
						event: "handshake ok",
					},
					{
						source: "Connecting",
						target: "retryChoice",
						event: "timeout",
					},
					{
						source: "retryChoice",
						target: "Connecting",
						guard: "retries < 3",
						action: "increment retries",
					},
					{
						source: "retryChoice",
						target: "Failed",
						guard: "no retries left",
					},
					{
						source: "Idle",
						target: "Streaming",
						event: "start stream",
					},
					{
						source: "Streaming",
						target: "Idle",
						event: "stop stream",
					},
					{
						source: "Connected",
						target: "Disconnected",
						event: "Disconnect",
					},
				],
			},
		},
		{
			sample: "20261019-151851-rrew",
			scenario: "order-lifecycle-state-machine",
			labels: ["Cancelled", "Refunded", "Lifecycle ended"],
			spec: {
				title: "Order lifecycle",
				initial: "Pending payment",
				states: [
					{
						id: "Pending payment",
					},
					{
						id: "Paid",
					},
					{
						id: "Shipped",
					},
					{
						id: "Delivered",
					},
					{
						id: "Cancelled",
						kind: "final",
					},
					{
						id: "Refunded",
						kind: "final",
					},
					{
						id: "Lifecycle ended",
						kind: "final",
					},
				],
				transitions: [
					{
						source: "Pending payment",
						target: "Paid",
						event: "pay",
						guard: "card valid",
						action: "charge card",
					},
					{
						source: "Pending payment",
						target: "Cancelled",
						event: "cancel",
					},
					{
						source: "Paid",
						target: "Shipped",
						event: "ship",
					},
					{
						source: "Paid",
						target: "Cancelled",
						event: "cancel",
						action: "refund payment",
					},
					{
						source: "Shipped",
						target: "Delivered",
						event: "deliver",
					},
					{
						source: "Shipped",
						target: "Paid",
						event: "return to sender",
					},
					{
						source: "Delivered",
						target: "Refunded",
						event: "request return",
						guard: "within 30 days",
						action: "issue refund",
					},
					{
						source: "Delivered",
						target: "Lifecycle ended",
					},
				],
			},
		},
		{
			sample: "20261019-151951-twk8",
			scenario: "connection-retry-state-machine",
			labels: ["Failed"],
			spec: {
				title: "Network Connection",
				initial: "Disconnected",
				states: [
					{
						id: "Disconnected",
					},
					{
						id: "Connecting",
					},
					{
						id: "Connected",
						initial: "Idle",
					},
					{
						id: "Idle",
						parent: "Connected",
					},
					{
						id: "Streaming",
						parent: "Connected",
					},
					{
						id: "RetryCheck",
						label: "Retry check",
						kind: "choice",
					},
					{
						id: "Failed",
						kind: "final",
					},
				],
				transitions: [
					{
						source: "Disconnected",
						target: "Connecting",
						event: "Connect",
					},
					{
						source: "Connecting",
						target: "Connected",
						event: "handshake ok",
					},
					{
						source: "Connecting",
						target: "RetryCheck",
						event: "timeout",
					},
					{
						source: "RetryCheck",
						target: "Connecting",
						guard: "retries < 3",
						action: "increment retries",
					},
					{
						source: "RetryCheck",
						target: "Failed",
						guard: "no retries left",
					},
					{
						source: "Idle",
						target: "Streaming",
						event: "start stream",
					},
					{
						source: "Streaming",
						target: "Idle",
						event: "stop stream",
					},
					{
						source: "Connected",
						target: "Disconnected",
						event: "Disconnect",
					},
				],
			},
		},
	])("preserves named finals in exact round-14 sample $sample", async ({ spec, labels }) => {
		const built = await build(spec);
		if (!built.ok) throw new Error(JSON.stringify(built.issues));
		const scene = built.artifact.formats.find((format) => format.format === "scene")!
			.inline as CanvasSpec;
		for (const label of labels) {
			expect(built.normalizedSpec.states.find((state) => state.id === label)?.label).toBe(label);
			expect(scene.elements).toContainEqual(expect.objectContaining({ type: "text", text: label }));
			expect(scene.elements).toContainEqual(
				expect.objectContaining({ type: "node", nodeId: `${label}:end`, kind: "final" }),
			);
		}
		expect(groupRegionIssues(scene)).toEqual([]);
	});
});

type State = StateMachineDiagram["states"][number];
type Transition = StateMachineDiagram["transitions"][number];
const player = mediaPlayerStateMachine;
const withStates = (...states: State[]) => [...player.states, ...states];
const withTransitions = (...transitions: Transition[]) => [...player.transitions, ...transitions];

/** One minimal bad machine per code the validator owns. */
const bad: Record<string, Partial<StateMachineDiagram>> = {
	state_machine_too_large: {
		states: withStates(
			...Array.from({ length: STATE_MACHINE_MAX_STATES }, (_, index) => ({ id: `s${index}` })),
		),
	},
	invalid_state_id: { states: withStates({ id: "a:b" }) },
	duplicate_state_id: { states: withStates({ id: "stopped", label: "Again" }) },
	duplicate_transition_id: { transitions: withTransitions({ ...player.transitions[0]! }) },
	missing_state_label: {
		states: player.states.map((state) =>
			state.id === "stopped" ? { ...state, label: " " } : state,
		),
	},
	unknown_initial_state: { initial: "nowhere" },
	unknown_parent_state: { states: withStates({ id: "stray", parent: "ghost" }) },
	nested_composite: { states: withStates({ id: "deep", parent: "playing" }) },
	missing_composite_initial: {
		states: withStates(
			{ id: "idle", label: "Idle" },
			{ id: "idle-done", kind: "final", parent: "idle" },
		),
		transitions: withTransitions({ id: "rest", source: "stopped", target: "idle" }),
	},
	missing_transition_source: {
		transitions: withTransitions({ id: "ghost-play", source: "ghost", target: "stopped" }),
	},
	missing_transition_target: {
		transitions: withTransitions({ id: "stop-ghost", source: "stopped", target: "ghost" }),
	},
	final_has_outgoing: {
		states: withStates({ id: "ejected", kind: "final" }),
		transitions: withTransitions(
			{ id: "eject", source: "stopped", target: "ejected" },
			{ id: "reload", source: "ejected", target: "stopped" },
		),
	},
	composite_member_transition: {
		transitions: withTransitions({ id: "into-own", source: "active", target: "paused" }),
	},
	underbranched_choice: {
		states: withStates({ id: "route", kind: "choice" }),
		transitions: withTransitions(
			{ id: "to-route", source: "stopped", target: "route" },
			{ id: "only", source: "route", target: "stopped", guard: "ready" },
		),
	},
	unguarded_choice_branch: {
		states: withStates({ id: "route", kind: "choice" }),
		transitions: withTransitions(
			{ id: "to-route", source: "stopped", target: "route" },
			{ id: "guarded", source: "route", target: "stopped", guard: "ready" },
			{ id: "bare", source: "route", target: "active" },
		),
	},
	unreachable_state: { states: withStates({ id: "lonely", label: "Lonely" }) },
};

describe("state machine validator", () => {
	it("covers every issue code it can raise", () => {
		expect(new Set(Object.keys(bad))).toEqual(
			new Set(StateMachineValidationIssueCodeSchema.literals),
		);
	});

	it.each(Object.entries(bad))("raises %s for a minimal bad machine", (code, change) => {
		const issues = getStateMachineValidationIssues({ ...player, ...change });
		expect(issues.map((issue) => issue.code)).toContain(code);
	});
});
