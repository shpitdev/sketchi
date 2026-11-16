import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer } from "effect";

import {
	CliBuildError,
	CliExportError,
	CliFilesystemError,
	CliGenerationError,
	CliInputError,
	CliShareError,
	CliStorageError,
	CliValidationError,
	exitCodeForFailure,
} from "../src/errors.js";
import { OutputWriter, reportFailure, reportSuccess } from "../src/output.js";

function captureLayer(stdout: Array<string>, stderr: Array<string>) {
	return Layer.succeed(OutputWriter, {
		stdout: (value) => Effect.sync(() => stdout.push(String(value))),
		stderr: (value) => Effect.sync(() => stderr.push(String(value))),
	});
}

describe("output envelopes and exits", () => {
	it.effect("keeps generation success and failure envelopes golden", () =>
		Effect.gen(function* () {
			const stdout: string[] = [];
			const stderr: string[] = [];
			const providerFailure = CliGenerationError.make({
				code: "provider_failure",
				message: "The Sketchi generate API could not be reached.",
				hint: "Check your network connection and retry. create/show/edit/list/export/restore remain offline; share and pull are separate explicit network commands.",
				details: ["transport"],
			});
			yield* reportSuccess(
				"generate",
				"json",
				{
					id: "generated-release-flow",
					type: "flowchart",
					revision: 1,
					formats: ["scene", "excalidraw"],
					generation: {
						model: "claude-haiku-5-5",
						provider: "cloudflare-anthropic",
					},
					export: {
						format: "png",
						destination: "generated-release-flow.png",
						sizeBytes: 1234,
						hint: "display the generated PNG",
					},
				},
				"unused",
			).pipe(Effect.provide(captureLayer(stdout, stderr)));
			yield* Effect.exit(
				reportFailure("generate", "json", providerFailure).pipe(
					Effect.provide(captureLayer(stdout, stderr)),
				),
			);

			assert.strictEqual(exitCodeForFailure(providerFailure), 10);

			assert.deepStrictEqual(JSON.parse(stdout.join("")), {
				ok: true,
				command: "generate",
				data: {
					id: "generated-release-flow",
					type: "flowchart",
					revision: 1,
					formats: ["scene", "excalidraw"],
					generation: { model: "claude-haiku-5-5", provider: "cloudflare-anthropic" },
					export: {
						format: "png",
						destination: "generated-release-flow.png",
						sizeBytes: 1234,
						hint: "display the generated PNG",
					},
				},
			});
			assert.deepStrictEqual(JSON.parse(stderr.join("")), {
				ok: false,
				command: "generate",
				error: {
					code: "provider_failure",
					message: providerFailure.message,
					hint: providerFailure.hint,
					details: ["transport"],
				},
			});
		}),
	);

	it("keeps the documented exit mapping stable", () => {
		const failures = [
			CliInputError.make({
				code: "interactive_stdin",
				message: "m",
				hint: "h",
			}),
			CliInputError.make({ code: "invalid_json", message: "m", hint: "h" }),
			CliValidationError.make({ message: "m", hint: "h", details: [] }),
			CliBuildError.make({
				status: "failed",
				message: "m",
				hint: "h",
				details: [],
			}),
			CliStorageError.make({
				code: "diagram_not_found",
				message: "m",
				hint: "h",
			}),
			CliStorageError.make({
				code: "diagram_already_exists",
				message: "m",
				hint: "h",
			}),
			CliFilesystemError.make({
				cause: null,
				operation: "read",
				path: "p",
				message: "m",
			}),
			CliExportError.make({
				code: "format_unavailable",
				format: "png",
				message: "m",
				hint: "h",
			}),
			CliGenerationError.make({
				code: "invalid_generated_document",
				message: "m",
				hint: "h",
				details: [],
			}),
			CliShareError.make({
				code: "invalid_share_link",
				message: "m",
				hint: "h",
				details: [],
			}),
			CliShareError.make({
				code: "share_transport_failed",
				message: "m",
				hint: "h",
				details: [],
			}),
			CliGenerationError.make({
				code: "provider_failure",
				message: "m",
				hint: "h",
				details: [],
			}),
			CliGenerationError.make({
				code: "generation_timeout",
				message: "m",
				hint: "h",
				details: [],
			}),
			CliGenerationError.make({
				code: "malformed_output",
				message: "m",
				hint: "h",
				details: [],
			}),
		];

		assert.deepStrictEqual(
			failures.map(exitCodeForFailure),
			[2, 3, 3, 4, 5, 6, 7, 8, 3, 3, 13, 10, 11, 12],
		);
	});
});
