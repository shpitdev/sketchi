// Hand-run end-to-end sanity checks against a deployed Studio. Never run by CI:
// graded evals live in Frontierclimb.
//
//   pnpm sanity                                          production
//   pnpm sanity --endpoint https://pr-<N>-sketchi-studio.dimethyl.workers.dev
//   pnpm sanity untyped-generate                         one check
//
// Every request carries `x-sketchi-client: sketchi-sanity` and one `sanity_` run
// ID, printed at the end with the DuckDB queries that find it.
import { randomBytes } from "node:crypto";
import { parseArgs } from "node:util";

const DEFAULT_ENDPOINT = "https://playground.sketchi.app";
const CLIENT = "sketchi-sanity";
// Past the server's own generation budget, so a slow answer reads as the server's.
const GENERATE_TIMEOUT_MS = 150_000;
const MCP_TIMEOUT_MS = 90_000;

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

/**
 * Each check names the kind it expects and the labels the result must keep. The
 * untyped prompt names no kind and avoids every word the router reads as one.
 */
const CHECKS = [
	{
		name: "typed-generate",
		run: (context) =>
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
		run: (context) =>
			generate(context, {
				prompt:
					"Who reports to whom at Northwind: Dana Lee is the CEO. Sam Ortiz, the CTO, and Priya Shah, the CFO, report to Dana. Lee Wong and Ana Ruiz are engineers who report to Sam.",
				expectedType: "org-chart",
				labels: ["Dana Lee", "Sam Ortiz", "Priya Shah", "Lee Wong", "Ana Ruiz"],
			}),
	},
	{ name: "mcp-execute", run: (context) => mcpExecute(context) },
];

class CheckFailure extends Error {}

function fail(message) {
	throw new CheckFailure(message);
}

function newRunId() {
	const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..*$/, "");
	return `sanity_${stamp}_${randomBytes(3).toString("hex")}`;
}

function headers(context, check) {
	return {
		"x-sketchi-client": CLIENT,
		"x-sketchi-run-id": context.runId,
		"x-sketchi-trace-id": `${context.runId}_${check}`.slice(0, 64),
	};
}

async function readJson(response) {
	const text = await response.text();
	try {
		return JSON.parse(text);
	} catch {
		fail(`HTTP ${response.status}, not JSON: ${text.slice(0, 200)}`);
	}
}

async function generate(context, { prompt, type, expectedType, labels }) {
	const response = await fetch(new URL("/api/v1/generate", context.endpoint), {
		method: "POST",
		headers: { "content-type": "application/json", ...headers(context, context.check) },
		body: JSON.stringify({ prompt, ...(type ? { type } : {}) }),
		signal: AbortSignal.timeout(GENERATE_TIMEOUT_MS),
	});
	const body = await readJson(response);
	if (!response.ok || body.ok === false) {
		const issue = body.issues?.[0];
		fail(`HTTP ${response.status}${issue ? `: ${issue.code}: ${issue.message}` : ""}`);
	}
	const document = body.diagram?.document;
	if (document?.type !== expectedType) {
		fail(`expected a ${expectedType}, got ${document?.type ?? "no diagram"}`);
	}
	const elements = body.diagram?.excalidraw?.elements;
	if (!Array.isArray(elements) || elements.length === 0) fail("the scene has no elements");
	const spec = JSON.stringify(document.spec).toLowerCase();
	const missing = labels.filter((label) => !spec.includes(label.toLowerCase()));
	if (missing.length > 0) fail(`a ${expectedType} without ${missing.join(", ")}`);
	const { model, attempts, usage } = body.generation ?? {};
	const tokens = usage ? `${usage.inputTokens ?? "?"} in / ${usage.outputTokens} out` : "no usage";
	return `${expectedType}, ${model}, ${attempts ?? 1} attempt(s), ${tokens}`;
}

/** The JSON-RPC messages of a Streamable HTTP answer, plain JSON or server-sent events. */
function rpcMessages(contentType, text) {
	if (!contentType.includes("text/event-stream")) return [JSON.parse(text)];
	return text
		.split("\n")
		.filter((line) => line.startsWith("data:"))
		.map((line) => line.slice("data:".length).trim())
		.filter((data) => data.startsWith("{"))
		.map((data) => JSON.parse(data));
}

async function mcpCall(context, id, method, params) {
	const response = await fetch(new URL("/mcp", context.endpoint), {
		method: "POST",
		headers: {
			accept: "application/json, text/event-stream",
			"content-type": "application/json",
			...headers(context, context.check),
		},
		body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
		signal: AbortSignal.timeout(MCP_TIMEOUT_MS),
	});
	const text = await response.text();
	if (!response.ok) fail(`${method}: HTTP ${response.status}: ${text.slice(0, 200)}`);
	const message = rpcMessages(response.headers.get("content-type") ?? "", text).find(
		(entry) => entry.id === id,
	);
	if (!message) fail(`${method}: no answer to request ${id}`);
	if (message.error) fail(`${method}: ${message.error.message}`);
	return message.result;
}

async function mcpExecute(context) {
	await mcpCall(context, 1, "initialize", {
		protocolVersion: "2025-06-18",
		capabilities: {},
		clientInfo: { name: CLIENT, version: "1" },
	});
	const result = await mcpCall(context, 2, "tools/call", {
		name: "execute",
		arguments: { code: EXECUTE_CODE },
	});
	const texts = (result?.content ?? []).filter((part) => part.type === "text");
	if (result?.isError) fail(`execute failed: ${texts[0]?.text?.slice(0, 300) ?? "no message"}`);
	const payload = texts
		.map((part) => {
			try {
				return JSON.parse(part.text);
			} catch {
				return undefined;
			}
		})
		.find((value) => value && typeof value === "object");
	if (payload?.ok !== true) fail("execute returned no accepted build");
	const pngUrl = payload.artifactDelivery?.pngUrl;
	if (!pngUrl) fail("the artifact has no PNG");
	const png = await fetch(pngUrl, { signal: AbortSignal.timeout(MCP_TIMEOUT_MS) });
	const bytes = new Uint8Array(await png.arrayBuffer());
	const signature = [0x89, 0x50, 0x4e, 0x47];
	if (!png.ok || !signature.every((byte, index) => bytes[index] === byte)) {
		fail(`the PNG URL answered HTTP ${png.status} without a PNG`);
	}
	return `flowchart artifact ${payload.artifactDelivery.artifactId}, ${bytes.length} byte PNG`;
}

async function main() {
	const { values, positionals } = parseArgs({
		allowPositionals: true,
		options: { endpoint: { type: "string", default: DEFAULT_ENDPOINT } },
	});
	const endpoint = new URL(values.endpoint).origin;
	const unknown = positionals.filter((name) => !CHECKS.some((check) => check.name === name));
	if (unknown.length > 0) {
		console.error(
			`Unknown check: ${unknown.join(", ")}. Checks: ${CHECKS.map((c) => c.name).join(", ")}`,
		);
		process.exit(2);
	}
	const selected = CHECKS.filter(
		(check) => positionals.length === 0 || positionals.includes(check.name),
	);
	const runId = newRunId();
	console.log(`Sketchi sanity against ${endpoint}, run ${runId}`);

	let failures = 0;
	for (const check of selected) {
		const started = performance.now();
		const context = { check: check.name, endpoint, runId };
		let line;
		try {
			line = `PASS ${check.name}: ${await check.run(context)}`;
		} catch (error) {
			failures += 1;
			line = `FAIL ${check.name}: ${error instanceof CheckFailure ? error.message : String(error)}`;
		}
		console.log(`${line} (${((performance.now() - started) / 1000).toFixed(1)} s)`);
	}

	const preview = endpoint === DEFAULT_ENDPOINT ? "" : " --preview";
	console.log(`\n${selected.length - failures}/${selected.length} passed. In DuckDB:`);
	console.log(`  pnpm db${preview} -c "FROM generations WHERE run_id = '${runId}'"`);
	console.log(`  pnpm db${preview} -c "FROM usage_events WHERE run_id = '${runId}'"`);
	process.exit(failures > 0 ? 1 : 0);
}

await main();
