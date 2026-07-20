import { assert, describe, it } from "@effect/vitest";
import { Cause, Effect, Exit, Layer, Option } from "effect";

import {
  CliBuildError,
  CliExportError,
  CliFilesystemError,
  CliInputError,
  CliStorageError,
  CliValidationError,
  exitCodeForFailure,
} from "./errors.js";
import {
  CliCommandExit,
  OutputWriter,
  internalErrorText,
  reportFailure,
  reportSuccess,
} from "./output.js";

function captureLayer(stdout: Array<string>, stderr: Array<string>) {
  return Layer.succeed(OutputWriter, {
    stdout: (value) => Effect.sync(() => stdout.push(String(value))),
    stderr: (value) => Effect.sync(() => stderr.push(String(value))),
  });
}

describe("output envelopes and exits", () => {
  it.effect("renders stable JSON success envelopes", () =>
    Effect.gen(function* () {
      const stdout: string[] = [];
      yield* reportSuccess("list", "json", [{ id: "a" }], "unused").pipe(
        Effect.provide(captureLayer(stdout, [])),
      );

      assert.deepStrictEqual(JSON.parse(stdout.join("")), {
        ok: true,
        command: "list",
        data: [{ id: "a" }],
      });
    }),
  );

  it.effect("renders typed text errors without causes or stacks", () =>
    Effect.gen(function* () {
      const stderr: string[] = [];
      const failure = CliFilesystemError.make({
        cause: new Error("secret cause"),
        operation: "read",
        path: "/private/path",
        message: "Filesystem read failed.",
      });
      const exit = yield* Effect.exit(
        reportFailure("show", "text", failure).pipe(
          Effect.provide(captureLayer([], stderr)),
        ),
      );

      assert.isTrue(Exit.isFailure(exit));
      const exitError = Exit.isFailure(exit)
        ? Option.getOrUndefined(Cause.findErrorOption(exit.cause))
        : undefined;
      assert.instanceOf(exitError, CliCommandExit);
      assert.strictEqual(
        stderr.join(""),
        "error: filesystem_error\nFilesystem read failed.\nnext: Check local paths and permissions, then retry.\n",
      );
      assert.notInclude(stderr.join(""), "secret cause");
      assert.notInclude(stderr.join(""), "/private/path");
      assert.notInclude(stderr.join(""), " at ");
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
    ];

    assert.deepStrictEqual(
      failures.map(exitCodeForFailure),
      [2, 3, 3, 4, 5, 6, 7, 8],
    );
  });

  it("renders deterministic internal error envelopes", () => {
    const first = internalErrorText("json");
    assert.strictEqual(first, internalErrorText("json"));
    assert.notInclude(first, "stack");
    assert.strictEqual(JSON.parse(first).error.code, "internal_error");
  });
});
