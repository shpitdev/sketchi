// Runs `ops` commands in process through the real effect/cli parser, with an isolated environment
// and every HTTP request answered by a fixture instead of the network.
// @effect-diagnostics-next-line nodeBuiltinImport:off -- The command test adapter provides raw Node filesystem and path fixtures for subprocess checks.
import { existsSync, readFileSync } from "node:fs";
// @effect-diagnostics-next-line nodeBuiltinImport:off -- The command test adapter provides raw Node filesystem and path fixtures for subprocess checks.
import { join } from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { ConfigProvider, Effect, Exit, Layer } from "effect";
import { Command } from "effect/cli";
import { FetchHttpClient } from "effect/http";

import { ops } from "../src/commands";
import { scratch } from "./harness";

export interface Recorded {
	readonly method: string;
	readonly url: string;
	readonly authorization: string | null;
	readonly body: string;
}

export type Handler = (request: Recorded) => Response | Promise<Response>;

export function command(
	handler: Handler = () => new Response("unexpected request", { status: 599 }),
) {
	const requests: Recorded[] = [];
	const outputFile = join(scratch("ops-command-"), "github-output");
	const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const request = new Request(input, init);
		const recorded = {
			method: request.method,
			url: request.url,
			authorization: request.headers.get("authorization"),
			body: await request.text(),
		};
		requests.push(recorded);
		return handler(recorded);
	}) as typeof globalThis.fetch;
	return {
		requests,
		/** `key=value` lines the command wrote to GITHUB_OUTPUT. */
		outputs: () =>
			existsSync(outputFile)
				? Object.fromEntries(
						readFileSync(outputFile, "utf8")
							.split("\n")
							.filter(Boolean)
							.map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
					)
				: {},
		run: (args: readonly string[], env: Record<string, string> = {}) =>
			Command.runWith(ops, { version: "0.0.0" })(args).pipe(
				Effect.provideService(FetchHttpClient.Fetch, fetch),
				// @effect-diagnostics-next-line strictEffectProvide:off -- This command harness owns the isolated Node and fixture layers for the test invocation.
				Effect.provide(
					Layer.mergeAll(
						NodeServices.layer,
						FetchHttpClient.layer,
						ConfigProvider.layer(
							ConfigProvider.fromEnvRecord({ GITHUB_OUTPUT: outputFile, ...env }),
						),
					),
				),
				Effect.exit,
			),
	};
}

/** The failure message of an exit, or undefined when it succeeded. */
export function failure(exit: Exit.Exit<unknown, unknown>) {
	if (Exit.isSuccess(exit)) return undefined;
	const error = exit.cause.reasons.find((reason) => reason._tag === "Fail");
	return error && error._tag === "Fail"
		? String((error.error as { message?: string }).message)
		: String(exit.cause);
}
