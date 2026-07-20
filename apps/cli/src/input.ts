import { Context, Effect, Layer, Stream } from "effect";
import { Stdio } from "effect/Stdio";

import { parseJsonDocument } from "./document.js";
import { CliInputError } from "./errors.js";
import { LocalFileSystem } from "./filesystem.js";
import type { InputSource } from "./internal/effect-unstable-cli.js";

export class InputReader extends Context.Service<
  InputReader,
  {
    readonly read: (
      source: InputSource,
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
            message: "--file - requires piped or redirected stdin.",
            hint: "Pipe one JSON document, or use --file PATH / --json VALUE.",
          });
        }
        const chunks = yield* Stream.runCollect(stdio.stdin).pipe(
          Effect.mapError(() =>
            CliInputError.make({
              code: "input_read_failed",
              message: "Unable to read JSON from stdin.",
              hint: "Pipe one complete UTF-8 JSON document and retry.",
            }),
          ),
        );
        return yield* decodeUtf8(concatenate(chunks), "stdin");
      });

      return { read };
    }),
  );
}

export const InputReaderLive = makeInputReaderLayer();

export const readDocumentInput = Effect.fn("sketchi.cli.input.readDocument")(
  function* (source: InputSource) {
    const reader = yield* InputReader;
    const text = yield* reader.read(source);
    return yield* parseJsonDocument(text);
  },
);
