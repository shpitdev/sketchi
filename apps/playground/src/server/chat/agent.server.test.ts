import { describe, expect, it } from "@effect/vitest";
import { buildResponse } from "@sketchi/diagrams/build/operation";
import { toAgUiMessages, type ChatMessage } from "../../features/playground/chat-message";
import { AiError, LanguageModel, Response as AiResponse } from "effect/ai";
import { Deferred, Effect, Stream } from "effect";

import {
	CodeModeArtifactStorage,
	makeMemoryArtifactStorage,
} from "@sketchi/diagrams/build/code-mode/artifacts";
import { type BuildFlowchartResult } from "@sketchi/diagrams/families/flowchart/build";
import {
	buildFlowchart,
	CodeModeRuntimeEnvironment,
} from "@sketchi/diagrams/build/code-mode/runtime";

import { PlaygroundAiModel } from "../ai/model.server";

import {
	MAX_CHAT_TOTAL_CHARACTERS,
	studioChatRequestMessages,
} from "../../features/playground/studio-chat-request";
import { runPlaygroundEffect } from "../runtime/runtime.server";
import { handleStudioAgentRequest } from "./agent.server";

const runInput = (messages: unknown) => ({ threadId: "studio", runId: "run-1", messages });
const usage = new AiResponse.Usage({ inputTokens: { total: 1 }, outputTokens: { total: 1 } });
const finish = (reason: AiResponse.FinishReason = "stop") =>
	AiResponse.makePart("finish", { reason, usage });
const answer = (text: string) => [
	AiResponse.makePart("text-start", { id: "t" }),
	AiResponse.makePart("text-delta", { id: "t", delta: text }),
	AiResponse.makePart("text-end", { id: "t" }),
	finish(),
];
async function mockModel(rounds: ReadonlyArray<ReadonlyArray<AiResponse.StreamPartEncoded>>) {
	const calls: LanguageModel.ProviderOptions[] = [];
	const model = await Effect.runPromise(
		LanguageModel.make({
			generateText: () => Effect.die("Unexpected generateText"),
			streamText: (options) => {
				calls.push(options);
				return Stream.fromIterable(rounds[calls.length - 1] ?? []);
			},
		}),
	);
	return { model, calls };
}

describe("chat request boundaries", () => {
	const message = {
		id: "user-1",
		role: "user",
		content: "Draw a flowchart",
	};
	function chat(body: unknown) {
		const request = new Request("https://studio.test/api/studio/chat", {
			method: "POST",
			body: JSON.stringify({ threadId: "studio", runId: "run-1", ...(body as object) }),
		});
		return runPlaygroundEffect(handleStudioAgentRequest(request), {
			env: {},
			platform: { waitUntilPromise: () => undefined },
			request,
		});
	}
	it("reports a missing AI binding as a static 503", async () => {
		const response = await chat({ messages: [message] });
		expect(response.status).toBe(503);
		expect(await response.text()).toBe("Chat is temporarily unavailable.");
	});
	it.each([
		{ messages: Array.from({ length: 65 }, () => message) },
		{
			messages: [{ ...message, content: "x".repeat(32_001) }],
		},
		{ messages: [message], extra: "x".repeat(128 * 1024) },
	])("rejects oversized chat input before AI configuration", async (body) => {
		expect((await chat(body)).status).toBe(413);
	});
	it("accepts the message-count and serialized character boundaries", async () => {
		expect((await chat({ messages: Array.from({ length: 64 }, () => message) })).status).toBe(503);
		const empty = [{ ...message, content: "" }];
		const text = "x".repeat(32_000 - JSON.stringify(empty).length);
		expect(
			(
				await chat({
					messages: [{ ...message, content: text }],
				})
			).status,
		).toBe(503);
	});
	it("maps a failed chat body stream at the HTTP runtime edge", async () => {
		const stream = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.error(new Error("private body failure"));
			},
		});
		const init: RequestInit & { duplex: "half" } = {
			method: "POST",
			body: stream,
			duplex: "half",
		};
		const request = new Request("https://studio.test/api/studio/chat", init);
		const response = await runPlaygroundEffect(handleStudioAgentRequest(request), {
			env: {},
			platform: { waitUntilPromise: () => undefined },
			request,
		});
		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({
			ok: false,
			error: "The request body could not be read.",
		});
	});
	it("rejects invalid message structure", async () => {
		expect((await chat({ messages: [{ role: "not-a-role", parts: [] }] })).status).toBe(400);
	});
});

describe("Studio build results the model reads", () => {
	const spec = {
		title: "Release review",
		direction: "TB",
		nodes: { start: "Open release", review: "Approved?", ship: "Ship release", fix: "Fix release" },
		edges: [
			["start", "review"],
			["review", "ship", "yes"],
			["review", "fix", "no"],
			["fix", "review"],
		],
	};
	const build = (input: unknown) =>
		buildResponse(buildFlowchart(input)).pipe(
			Effect.provideService(CodeModeArtifactStorage, makeMemoryArtifactStorage()),
			Effect.provideService(CodeModeRuntimeEnvironment, {
				createId: (prefix) => `${prefix}_fixed`,
			}),
		);

	it("keeps the scene, its files and the normalized spec out of every model call", async () => {
		// The history a client replays carries an earlier build's full result, scene and all.
		const earlier: BuildFlowchartResult = await Effect.runPromise(build({ spec }));
		expect(JSON.stringify(earlier)).toContain('"elements"');
		const { model, calls } = await mockModel([
			[
				AiResponse.makePart("tool-call", {
					id: "call-2",
					name: "build_flowchart",
					providerExecuted: false,
					params: { spec: { ...spec, title: "Release review, revised" } },
				}),
				finish("tool-calls"),
			],
			answer("Updated."),
		]);
		const request = new Request("https://studio.test/api/studio/chat", {
			method: "POST",
			body: JSON.stringify(
				runInput(
					toAgUiMessages([
						{ id: "u1", role: "user", parts: [{ type: "text", text: "Draw the release review." }] },
						{
							id: "a1",
							role: "assistant",
							parts: [
								{
									type: "tool-build_flowchart",
									toolCallId: "call-1",
									state: "output-available",
									input: { spec },
									output: earlier,
								},
								{ type: "text", text: "Here it is." },
							],
						},
						{ id: "u2", role: "user", parts: [{ type: "text", text: "Retitle it." }] },
					]),
				),
			),
		});
		const response = await runPlaygroundEffect(
			handleStudioAgentRequest(request).pipe(
				Effect.provideService(PlaygroundAiModel, { model: Effect.succeed(model) }),
			),
			{ env: {}, platform: { waitUntilPromise: () => undefined }, request },
		);
		const body = await response.text();
		// The client still gets the scene.
		expect(body).toContain('\\"elements\\"');
		expect(calls).toHaveLength(2);
		const prompts = calls
			.flatMap((call) =>
				call.prompt.content.flatMap((message) =>
					message.role === "tool"
						? message.content.flatMap((part) =>
								part.type === "tool-result" ? part.modelOutput : [],
							)
						: [],
				),
			)
			.map((part) => (part?.type === "text" ? part.text : ""))
			.join("\n");
		for (const kept of ['"elements"', '"files"', '"inline"', "normalizedSpec", '"formats"'])
			expect(prompts).not.toContain(kept);
		expect(prompts).toContain('"artifactId":"artifact_fixed"');
		expect(prompts).toContain('"status":"accepted"');
	});

	it("keeps a long conversation on a large diagram within the request limits", async () => {
		const earlier: BuildFlowchartResult = await Effect.runPromise(build({ spec }));
		if (!earlier.ok) throw new Error("The release review should build.");
		// A large diagram: each accepted result carries a scene of about 16k characters.
		const large = {
			...earlier,
			artifact: {
				...earlier.artifact,
				formats: [{ format: "scene", inline: { elements: "x".repeat(16_000) } }],
			},
		};
		const messages: ChatMessage[] = [];
		for (let edit = 0; edit < 12; edit += 1) {
			messages.push({
				id: `u${edit}`,
				role: "user",
				parts: [{ type: "text", text: edit === 0 ? "Draw the release review." : `Edit ${edit}.` }],
			});
			messages.push({
				id: `a${edit}`,
				role: "assistant",
				parts: [
					{
						type: "tool-build_flowchart",
						toolCallId: `call-${edit}`,
						state: "output-available",
						input: { spec: { ...spec, title: `Release review ${edit}` } },
						output: large,
					},
					{ type: "text", text: "Updated." },
				],
			});
		}
		messages.push({ id: "u-last", role: "user", parts: [{ type: "text", text: "Retitle it." }] });
		expect(JSON.stringify(messages).length).toBeGreaterThan(MAX_CHAT_TOTAL_CHARACTERS);

		const { model, calls } = await mockModel([answer("Which title?")]);
		const request = new Request("https://studio.test/api/studio/chat", {
			method: "POST",
			body: JSON.stringify(runInput(toAgUiMessages(studioChatRequestMessages(messages)))),
		});
		const response = await runPlaygroundEffect(
			handleStudioAgentRequest(request).pipe(
				Effect.provideService(PlaygroundAiModel, { model: Effect.succeed(model) }),
			),
			{ env: {}, platform: { waitUntilPromise: () => undefined }, request },
		);
		expect(response.status).toBe(200);
		await response.text();
		const prompt = JSON.stringify(calls[0]?.prompt);
		expect(prompt).toContain("Release review 11");
		expect(prompt).toContain("Retitle it.");
	});

	it("keeps a saved diagram's logos when trimming drops the request that named them", async () => {
		const earlier: BuildFlowchartResult = await Effect.runPromise(build({ spec }));
		if (!earlier.ok) throw new Error("The release review should build.");
		const withLogos = {
			...earlier,
			normalizedSpec: {
				...earlier.normalizedSpec,
				logos: true,
				nodes: {
					errors: { label: "Sentry", icon: "sentry" },
					db: { label: "Postgres", icon: "postgresql" },
				},
			},
		};
		const messages: ChatMessage[] = [
			{
				id: "u0",
				role: "user",
				parts: [
					{ type: "text", text: "Draw our backend: Sentry tracks errors, Postgres stores orders." },
				],
			},
			{
				id: "a0",
				role: "assistant",
				parts: [
					{
						type: "tool-build_flowchart",
						toolCallId: "call-0",
						state: "output-available",
						input: { spec },
						output: withLogos,
					},
				],
			},
		];
		for (let turn = 1; turn < 10; turn += 1) {
			messages.push(
				{ id: `u${turn}`, role: "user", parts: [{ type: "text", text: `Question ${turn}?` }] },
				{ id: `a${turn}`, role: "assistant", parts: [{ type: "text", text: "w".repeat(4_000) }] },
			);
		}
		messages.push({ id: "u-last", role: "user", parts: [{ type: "text", text: "Retitle it." }] });
		const sent = studioChatRequestMessages(messages);
		expect(JSON.stringify(sent)).not.toContain("Draw our backend");

		const { model, calls } = await mockModel([answer("Which title?")]);
		const request = new Request("https://studio.test/api/studio/chat", {
			method: "POST",
			body: JSON.stringify(runInput(toAgUiMessages(sent))),
		});
		const response = await runPlaygroundEffect(
			handleStudioAgentRequest(request).pipe(
				Effect.provideService(PlaygroundAiModel, { model: Effect.succeed(model) }),
			),
			{ env: {}, platform: { waitUntilPromise: () => undefined }, request },
		);
		expect(response.status).toBe(200);
		await response.text();
		const prompt = JSON.stringify(calls[0]?.prompt);
		expect(prompt).toContain("NODE LOGOS");
		expect(prompt).toContain("sentry (Sentry)");
		expect(prompt).toContain("postgresql");
	});
});

describe("chat stream request lifetime", () => {
	it("exports late build and Chat spans to each request's own pipeline with correlated parents", async () => {
		await Promise.all(
			["one", "two"].map(async (id) => {
				const sends: ReadonlyArray<import("@sketchi/observability").TelemetrySpanRow>[] = [];
				const pending: Promise<unknown>[] = [];
				const { model } = await mockModel([
					[
						AiResponse.makePart("tool-call", {
							id: `call-${id}`,
							name: "build_flowchart",
							providerExecuted: false,
							params: {
								spec: {
									title: `Review ${id}`,
									nodes: { a: "Open", b: "Done" },
									edges: [["a", "b"]],
								},
							},
						}),
						finish("tool-calls"),
					],
					answer("Saved."),
				]);
				const request = new Request("https://studio.test/api/studio/chat", {
					method: "POST",
					headers: {
						"x-sketchi-trace-id": `trace-${id}`,
						"x-sketchi-run-id": `run-${id}`,
						"x-sketchi-attempt-id": `attempt-${id}`,
					},
					body: JSON.stringify(runInput([{ id: "user", role: "user", content: "Draw a review" }])),
				});
				const response = await runPlaygroundEffect(
					handleStudioAgentRequest(request).pipe(
						Effect.provideService(PlaygroundAiModel, { model: Effect.succeed(model) }),
					),
					{
						request,
						env: {
							TELEMETRY_SPANS: {
								send: async (rows) => {
									sends.push(rows as import("@sketchi/observability").TelemetrySpanRow[]);
								},
							},
						},
						platform: { waitUntilPromise: (promise) => pending.push(promise) },
					},
				);
				const body = await response.text();
				await Promise.all(pending);
				const rows = sends.flat();
				const root = rows.find((row) => row.name === "playground.request");
				expect(root).toBeDefined();
				expect(rows.map((row) => row.name).join("\n")).toContain(
					"playground.chat.buildFlowchart.execute",
				);
				expect(rows.some((row) => row.name === "Chat.streamText")).toBe(true);
				const stream = rows.find((row) => row.name === "playground.response.stream");
				expect(JSON.parse(stream?.attributes ?? "{}")["http.response.body"]).toBe(body);
				for (const row of rows) {
					expect(row).toMatchObject({
						trace_id: root?.trace_id,
						run_id: `run-${id}`,
						attempt_id: `attempt-${id}`,
					});
					expect(JSON.parse(row.attributes)["sketchi.trace_id"]).toBe(`trace-${id}`);
					if (row !== root)
						expect(
							rows.some((parent) => parent.span_id === row.parent_span_id),
							row.name,
						).toBe(true);
				}
			}),
		);
	});
});

it("interrupts the live provider when the HTTP request is cancelled", async () => {
	const started = Deferred.makeUnsafe<void>();
	const stopped = Deferred.makeUnsafe<void>();
	let calls = 0;
	const model = await Effect.runPromise(
		LanguageModel.make({
			generateText: () => Effect.die("Unexpected generateText"),
			streamText: () => {
				calls++;
				return Stream.fromEffect(Deferred.succeed(started, undefined)).pipe(
					Stream.drain,
					Stream.concat(Stream.never),
					Stream.ensuring(Deferred.succeed(stopped, undefined)),
				);
			},
		}),
	);
	const abort = new AbortController();
	const request = new Request("https://studio.test/api/studio/chat", {
		method: "POST",
		signal: abort.signal,
		body: JSON.stringify(runInput([{ id: "u1", role: "user", content: "Draw it" }])),
	});
	const response = await runPlaygroundEffect(
		handleStudioAgentRequest(request).pipe(
			Effect.provideService(PlaygroundAiModel, { model: Effect.succeed(model) }),
		),
		{ request, env: {}, platform: { waitUntilPromise: () => undefined } },
	);
	const body = response.text();
	await Effect.runPromise(Deferred.await(started));
	abort.abort();
	await Effect.runPromise(Deferred.await(stopped));
	await body;
	expect(calls).toBe(1);
});
it("reports a provider failure through a sanitized terminal AG-UI event", async () => {
	const model = await Effect.runPromise(
		LanguageModel.make({
			generateText: () => Effect.die("Unexpected generateText"),
			streamText: () =>
				Stream.fail(
					AiError.make({
						module: "test",
						method: "stream",
						reason: new AiError.InvalidOutputError({ description: "private upstream failure" }),
					}),
				),
		}),
	);
	const request = new Request("https://studio.test/api/studio/chat", {
		method: "POST",
		body: JSON.stringify(runInput([{ id: "u1", role: "user", content: "Draw it" }])),
	});
	const response = await runPlaygroundEffect(
		handleStudioAgentRequest(request).pipe(
			Effect.provideService(PlaygroundAiModel, { model: Effect.succeed(model) }),
		),
		{ request, env: {}, platform: { waitUntilPromise: () => undefined } },
	);
	const body = await response.text();
	expect(response.status).toBe(200);
	expect(body).toContain('"type":"RUN_ERROR"');
	expect(body).not.toContain("private upstream failure");
	expect(body).not.toContain('"type":"RUN_FINISHED"');
});
