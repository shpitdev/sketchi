import { decodeFlowchartEdits, type FlowchartEdit } from "@sketchi/diagram-agent";
import { Context, Effect, Layer, Result, Stream } from "effect";
import { Stdio } from "effect/Stdio";

import {
	type CanonicalDiagramDocument,
	decodeCanonicalDiagramDocument,
	parseJsonDocument,
} from "./document.js";
import { CliInputError, CliValidationError } from "./errors.js";
import { LocalFileSystem } from "./filesystem.js";
import type { InputSource } from "./internal/effect-cli.js";
import { parseJsonPatchInput } from "./patch.js";

export interface InputReadOptions {
	readonly maxBytes?: number;
	readonly content: "CanvasSpec document" | "JSON document" | "patch request" | "share link";
}

export class InputReader extends Context.Service<
	InputReader,
	{
		readonly read: (
			source: InputSource,
			options?: InputReadOptions,
		) => Effect.Effect<string, CliInputError>;
	}
>()("@sketchi/cli/InputReader") {}

function concatenate(chunks: ReadonlyArray<Uint8Array>): Uint8Array {
	const size = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
	const output = new Uint8Array(size);
	let offset = 0;
	for (const chunk of chunks) {
		output.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return output;
}

function decodeUtf8(
	bytes: Uint8Array,
	source: "file" | "stdin",
): Effect.Effect<string, CliInputError> {
	return Effect.try({
		try: () => new TextDecoder("utf-8", { fatal: true }).decode(bytes),
		catch: () =>
			CliInputError.make({
				code: "input_read_failed",
				message:
					source === "stdin"
						? "Standard input is not valid UTF-8."
						: "The input file is not valid UTF-8.",
				hint: "Provide one complete UTF-8 JSON document and retry.",
			}),
	});
}

export function makeInputReaderLayer(
	stdinIsTTY: () => boolean = () => process.stdin.isTTY === true,
) {
	return Layer.effect(
		InputReader,
		Effect.gen(function* () {
			const fs = yield* LocalFileSystem;
			const stdio = yield* Stdio;

			const read = Effect.fn("sketchi.cli.input.read")(function* (
				source: InputSource,
				options: InputReadOptions = { content: "JSON document" },
			) {
				if (source._tag === "InlineJson") return source.value;
				if (source.path !== "-") {
					const bytes = yield* fs.readBytes(source.path).pipe(
						Effect.mapError(() =>
							CliInputError.make({
								code: "input_read_failed",
								message: `Unable to read input file ${source.path}.`,
								hint: "Check the path and file permissions, then retry.",
							}),
						),
					);
					return yield* decodeUtf8(bytes, "file");
				}
				if (stdinIsTTY()) {
					return yield* CliInputError.make({
						code: "interactive_stdin",
						message: `${options.content} input requires piped or redirected stdin.`,
						hint:
							options.content === "share link"
								? "Pipe one complete Excalidraw share link to --link -."
								: "Pipe one JSON document, or use --file PATH / --json VALUE.",
					});
				}
				const chunks = yield* Stream.runFoldEffect(
					stdio.stdin,
					() => ({
						chunks: [] as ReadonlyArray<Uint8Array>,
						size: 0,
					}),
					(collected, chunk) => {
						const size = chunk.byteLength + collected.size;
						if (options.maxBytes !== undefined && size > options.maxBytes) {
							return Effect.fail(
								CliInputError.make({
									code: "input_read_failed",
									message: `Standard input exceeds the ${String(options.maxBytes)} byte limit for a ${options.content}.`,
									hint: `Pipe one complete ${options.content} within the documented limit.`,
								}),
							);
						}
						return Effect.succeed({
							chunks: [...collected.chunks, chunk],
							size,
						});
					},
				).pipe(
					Effect.mapError((error) =>
						error instanceof CliInputError
							? error
							: CliInputError.make({
									code: "input_read_failed",
									message: `Unable to read the ${options.content} from stdin.`,
									hint: `Pipe one complete UTF-8 ${options.content} and retry.`,
								}),
					),
				);
				return yield* decodeUtf8(concatenate(chunks.chunks), "stdin");
			});

			return { read };
		}),
	);
}

export const InputReaderLive = makeInputReaderLayer();

export const readDocumentInput = Effect.fn("sketchi.cli.input.readDocument")(function* (
	source: InputSource,
) {
	const reader = yield* InputReader;
	const text = yield* reader.read(source);
	return yield* parseJsonDocument(text);
});

/** What edit takes: a whole document that replaces the record, or edits to a flowchart's. */
export type EditInput =
	| { readonly _tag: "Document"; readonly document: CanonicalDiagramDocument }
	| { readonly _tag: "Edits"; readonly edits: readonly FlowchartEdit[] };

export const readEditInput = Effect.fn("sketchi.cli.input.readEdit")(function* (
	source: InputSource,
) {
	const reader = yield* InputReader;
	const text = yield* reader.read(source);
	const input: unknown = yield* Effect.try({
		try: () => JSON.parse(text),
		catch: () =>
			CliInputError.make({
				code: "invalid_json",
				message: "The input is not valid JSON.",
				hint: 'Pass one complete canonical document object, or {"edits":[...]} for a flowchart.',
			}),
	});
	if (
		input === null ||
		typeof input !== "object" ||
		Array.isArray(input) ||
		!("edits" in input) ||
		"type" in input
	) {
		const whole: EditInput = {
			_tag: "Document",
			document: yield* decodeCanonicalDiagramDocument(input),
		};
		return whole;
	}
	const decoded = decodeFlowchartEdits(input.edits);
	if (Result.isFailure(decoded)) {
		return yield* CliValidationError.make({
			message: "The flowchart edits are invalid.",
			hint: 'Pass {"edits":[{ "op": "insert" | "set" | "connect" | "disconnect", ... }]}.',
			details: [String(decoded.failure)],
		});
	}
	const edits: EditInput = { _tag: "Edits", edits: decoded.success };
	return edits;
});

export const readPatchInput = Effect.fn("sketchi.cli.input.readPatch")(function* (
	source: InputSource,
) {
	const reader = yield* InputReader;
	const text = yield* reader.read(source, { content: "patch request" });
	return yield* parseJsonPatchInput(text);
});
