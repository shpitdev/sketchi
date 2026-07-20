import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer, Stream } from "effect";
import * as Stdio from "effect/Stdio";

import { LocalFileSystemLive } from "./filesystem.js";
import { InputReader, makeInputReaderLayer } from "./input.js";

function inputLayer(stdin: Stream.Stream<Uint8Array>, tty: boolean) {
  const dependencies = Layer.mergeAll(
    LocalFileSystemLive,
    Stdio.layerTest({ stdin }),
  );
  return makeInputReaderLayer(() => tty).pipe(Layer.provide(dependencies));
}

describe("input reader", () => {
  it.effect(
    "rejects interactive --file - promptly with usage input failure",
    () =>
      Effect.gen(function* () {
        const program = Effect.gen(function* () {
          const reader = yield* InputReader;
          return yield* Effect.flip(reader.read({ _tag: "File", path: "-" }));
        });
        const error = yield* program.pipe(
          Effect.provide(inputLayer(Stream.never, true)),
        );

        assert.strictEqual(error.code, "interactive_stdin");
      }),
  );

  it.effect("collects noninteractive UTF-8 stdin", () =>
    Effect.gen(function* () {
      const bytes = new TextEncoder().encode('{"type":"mindmap"}');
      const program = Effect.gen(function* () {
        const reader = yield* InputReader;
        return yield* reader.read({ _tag: "File", path: "-" });
      });
      const value = yield* program.pipe(
        Effect.provide(
          inputLayer(Stream.make(bytes.slice(0, 7), bytes.slice(7)), false),
        ),
      );

      assert.strictEqual(value, '{"type":"mindmap"}');
    }),
  );

  it.effect("reports invalid UTF-8 through the typed input channel", () =>
    Effect.gen(function* () {
      const program = Effect.gen(function* () {
        const reader = yield* InputReader;
        return yield* Effect.flip(reader.read({ _tag: "File", path: "-" }));
      });
      const error = yield* program.pipe(
        Effect.provide(inputLayer(Stream.make(new Uint8Array([0xff])), false)),
      );

      assert.strictEqual(error._tag, "CliInputError");
      assert.strictEqual(error.code, "input_read_failed");
    }),
  );

  it.effect(
    "maps local file read failures without leaking filesystem causes",
    () =>
      Effect.gen(function* () {
        const program = Effect.gen(function* () {
          const reader = yield* InputReader;
          return yield* Effect.flip(
            reader.read({
              _tag: "File",
              path: ".memory/missing-cli-input.json",
            }),
          );
        });
        const error = yield* program.pipe(
          Effect.provide(inputLayer(Stream.empty, false)),
        );

        assert.strictEqual(error.code, "input_read_failed");
        assert.notInclude(error.message, "ENOENT");
      }),
  );
});
