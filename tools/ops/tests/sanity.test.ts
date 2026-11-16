// `ops sanity` against a fixture Studio whose server sends headers at once and then stalls the
// body. Each check's deadline must cover the body, so the command fails after the deadline
// instead of waiting on the body forever.
import { it } from "@effect/vitest";
import { Effect, Exit, Fiber } from "effect";
import { TestClock } from "effect/testing";
import { describe, expect } from "vitest";

import { command, type Recorded } from "./command";

const ENDPOINT = "https://studio.test";
const PNG = "https://artifacts.test/a.png";

/** Headers now, then a body that never ends. */
function stalled(contentType: string) {
	return new Response(new ReadableStream({ start() {} }), {
		status: 200,
		headers: { "content-type": contentType },
	});
}

const buildResult = {
	content: [
		{
			type: "text",
			text: JSON.stringify({ ok: true, artifactDelivery: { artifactId: "a1", pngUrl: PNG } }),
		},
	],
};

function studio(stall: "generate" | "mcp" | "png") {
	return command(async (request: Recorded) => {
		if (request.url === `${ENDPOINT}/api/v1/generate`) return stalled("application/json");
		if (request.url === `${ENDPOINT}/mcp`) {
			const { id, method } = JSON.parse(request.body) as { id: number; method: string };
			if (stall === "mcp" && method === "tools/call") return stalled("text/event-stream");
			return Response.json({
				jsonrpc: "2.0",
				id,
				result: method === "tools/call" ? buildResult : {},
			});
		}
		if (request.url === PNG) return stalled("image/png");
		return new Response("unexpected request", { status: 599 });
	});
}

describe("sanity deadlines", () => {
	for (const [stall, check, deadline] of [
		["generate", "typed-generate", "150 seconds"],
		["mcp", "mcp-execute", "90 seconds"],
		["png", "mcp-execute", "90 seconds"],
	] as const) {
		it.effect(`a ${stall} body that stalls after its headers fails the check at the deadline`, () =>
			Effect.gen(function* () {
				const server = studio(stall);
				const run = yield* Effect.forkChild(server.run(["sanity", "--endpoint", ENDPOINT, check]));
				yield* TestClock.adjust(deadline);
				yield* TestClock.adjust("1 second");
				// Let the timed-out check unwind and the command report.
				for (let turn = 0; turn < 50; turn += 1) yield* Effect.yieldNow;
				// The harness ends in Effect.exit, so a finished run holds the command's own exit.
				const finished = run.pollUnsafe();
				expect(finished, "the command is still waiting on the body").toBeDefined();
				if (!finished) yield* Fiber.interrupt(run);
				const command = finished && Exit.isSuccess(finished) ? finished.value : undefined;
				expect(command && Exit.isFailure(command)).toBe(true);
				// One failed check: `ops` exits 1.
				expect(String(command && Exit.isFailure(command) ? command.cause : "")).toMatch(/ExitCode/);
				expect(server.requests.at(-1)?.url).toBe(
					stall === "png"
						? PNG
						: stall === "mcp"
							? `${ENDPOINT}/mcp`
							: `${ENDPOINT}/api/v1/generate`,
				);
			}),
		);
	}
});
