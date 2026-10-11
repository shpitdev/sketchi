/**
 * Studio chat routing eval: does the agent pick the build tool the user asked
 * for? A named diagram type must win over the topic in both directions; with
 * no type named, content decides. Each case is one live chat request.
 *
 *   SKETCHI_PLAYGROUND_URL=http://localhost:3000 pnpm eval:studio-routing [case-id ...]
 */
import { pathToFileURL } from "node:url";

import { NodeRuntime } from "@effect/platform-node";
import { Effect, Schema } from "effect";

export type StudioBuildTool = "build_flowchart" | "build_sequence_diagram";

export interface StudioRoutingCase {
	readonly expected: StudioBuildTool;
	readonly id: string;
	readonly prompt: string;
}

export const studioRoutingCases: readonly StudioRoutingCase[] = [
	{
		id: "named-flowchart-sequence-topic",
		expected: "build_flowchart",
		prompt:
			"Just draw it: a flowchart of our OAuth handshake. The browser redirects to the identity provider, the user signs in, the provider redirects back with a code, and the app exchanges the code for tokens.",
	},
	{
		id: "named-sequence-process-topic",
		expected: "build_sequence_diagram",
		prompt:
			"Just draw it: a sequence diagram of expense approval. The employee submits the expense to the manager, the manager approves it and forwards it to finance, and finance pays the employee.",
	},
	{
		id: "unnamed-interaction",
		expected: "build_sequence_diagram",
		prompt:
			"Just draw it: the browser calls the API, the API queries the database, the database returns rows, and the API returns JSON to the browser.",
	},
	{
		id: "unnamed-process",
		expected: "build_flowchart",
		prompt:
			"Just draw it: our release process. Open a release, run the tests, and if they pass ship it, otherwise fix the failures and run the tests again.",
	},
];

class StudioRoutingEvalError extends Schema.TaggedError<StudioRoutingEvalError>()(
	"StudioRoutingEvalError",
	{ cause: Schema.optionalKey(Schema.Defect()), message: Schema.String },
) {}

const ToolEvent = Schema.Struct({ toolName: Schema.String });
const isToolEvent = Schema.is(ToolEvent);

/** The first build tool a UI message stream (server-sent events) calls. */
export function firstBuildTool(stream: string): StudioBuildTool | undefined {
	for (const line of stream.split("\n")) {
		const data = line.startsWith("data:") ? line.slice("data:".length).trim() : "";
		if (!data.startsWith("{")) continue;
		let event: unknown;
		try {
			event = JSON.parse(data);
		} catch {
			continue;
		}
		if (
			isToolEvent(event) &&
			(event.toolName === "build_flowchart" || event.toolName === "build_sequence_diagram")
		) {
			return event.toolName;
		}
	}
	return undefined;
}

function chatRequest(prompt: string) {
	return {
		messages: [{ id: "routing-eval", role: "user", parts: [{ type: "text", text: prompt }] }],
	};
}

const runCase = Effect.fn("studioRoutingEval.case")(function* (
	baseUrl: string,
	routingCase: StudioRoutingCase,
) {
	const stream = yield* Effect.tryPromise({
		try: async (signal) => {
			const response = await fetch(new URL("/api/chat", baseUrl), {
				body: JSON.stringify(chatRequest(routingCase.prompt)),
				headers: { "Content-Type": "application/json" },
				method: "POST",
				signal,
			});
			if (!response.ok) throw new Error(`HTTP ${response.status}`);
			return response.text();
		},
		catch: (cause) =>
			StudioRoutingEvalError.make({ cause, message: `Chat request failed for ${routingCase.id}.` }),
	});
	const actual = firstBuildTool(stream);
	return { ...routingCase, actual, passed: actual === routingCase.expected };
});

const main = Effect.gen(function* () {
	const baseUrl = process.env["SKETCHI_PLAYGROUND_URL"]?.trim();
	if (!baseUrl) {
		return yield* StudioRoutingEvalError.make({
			message: "Set SKETCHI_PLAYGROUND_URL to a running playground.",
		});
	}
	const ids = new Set(process.argv.slice(2));
	const cases = studioRoutingCases.filter((entry) => ids.size === 0 || ids.has(entry.id));
	const results = yield* Effect.forEach(cases, (entry) => runCase(baseUrl, entry), {
		concurrency: 1,
	});
	for (const result of results) {
		console.log(
			`${result.passed ? "PASS" : "FAIL"} ${result.id}: expected ${result.expected}, got ${result.actual ?? "no build tool"}`,
		);
	}
	if (results.some((result) => !result.passed)) process.exitCode = 1;
});

const entryPointPath = process.argv[1];
if (entryPointPath && import.meta.url === pathToFileURL(entryPointPath).href) {
	NodeRuntime.runMain(main);
}
