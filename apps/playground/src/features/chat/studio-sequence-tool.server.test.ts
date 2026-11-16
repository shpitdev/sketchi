import { buildResponse } from "@sketchi/diagrams/build/operation";
import { sequenceBuild } from "@sketchi/diagrams/families/sequence/build";
import { describe, expect, it, vi } from "@effect/vitest";

import { Effect } from "effect";

import {
	CodeModeArtifactStorage,
	makeMemoryArtifactStorage,
} from "@sketchi/diagrams/build/code-mode/artifacts";
import {
	buildFlowchart,
	buildSequenceDiagram,
	CodeModeRuntimeEnvironment,
} from "@sketchi/diagrams/build/code-mode/runtime";

import {
	makeStudioFlowchartToolExecutor,
	makeStudioSequenceToolExecutor,
	type StudioBuildFlowchartInput,
} from "./studio-build-policy.server";
import { makeStudioBuildTurn, STUDIO_ARTIFACT_OPTIONS } from "./studio-build-tool.server";

const checkout: typeof sequenceBuild.toolInput.Type = {
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
		build: (input: unknown) => provide(buildResponse(buildSequenceDiagram(input))),
		buildFlowchart: (input: unknown) => provide(buildResponse(buildFlowchart(input))),
		writes: () => write.mock.calls.length,
	};
}

const releaseFlow: StudioBuildFlowchartInput = {
	spec: {
		title: "Release",
		direction: "TB",
		nodes: {
			start: "Open release",
			ship: "Ship release",
			done: "Release live",
		},
		edges: [
			["start", "ship"],
			["ship", "done"],
		],
	},
};
describe("Studio build_sequence_diagram host", () => {
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

		expect(requests).toMatchObject([{ ...checkout, options: STUDIO_ARTIFACT_OPTIONS }]);
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
		const strayMessage: typeof sequenceBuild.toolInput.Type = {
			spec: {
				...checkout.spec,
				messages: [{ id: "lost", source: "api", target: "ghost", label: "Retry" }],
			},
		};

		const rejected = await Effect.runPromise(executor.execute(strayMessage));
		expect(rejected).toMatchObject({
			ok: false,
			status: "invalid_sequence",
			issues: [expect.objectContaining({ code: "missing_message_target" })],
		});
		await Effect.runPromise(executor.execute(strayMessage));
		await Effect.runPromise(executor.execute(strayMessage));
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
		const strayMessage: typeof sequenceBuild.toolInput.Type = {
			spec: { ...checkout.spec, messages: [{ source: "api", target: "ghost", label: "Retry" }] },
		};

		await Effect.runPromise(sequence.execute(strayMessage));
		await Effect.runPromise(sequence.execute(strayMessage));
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
						{ name: "PayPal", slug: "paypal" },
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
						{ id: "browser", label: "Browser", icon: { slug: "paypal" } },
						{ id: "api", label: "API", icon: { slug: "kubernetes" } },
						{ id: "payments", label: "PayPal payments" },
					],
				},
			}),
		);

		const built = received[0] as typeof sequenceBuild.toolInput.Type;
		expect(built.spec.participants.map((participant) => participant.icon?.slug)).toEqual([
			undefined,
			undefined,
			"paypal",
		]);
		// Grounding reports the unnamed logo; this test runtime has no catalog, so
		// Code Mode also drops "paypal" with its own warning.
		expect(result.issues.map((issue) => [issue.code, issue.ref?.id])).toEqual([
			["unknown_icon", "api"],
			["unknown_icon", "payments"],
		]);
		expect(result.issues[0]?.message).toContain("not a technology the user named");
	});
});
