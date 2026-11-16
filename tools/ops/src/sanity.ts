// Hand-run end-to-end sanity checks against a deployed Studio. Never run by CI:
// graded evals live in Frontierclimb.
//
//   pnpm sanity                                          production
//   pnpm sanity --endpoint https://pr-<N>-sketchi-studio.dimethyl.workers.dev
//   pnpm sanity untyped-generate                         one check
//
// Every request carries `x-sketchi-client: sketchi-sanity` and one `sanity_` run
// ID, printed at the end with the DuckDB queries that find it.
import { Clock, Console, DateTime, Effect, Option, Random, Schema } from "effect";
import { HttpClient, HttpClientRequest, type HttpClientResponse } from "effect/http";

import { opsError } from "./process";

export const DEFAULT_ENDPOINT = "https://playground.sketchi.app";
const CLIENT = "sketchi-sanity";
// Past the server's own generation budget, so a slow answer reads as the server's.
const GENERATE_TIMEOUT = "150 seconds";
const MCP_TIMEOUT = "90 seconds";

const EXECUTE_CODE = `async () => sketchi.buildFlowchart({
  spec: {
    title: "Sanity check",
    nodes: { start: "Start", ok: "Healthy?", done: "Done", page: "Page on-call" },
    edges: [
      ["start", "ok"],
      ["ok", "done", "yes"],
      ["ok", "page", "no"],
    ],
  },
})`;

interface Context {
	readonly check: string;
	readonly endpoint: string;
	readonly runId: string;
}

const decodeJson = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown));

/**
 * The response with its whole body read. Each check's deadline wraps this, not just the request:
 * a server can send headers at once and then stall the body.
 */
const withText = (response: HttpClientResponse.HttpClientResponse) =>
	response.text.pipe(Effect.map((text) => ({ response, text })));

function headers(context: Context) {
	return {
		"x-sketchi-client": CLIENT,
		"x-sketchi-run-id": context.runId,
		"x-sketchi-trace-id": `${context.runId}_${context.check}`.slice(0, 64),
	};
}

const GenerateBody = Schema.Struct({
	ok: Schema.optional(Schema.Boolean),
	issues: Schema.optional(
		Schema.Array(Schema.Struct({ code: Schema.String, message: Schema.String })),
	),
	diagram: Schema.optional(
		Schema.Struct({
			document: Schema.optional(Schema.Struct({ type: Schema.String, spec: Schema.Unknown })),
			excalidraw: Schema.optional(Schema.Struct({ elements: Schema.Array(Schema.Unknown) })),
		}),
	),
	generation: Schema.optional(
		Schema.Struct({
			model: Schema.optional(Schema.String),
			attempts: Schema.optional(Schema.Number),
			usage: Schema.optional(
				Schema.Struct({
					inputTokens: Schema.optional(Schema.Number),
					outputTokens: Schema.optional(Schema.Number),
				}),
			),
		}),
	),
});

const generate = Effect.fn("ops.sanity.generate")(function* (
	context: Context,
	input: {
		readonly prompt: string;
		readonly type?: string;
		readonly expectedType: string;
		readonly labels: readonly string[];
	},
) {
	const client = yield* HttpClient.HttpClient;
	const { response, text } = yield* client
		.execute(
			HttpClientRequest.post(new URL("/api/v1/generate", context.endpoint)).pipe(
				HttpClientRequest.setHeaders(headers(context)),
				HttpClientRequest.bodyJsonUnsafe({
					prompt: input.prompt,
					...(input.type ? { type: input.type } : {}),
				}),
			),
		)
		.pipe(Effect.flatMap(withText), Effect.timeout(GENERATE_TIMEOUT));
	const body = Option.getOrUndefined(
		Option.flatMap(decodeJson(text), Schema.decodeUnknownOption(GenerateBody)),
	);
	if (!body) return yield* opsError(`HTTP ${response.status}, not JSON: ${text.slice(0, 200)}`);
	if (response.status >= 300 || body.ok === false) {
		const issue = body.issues?.[0];
		return yield* opsError(
			`HTTP ${response.status}${issue ? `: ${issue.code}: ${issue.message}` : ""}`,
		);
	}
	const document = body.diagram?.document;
	if (document?.type !== input.expectedType) {
		return yield* opsError(
			`expected a ${input.expectedType}, got ${document?.type ?? "no diagram"}`,
		);
	}
	if (!body.diagram?.excalidraw?.elements.length) {
		return yield* opsError("the scene has no elements");
	}
	const spec = JSON.stringify(document.spec).toLowerCase();
	const missing = input.labels.filter((label) => !spec.includes(label.toLowerCase()));
	if (missing.length > 0) {
		return yield* opsError(`a ${input.expectedType} without ${missing.join(", ")}`);
	}
	const { model, attempts, usage } = body.generation ?? {};
	const tokens = usage ? `${usage.inputTokens ?? "?"} in / ${usage.outputTokens} out` : "no usage";
	return `${input.expectedType}, ${model}, ${attempts ?? 1} attempt(s), ${tokens}`;
});

const RpcMessage = Schema.Struct({
	id: Schema.optional(Schema.Unknown),
	result: Schema.optional(Schema.Unknown),
	error: Schema.optional(Schema.Struct({ message: Schema.String })),
});

/** The JSON-RPC messages of a Streamable HTTP answer, plain JSON or server-sent events. */
function rpcMessages(contentType: string, text: string) {
	const bodies = contentType.includes("text/event-stream")
		? text
				.split("\n")
				.filter((line) => line.startsWith("data:"))
				.map((line) => line.slice("data:".length).trim())
				.filter((data) => data.startsWith("{"))
		: [text];
	return bodies.flatMap((body) =>
		Option.toArray(Option.flatMap(decodeJson(body), Schema.decodeUnknownOption(RpcMessage))),
	);
}

const mcpCall = Effect.fn("ops.sanity.mcp")(function* (
	context: Context,
	id: number,
	method: string,
	params: unknown,
) {
	const client = yield* HttpClient.HttpClient;
	const { response, text } = yield* client
		.execute(
			HttpClientRequest.post(new URL("/mcp", context.endpoint)).pipe(
				HttpClientRequest.setHeaders({
					accept: "application/json, text/event-stream",
					...headers(context),
				}),
				HttpClientRequest.bodyJsonUnsafe({ jsonrpc: "2.0", id, method, params }),
			),
		)
		.pipe(Effect.flatMap(withText), Effect.timeout(MCP_TIMEOUT));
	if (response.status >= 300) {
		return yield* opsError(`${method}: HTTP ${response.status}: ${text.slice(0, 200)}`);
	}
	const message = rpcMessages(response.headers["content-type"] ?? "", text).find(
		(entry) => entry.id === id,
	);
	if (!message) return yield* opsError(`${method}: no answer to request ${id}`);
	if (message.error) return yield* opsError(`${method}: ${message.error.message}`);
	return message.result;
});

const ToolResult = Schema.Struct({
	isError: Schema.optional(Schema.Boolean),
	content: Schema.optional(
		Schema.Array(Schema.Struct({ type: Schema.String, text: Schema.optional(Schema.String) })),
	),
});
const BuildPayload = Schema.Struct({
	ok: Schema.Literal(true),
	artifactDelivery: Schema.optional(
		Schema.Struct({ artifactId: Schema.String, pngUrl: Schema.optional(Schema.String) }),
	),
});

const mcpExecute = Effect.fn("ops.sanity.mcpExecute")(function* (context: Context) {
	yield* mcpCall(context, 1, "initialize", {
		protocolVersion: "2025-06-18",
		capabilities: {},
		clientInfo: { name: CLIENT, version: "1" },
	});
	const result = Option.getOrUndefined(
		Schema.decodeUnknownOption(ToolResult)(
			yield* mcpCall(context, 2, "tools/call", {
				name: "execute",
				arguments: { code: EXECUTE_CODE },
			}),
		),
	);
	const texts = (result?.content ?? []).filter((part) => part.type === "text");
	if (result?.isError) {
		return yield* opsError(`execute failed: ${texts[0]?.text?.slice(0, 300) ?? "no message"}`);
	}
	const payload = texts
		.flatMap((part) =>
			Option.toArray(
				Option.flatMap(decodeJson(part.text ?? ""), Schema.decodeUnknownOption(BuildPayload)),
			),
		)
		.at(0);
	if (!payload) return yield* opsError("execute returned no accepted build");
	const pngUrl = payload.artifactDelivery?.pngUrl;
	if (!pngUrl) return yield* opsError("the artifact has no PNG");
	const client = yield* HttpClient.HttpClient;
	const { png, bytes } = yield* client.get(pngUrl).pipe(
		Effect.flatMap((png) =>
			png.arrayBuffer.pipe(Effect.map((buffer) => ({ png, bytes: new Uint8Array(buffer) }))),
		),
		Effect.timeout(MCP_TIMEOUT),
	);
	const signature = [0x89, 0x50, 0x4e, 0x47];
	if (png.status >= 300 || !signature.every((byte, index) => bytes[index] === byte)) {
		return yield* opsError(`the PNG URL answered HTTP ${png.status} without a PNG`);
	}
	return `flowchart artifact ${payload.artifactDelivery?.artifactId}, ${bytes.length} byte PNG`;
});

/**
 * Each check names the kind it expects and the labels the result must keep. The untyped prompt
 * names no kind and avoids every word the router reads as one.
 */
export const CHECKS = [
	{
		name: "typed-generate",
		run: (context: Context) =>
			generate(context, {
				prompt:
					"The browser sends the login form to the API, the API checks the password with the auth service, the auth service returns a session token, and the API sets the session cookie on the browser.",
				type: "sequence",
				expectedType: "sequence",
				labels: ["Browser", "API", "Auth"],
			}),
	},
	{
		name: "untyped-generate",
		run: (context: Context) =>
			generate(context, {
				prompt:
					"Who reports to whom at Northwind: Dana Lee is the CEO. Sam Ortiz, the CTO, and Priya Shah, the CFO, report to Dana. Lee Wong and Ana Ruiz are engineers who report to Sam.",
				expectedType: "org-chart",
				labels: ["Dana Lee", "Sam Ortiz", "Priya Shah", "Lee Wong", "Ana Ruiz"],
			}),
	},
	{ name: "mcp-execute", run: (context: Context) => mcpExecute(context) },
] as const;

const newRunId = Effect.gen(function* () {
	const now = yield* DateTime.now;
	const stamp = DateTime.formatIso(now).replace(/[-:]/g, "").replace(/\..*$/, "");
	let suffix = "";
	for (let index = 0; index < 6; index += 1) {
		suffix += (yield* Random.nextIntBetween(0, 16)).toString(16);
	}
	return `sanity_${stamp}_${suffix}`;
});

/** Runs the named checks (all when none are named) and returns the number that failed. */
export const runSanity = Effect.fn("ops.sanity")(function* (
	endpointInput: string,
	names: readonly string[],
) {
	if (!URL.canParse(endpointInput)) return yield* opsError(`Invalid endpoint: ${endpointInput}`);
	const endpoint = new URL(endpointInput).origin;
	const unknown = names.filter((name) => !CHECKS.some((check) => check.name === name));
	if (unknown.length > 0) {
		return yield* opsError(
			`Unknown check: ${unknown.join(", ")}. Checks: ${CHECKS.map((c) => c.name).join(", ")}`,
		);
	}
	const selected = CHECKS.filter((check) => names.length === 0 || names.includes(check.name));
	const runId = yield* newRunId;
	yield* Console.log(`Sketchi sanity against ${endpoint}, run ${runId}`);

	let failures = 0;
	for (const check of selected) {
		const started = yield* Clock.currentTimeMillis;
		const result = yield* check.run({ check: check.name, endpoint, runId }).pipe(Effect.result);
		const line =
			result._tag === "Success"
				? `PASS ${check.name}: ${result.success}`
				: `FAIL ${check.name}: ${result.failure.message}`;
		if (result._tag === "Failure") failures += 1;
		const elapsed = ((yield* Clock.currentTimeMillis) - started) / 1000;
		yield* Console.log(`${line} (${elapsed.toFixed(1)} s)`);
	}

	const preview = endpoint === DEFAULT_ENDPOINT ? "" : " --preview";
	yield* Console.log(`\n${selected.length - failures}/${selected.length} passed. In DuckDB:`);
	yield* Console.log(`  pnpm db${preview} -c "FROM generations WHERE run_id = '${runId}'"`);
	yield* Console.log(`  pnpm db${preview} -c "FROM usage_events WHERE run_id = '${runId}'"`);
	return failures;
});
