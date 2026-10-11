import { describe, expect, it, vi } from "@effect/vitest";
import { Effect } from "effect";

import {
	BuildSequenceDiagramResultSchema,
	BuildSequenceDiagramToolInputSchema,
	buildFlowchart,
	buildSequenceDiagram,
	CodeModeArtifactStorage,
	CodeModeRuntimeEnvironment,
	makeMemoryArtifactStorage,
	toCodeModeJsonSchema,
} from "@sketchi/diagram-agent";

import { STUDIO_ARTIFACT_OPTIONS, makeStudioBuildTurn } from "./studio-build-tool.server";
import {
	makeStudioFlowchartToolExecutor,
	type StudioBuildFlowchartInput,
} from "./studio-flowchart-tool.server";
import {
	makeStudioSequenceToolExecutor,
	StudioBuildSequenceInputSchema,
	StudioBuildSequenceOutputSchema,
	type StudioBuildSequenceInput,
} from "./studio-sequence-tool.server";

const checkout: StudioBuildSequenceInput = {
	spec: {
		id: "checkout",
		title: "Checkout",
		participants: [
			{ id: "browser", label: "Browser" },
			{ id: "api", label: "API" },
			{ id: "payments", label: "Payments" },
		],
		messages: [
			{ id: "submit", source: "browser", target: "api", label: "Submit order" },
			{ id: "charge", source: "api", target: "payments", label: "Charge card" },
			{ id: "approved", source: "payments", target: "api", label: "Approved", type: "return" },
			{ id: "receipt", source: "api", target: "browser", label: "Receipt", type: "return" },
		],
	},
};

function deterministicRuntime() {
	const memory = makeMemoryArtifactStorage();
	const write = vi.fn(memory.write);
	const provide = <A>(
		effect: Effect.Effect<A, never, CodeModeArtifactStorage | CodeModeRuntimeEnvironment>,
	) =>
		effect.pipe(
			Effect.provideService(CodeModeArtifactStorage, { ...memory, write }),
			Effect.provideService(CodeModeRuntimeEnvironment, {
				createId: (prefix) => `${prefix}_fixed`,
			}),
		);
	return {
		build: (input: unknown) => provide(buildSequenceDiagram(input)),
		buildFlowchart: (input: unknown) => provide(buildFlowchart(input)),
		writes: () => write.mock.calls.length,
	};
}

const releaseFlow: StudioBuildFlowchartInput = {
	spec: {
		title: "Release",
		nodes: [
			{ id: "start", label: "Open release", kind: "start" },
			{ id: "ship", label: "Ship release", kind: "process" },
			{ id: "done", label: "Release live", kind: "end" },
		],
		edges: [
			{ source: "start", target: "ship" },
			{ source: "ship", target: "done" },
		],
		layout: { direction: "TB" },
	},
};
describe("Studio build_sequence_diagram host", () => {
	it("exposes the package-derived sequence contracts without style or artifact options", () => {
		const input = StudioBuildSequenceInputSchema["~standard"].jsonSchema.input({
			target: "draft-2020-12",
		});
		expect(input).toEqual(toCodeModeJsonSchema(BuildSequenceDiagramToolInputSchema));
		expect(JSON.stringify(input)).not.toMatch(/artifactFormats|accentColor/u);
		expect(
			StudioBuildSequenceOutputSchema["~standard"].jsonSchema.output({
				target: "draft-2020-12",
			}),
		).toEqual(toCodeModeJsonSchema(BuildSequenceDiagramResultSchema));
	});

	it("builds through the shared vertical with host artifact options and reuses the result", async () => {
		const runtime = deterministicRuntime();
		const requests: unknown[] = [];
		const executor = await Effect.runPromise(
			makeStudioSequenceToolExecutor((input) => {
				requests.push(input);
				return runtime.build(input);
			}),
		);

		const accepted = await Effect.runPromise(executor.execute(checkout));
		const reused = await Effect.runPromise(executor.execute(checkout));

		expect(requests).toEqual([{ ...checkout, options: STUDIO_ARTIFACT_OPTIONS }]);
		expect(accepted).toMatchObject({ ok: true, status: "accepted" });
		expect(reused).toBe(accepted);
		expect(runtime.writes()).toBe(1);
		if (!accepted.ok) throw new Error("Expected an accepted sequence diagram.");
		expect(accepted.artifact.formats.map((format) => format.format).sort()).toEqual([
			"excalidraw",
			"scene",
		]);
	});

	it("returns repairable issues, then stops after the attempt budget", async () => {
		const runtime = deterministicRuntime();
		const executor = await Effect.runPromise(makeStudioSequenceToolExecutor(runtime.build));
		const selfMessage: StudioBuildSequenceInput = {
			spec: {
				...checkout.spec,
				messages: [{ id: "loop", source: "api", target: "api", label: "Retry" }],
			},
		};

		const rejected = await Effect.runPromise(executor.execute(selfMessage));
		expect(rejected).toMatchObject({
			ok: false,
			status: "invalid_sequence",
			issues: [expect.objectContaining({ code: "self_loop" })],
		});
		await Effect.runPromise(executor.execute(selfMessage));
		await Effect.runPromise(executor.execute(selfMessage));
		const capped = await Effect.runPromise(executor.execute(checkout));
		expect(capped).toMatchObject({
			ok: false,
			status: "quality_failed",
			issues: [expect.objectContaining({ code: "quality_below_threshold" })],
		});
		await expect(Effect.runPromise(executor.attempts)).resolves.toBe(3);
		expect(runtime.writes()).toBe(0);
	});

	it("shares one accepted artifact per turn across both build tools", async () => {
		const runtime = deterministicRuntime();
		const turn = await Effect.runPromise(makeStudioBuildTurn());
		const flowchart = await Effect.runPromise(
			makeStudioFlowchartToolExecutor(runtime.buildFlowchart, { turn }),
		);
		const sequence = await Effect.runPromise(
			makeStudioSequenceToolExecutor(runtime.build, { turn }),
		);

		expect(await Effect.runPromise(flowchart.execute(releaseFlow))).toMatchObject({ ok: true });
		expect(runtime.writes()).toBe(1);
		const second = await Effect.runPromise(sequence.execute(checkout));

		expect(runtime.writes()).toBe(1);
		expect(second).toMatchObject({
			ok: false,
			status: "quality_failed",
			issues: [
				expect.objectContaining({ message: "A diagram was already saved for this request." }),
			],
		});
	});

	it("shares one attempt budget per turn across both build tools", async () => {
		const runtime = deterministicRuntime();
		const turn = await Effect.runPromise(makeStudioBuildTurn());
		const flowchart = await Effect.runPromise(
			makeStudioFlowchartToolExecutor(runtime.buildFlowchart, { turn }),
		);
		const sequence = await Effect.runPromise(
			makeStudioSequenceToolExecutor(runtime.build, { turn }),
		);
		const selfMessage: StudioBuildSequenceInput = {
			spec: { ...checkout.spec, messages: [{ source: "api", target: "api", label: "Retry" }] },
		};

		await Effect.runPromise(sequence.execute(selfMessage));
		await Effect.runPromise(sequence.execute(selfMessage));
		await Effect.runPromise(flowchart.execute({ spec: { ...releaseFlow.spec, edges: [] } }));
		const capped = await Effect.runPromise(sequence.execute(checkout));

		await expect(Effect.runPromise(sequence.attempts)).resolves.toBe(3);
		expect(capped).toMatchObject({
			ok: false,
			issues: [expect.objectContaining({ code: "quality_below_threshold" })],
		});
		expect(runtime.writes()).toBe(0);
	});

	it("places the user's named logos on participants and drops the rest before building", async () => {
		const received: unknown[] = [];
		const runtime = deterministicRuntime();
		const executor = await Effect.runPromise(
			makeStudioSequenceToolExecutor(
				(input) => {
					received.push(input);
					return runtime.build(input);
				},
				{
					logos: [
						{ name: "Stripe", slug: "stripe" },
						{ name: "GitHub", slug: "github" },
					],
				},
			),
		);
		const result = await Effect.runPromise(
			executor.execute({
				spec: {
					...checkout.spec,
					participants: [
						{ id: "browser", label: "Browser", icon: { slug: "stripe" } },
						{ id: "api", label: "API", icon: { slug: "kubernetes" } },
						{ id: "payments", label: "Stripe payments" },
					],
				},
			}),
		);

		const built = received[0] as StudioBuildSequenceInput;
		expect(built.spec.participants.map((participant) => participant.icon?.slug)).toEqual([
			undefined,
			undefined,
			"stripe",
		]);
		// Grounding reports the unnamed logo; this test runtime has no catalog, so
		// Code Mode also drops "stripe" with its own warning.
		expect(result.issues.map((issue) => [issue.code, issue.ref?.id])).toEqual([
			["unknown_icon", "api"],
			["unknown_icon", "payments"],
		]);
		expect(result.issues[0]?.message).toContain("not a technology the user named");
	});
});
