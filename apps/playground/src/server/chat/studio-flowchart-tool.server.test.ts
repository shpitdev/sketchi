import { describe, expect, it, vi } from "@effect/vitest";
import { Effect, Fiber, Schema } from "effect";

import {
	BuildFlowchartResultSchema,
	BuildFlowchartRequestSchema,
	buildFlowchart,
	CodeModeArtifactStorage,
	CodeModeRuntimeEnvironment,
	DIAGRAM_AGENT_SYSTEM_PROMPT,
	makeMemoryArtifactStorage,
	type BuildFlowchartResult,
	type FlowchartSpec,
	toCodeModeJsonSchema,
} from "@sketchi/diagram-agent";

import {
	makeStudioFlowchartToolExecutor,
	StudioBuildFlowchartInputSchema,
	StudioBuildFlowchartOutputSchema,
	studioSystemPrompt,
} from "./studio-flowchart-tool.server";

function acceptedSpec(): FlowchartSpec {
	return {
		id: "release-review-loop",
		title: "Release review loop",
		direction: "TB",
		nodes: {
			start: "Open release",
			review: "Release ready?",
			publish: "Publish release",
			revise: "Revise release",
			done: "Release live",
		},
		edges: [
			["start", "review"],
			["review", "publish", "yes"],
			["review", "revise", "no"],
			["revise", "review"],
			["publish", "done"],
		],
	};
}

function rejectedSpec(): FlowchartSpec {
	const spec = acceptedSpec();
	return {
		...spec,
		edges: spec.edges.map((edge) =>
			edge[0] === "review" && edge[1] === "revise" ? ["review", "revise"] : edge,
		),
	};
}

function countingStore() {
	const memory = makeMemoryArtifactStorage();
	const write = vi.fn(memory.write);
	return {
		store: { ...memory, write },
		writes: () => write.mock.calls.length,
	};
}

function deterministicRuntime(counted: ReturnType<typeof countingStore>) {
	return (input: unknown) =>
		buildFlowchart(input).pipe(
			Effect.provideService(CodeModeArtifactStorage, counted.store),
			Effect.provideService(CodeModeRuntimeEnvironment, {
				createId: (prefix) => `${prefix}_fixed`,
			}),
		);
}

function deferred<T>() {
	let resolve: (value: T | PromiseLike<T>) => void = () => undefined;
	const promise = new Promise<T>((complete) => {
		resolve = complete;
	});
	return { promise, resolve };
}

const repairResult: BuildFlowchartResult = {
	ok: false,
	status: "invalid_flowchart",
	issues: [
		{
			code: "underbranched_decision",
			severity: "error",
			stage: "flowchart",
			ref: { kind: "node", id: "review", path: "spec.nodes[1]" },
			message: "Decision review must have at least two outgoing branches.",
			hint: "Add another labeled branch from this decision.",
		},
	],
};

describe("Studio build_flowchart host", () => {
	it("exposes package-derived Standard Schema input and output contracts", async () => {
		expect(
			StudioBuildFlowchartInputSchema["~standard"].jsonSchema.input({
				target: "draft-2020-12",
			}),
		).toEqual(toCodeModeJsonSchema(BuildFlowchartRequestSchema.omit({ options: true })));

		expect(
			StudioBuildFlowchartOutputSchema["~standard"].jsonSchema.output({
				target: "draft-2020-12",
			}),
		).toEqual(toCodeModeJsonSchema(BuildFlowchartResultSchema));
		expect(
			StudioBuildFlowchartOutputSchema["~standard"].jsonSchema.output({
				target: "draft-07",
			}).$schema,
		).toBe("http://json-schema.org/draft-07/schema#");

		const validRepair = await StudioBuildFlowchartOutputSchema["~standard"].validate(repairResult);
		expect(validRepair).toEqual({ value: repairResult });
		const invalidRepair = await StudioBuildFlowchartOutputSchema["~standard"].validate({
			ok: false,
			status: "invalid_flowchart",
			issues: [{}],
		});
		expect(invalidRepair).toHaveProperty("issues");
	});

	it("keeps declared lanes and groups through Studio's tool schema and builds them", async () => {
		const properties = (
			StudioBuildFlowchartInputSchema["~standard"].jsonSchema.input({
				target: "draft-2020-12",
			}) as { properties: { spec: { properties: Record<string, unknown> } } }
		).properties.spec.properties;
		expect(Object.keys(properties)).toEqual(expect.arrayContaining(["groups", "lanes"]));

		const lanes = {
			author: { label: "Author", contains: ["start", "publish", "revise", "done"] },
			reviewer: { label: "Reviewer", contains: ["review"] },
		};
		const laned = { ...acceptedSpec(), lanes };
		const validated = await StudioBuildFlowchartInputSchema["~standard"].validate({ spec: laned });
		if (!("value" in validated)) throw new Error(JSON.stringify(validated.issues));
		expect(validated.value.spec).toMatchObject({ lanes });

		const executor = await Effect.runPromise(
			makeStudioFlowchartToolExecutor(deterministicRuntime(countingStore())),
		);
		const built = await Effect.runPromise(executor.execute(validated.value));
		if (!built.ok) throw new Error(JSON.stringify(built.issues));
		expect(built.normalizedSpec.lanes).toEqual(lanes);
		const scene = built.artifact.formats.find((format) => format.format === "scene")?.inline as {
			elements: { rendererRole?: string }[];
		};
		expect(scene.elements.filter((element) => element.rendererRole === "swimlane")).toHaveLength(2);
	});

	it("keeps nested zones and node shapes through Studio's tool schema and builds them", async () => {
		const groups = {
			vpc: { label: "VPC", kind: "vpc" as const, contains: ["private", "revise"] },
			private: { label: "Private subnet", kind: "subnet" as const, contains: ["publish"] },
		};
		const spec = acceptedSpec();
		const zoned = {
			...spec,
			groups,
			nodes: { ...spec.nodes, publish: { label: "Publish release", shape: "document" as const } },
		};
		const validated = await StudioBuildFlowchartInputSchema["~standard"].validate({ spec: zoned });
		if (!("value" in validated)) throw new Error(JSON.stringify(validated.issues));
		expect(validated.value.spec).toMatchObject({ groups });

		const executor = await Effect.runPromise(
			makeStudioFlowchartToolExecutor(deterministicRuntime(countingStore())),
		);
		const built = await Effect.runPromise(executor.execute(validated.value));
		if (!built.ok) throw new Error(JSON.stringify(built.issues));
		expect(built.normalizedSpec.groups).toEqual(groups);
		const scene = built.artifact.formats.find((format) => format.format === "scene")?.inline as {
			elements: { rendererRole?: string; shape?: string }[];
		};
		expect(scene.elements.filter((element) => element.rendererRole === "zone")).toHaveLength(2);
		expect(scene.elements.filter((element) => element.shape === "document")).toHaveLength(1);
	});

	it("injects artifact options instead of exposing them to the model", async () => {
		let request: typeof BuildFlowchartRequestSchema.Type | undefined;
		const executor = await Effect.runPromise(
			makeStudioFlowchartToolExecutor((input) =>
				Effect.sync(() => {
					request = Schema.decodeUnknownSync(BuildFlowchartRequestSchema, {
						errors: "all",
						reportInput: true,
					})(input);
					return repairResult;
				}),
			),
		);

		await Effect.runPromise(executor.execute({ requestId: "studio-run", spec: rejectedSpec() }));

		expect(request).toMatchObject({
			options: {
				artifactFormats: ["scene", "excalidraw"],
				inlineArtifacts: ["scene"],
			},
			requestId: "studio-run",
		});
	});

	it("returns deterministic structured canonical issues for rejected flows", async () => {
		const firstStore = countingStore();
		const secondStore = countingStore();
		const firstExecutor = await Effect.runPromise(
			makeStudioFlowchartToolExecutor(deterministicRuntime(firstStore)),
		);
		const secondExecutor = await Effect.runPromise(
			makeStudioFlowchartToolExecutor(deterministicRuntime(secondStore)),
		);
		const first = await Effect.runPromise(firstExecutor.execute({ spec: rejectedSpec() }));
		const second = await Effect.runPromise(secondExecutor.execute({ spec: rejectedSpec() }));

		expect(second).toEqual(first);
		expect(first).toMatchObject({
			ok: false,
			status: "invalid_flowchart",
			issues: expect.arrayContaining([
				expect.objectContaining({
					code: "unlabeled_decision_branch",
					ref: expect.objectContaining({ id: "review->revise", kind: "edge" }),
					severity: "error",
					stage: "flowchart",
				}),
			]),
		});
		expect(firstStore.writes()).toBe(0);
		expect(secondStore.writes()).toBe(0);
	});

	it("persists one canonical artifact and reuses it after acceptance", async () => {
		const counted = countingStore();
		const executor = await Effect.runPromise(
			makeStudioFlowchartToolExecutor(deterministicRuntime(counted)),
		);

		const first = await Effect.runPromise(executor.execute({ spec: acceptedSpec() }));
		const duplicate = await Effect.runPromise(executor.execute({ spec: acceptedSpec() }));

		expect(first).toMatchObject({
			ok: true,
			status: "accepted",
			artifact: {
				artifactId: "artifact_fixed",
				formats: [
					expect.objectContaining({
						format: "scene",
						inline: expect.anything(),
					}),
					expect.objectContaining({ format: "excalidraw" }),
				],
			},
		});
		expect(duplicate).toEqual(first);
		await expect(Effect.runPromise(executor.attempts)).resolves.toBe(1);
		expect(counted.writes()).toBe(1);
	});

	it("serializes concurrent accepted calls and persists only the first artifact", async () => {
		const counted = countingStore();
		const build = deterministicRuntime(counted);
		const started = deferred<void>();
		const release = deferred<void>();
		let runtimeCalls = 0;
		const executor = await Effect.runPromise(
			makeStudioFlowchartToolExecutor((input) =>
				Effect.sync(() => {
					runtimeCalls += 1;
					started.resolve(undefined);
				}).pipe(
					Effect.andThen(Effect.promise(() => release.promise)),
					Effect.andThen(build(input)),
				),
			),
		);

		const firstPromise = Effect.runPromise(
			executor.execute({
				requestId: "accepted-first",
				spec: acceptedSpec(),
			}),
		);
		const queuedPromise = Effect.runPromise(
			executor.execute({
				requestId: "accepted-queued",
				spec: acceptedSpec(),
			}),
		);

		await started.promise;
		expect(runtimeCalls).toBe(1);
		await expect(Effect.runPromise(executor.attempts)).resolves.toBe(1);
		expect(counted.writes()).toBe(0);

		release.resolve(undefined);
		const [first, queued] = await Promise.all([firstPromise, queuedPromise]);

		expect(first).toMatchObject({ ok: true, status: "accepted" });
		expect(queued).toBe(first);
		expect(runtimeCalls).toBe(1);
		await expect(Effect.runPromise(executor.attempts)).resolves.toBe(1);
		expect(counted.writes()).toBe(1);
	});

	it("serializes concurrent rejected calls and applies the cap in queue order", async () => {
		const started = deferred<void>();
		const release = deferred<void>();
		const requestIds: Array<string> = [];
		const executor = await Effect.runPromise(
			makeStudioFlowchartToolExecutor((input) =>
				Effect.gen(function* () {
					const request = Schema.decodeUnknownSync(BuildFlowchartRequestSchema, {
						errors: "all",
						reportInput: true,
					})(input);
					requestIds.push(request.requestId ?? "missing-request-id");
					if (requestIds.length === 1) {
						started.resolve(undefined);
						yield* Effect.promise(() => release.promise);
					}
					return repairResult;
				}),
			),
		);

		const pending = ["repair-1", "repair-2", "repair-3", "past-cap"].map((requestId) =>
			Effect.runPromise(executor.execute({ requestId, spec: rejectedSpec() })),
		);

		await started.promise;
		expect(requestIds).toEqual(["repair-1"]);
		await expect(Effect.runPromise(executor.attempts)).resolves.toBe(1);

		release.resolve(undefined);
		const results = await Promise.all(pending);

		expect(requestIds).toEqual(["repair-1", "repair-2", "repair-3"]);
		expect(results.slice(0, 3)).toEqual([repairResult, repairResult, repairResult]);
		expect(results[3]).toMatchObject({
			ok: false,
			status: "quality_failed",
		});
		await expect(Effect.runPromise(executor.attempts)).resolves.toBe(3);
	});

	it("caps rejected repair attempts at three without invoking the runtime again", async () => {
		let calls = 0;
		const executor = await Effect.runPromise(
			makeStudioFlowchartToolExecutor(() =>
				Effect.sync(() => {
					calls += 1;
					return repairResult;
				}),
			),
		);

		await Effect.runPromise(executor.execute({ spec: rejectedSpec() }));
		await Effect.runPromise(executor.execute({ spec: rejectedSpec() }));
		await Effect.runPromise(executor.execute({ spec: rejectedSpec() }));
		const capped = await Effect.runPromise(executor.execute({ spec: acceptedSpec() }));

		expect(calls).toBe(3);
		await expect(Effect.runPromise(executor.attempts)).resolves.toBe(3);
		expect(capped).toMatchObject({
			ok: false,
			status: "quality_failed",
			issues: [
				expect.objectContaining({
					hint: "Explain that the draft needs another pass and invite the user to simplify or clarify the request.",
					message: "The diagram still needs changes before it can be shared.",
				}),
			],
		});
		expect(JSON.stringify(capped)).not.toMatch(/build_flowchart|attempts|structured issues/i);
	});

	it.effect("bounds execution to one and releases the permit on interruption", () =>
		Effect.gen(function* () {
			const firstStarted = Promise.withResolvers<void>();
			let active = 0;
			let calls = 0;
			let maxActive = 0;
			const executor = yield* makeStudioFlowchartToolExecutor(() =>
				Effect.gen(function* () {
					calls += 1;
					active += 1;
					maxActive = Math.max(maxActive, active);
					if (calls === 1) {
						firstStarted.resolve();
						return yield* Effect.never;
					}
					return repairResult;
				}).pipe(
					Effect.ensuring(
						Effect.sync(() => {
							active -= 1;
						}),
					),
				),
			);
			const first = yield* Effect.forkChild(
				executor.execute({ requestId: "first", spec: rejectedSpec() }),
			);
			yield* Effect.promise(() => firstStarted.promise);
			const second = yield* Effect.forkChild(
				executor.execute({ requestId: "second", spec: rejectedSpec() }),
			);
			yield* Effect.yieldNow;

			expect(calls).toBe(1);
			expect(maxActive).toBe(1);
			yield* Fiber.interrupt(first);
			const secondResult = yield* Fiber.join(second);

			expect(secondResult).toEqual(repairResult);
			expect(calls).toBe(2);
			expect(maxActive).toBe(1);
			expect(yield* executor.attempts).toBe(2);
		}),
	);
});

describe("Studio chat node logos", () => {
	it("lists only the logos the user named in the system prompt", () => {
		expect(studioSystemPrompt([])).toBe(DIAGRAM_AGENT_SYSTEM_PROMPT);
		const prompt = studioSystemPrompt([
			{ name: "Github", slug: "github" },
			{ name: "Docker", slug: "docker" },
		]);
		expect(prompt.startsWith(DIAGRAM_AGENT_SYSTEM_PROMPT)).toBe(true);
		expect(prompt).toContain("github (Github), docker (Docker)");
		expect(prompt).toContain("Never invent a slug.");
	});

	it("drops icons for technologies the user never named before building", async () => {
		const received: unknown[] = [];
		const accepted = await Effect.runPromise(
			deterministicRuntime(countingStore())({ spec: acceptedSpec() }),
		);
		const executor = await Effect.runPromise(
			makeStudioFlowchartToolExecutor(
				(input) =>
					Effect.sync(() => {
						received.push(input);
						return accepted;
					}),
				{ logos: [{ name: "Github", slug: "github" }] },
			),
		);
		const spec = acceptedSpec();
		const result = await Effect.runPromise(
			executor.execute({
				spec: {
					...spec,
					nodes: {
						...spec.nodes,
						start: { label: "Open release on GitHub", icon: "GitHub" },
						review: { label: "Release ready?", icon: "kubernetes" },
					},
				},
			}),
		);

		const built = received[0] as { spec: FlowchartSpec };
		expect(built.spec.nodes["start"]).toEqual({ label: "Open release on GitHub", icon: "GitHub" });
		expect(built.spec.nodes["review"]).toEqual({ label: "Release ready?" });
		expect(result.issues[0]).toMatchObject({
			code: "unknown_icon",
			severity: "warning",
			ref: { kind: "node", id: "review", path: "nodes.review.icon" },
		});
	});

	it("lets logos fill only a logo the user named, and never refills a dropped icon", async () => {
		const received: unknown[] = [];
		const accepted = await Effect.runPromise(
			deterministicRuntime(countingStore())({ spec: acceptedSpec() }),
		);
		const executor = await Effect.runPromise(
			makeStudioFlowchartToolExecutor(
				(input) =>
					Effect.sync(() => {
						received.push(input);
						return accepted;
					}),
				{ logos: [{ name: "Github", slug: "github" }] },
			),
		);
		const result = await Effect.runPromise(
			executor.execute({
				spec: {
					title: "Release",
					logos: true,
					nodes: {
						start: "Open release on GitHub",
						review: { label: "Release ready?", icon: "kubernetes" },
						deploy: "Deploy to Kubernetes",
						skip: { label: "Skip release", icon: null },
					},
					edges: [
						["start", "review"],
						["review", "deploy", "yes"],
						["review", "skip", "no"],
					],
				},
			}),
		);

		const built = received[0] as { spec: FlowchartSpec };
		expect(built.spec.logos).toBe(true);
		expect(built.spec.nodes).toEqual({
			start: { label: "Open release on GitHub", icon: "github" },
			review: { label: "Release ready?", icon: null },
			deploy: { label: "Deploy to Kubernetes", icon: null },
			skip: { label: "Skip release", icon: null },
		});
		expect(result.issues.filter((issue) => issue.code === "unknown_icon")).toEqual([
			expect.objectContaining({
				ref: { kind: "node", id: "review", path: "nodes.review.icon" },
				message: expect.stringContaining("renders without a logo"),
			}),
		]);
	});
});
