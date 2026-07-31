import { Context, Effect, Layer, Schema, Stream } from "effect";
import { Stdio } from "effect/Stdio";

import type { OutputFormat } from "./contracts.js";
import { encodeJson } from "./document.js";
import {
  type CliFailure,
  CliFilesystemError,
  exitCodeForFailure,
} from "./errors.js";
import { redactShareLinks } from "./redaction.js";

export class OutputWriter extends Context.Service<
  OutputWriter,
  {
    readonly stdout: (
      value: string | Uint8Array,
    ) => Effect.Effect<void, CliFilesystemError>;
    readonly stderr: (
      value: string | Uint8Array,
    ) => Effect.Effect<void, CliFilesystemError>;
  }
>()("@sketchi/cli/OutputWriter") {}

export class CliCommandExit extends Schema.TaggedErrorClass<CliCommandExit>()(
  "CliCommandExit",
  { exitCode: Schema.Number },
) {}

function outputFailure(cause: unknown) {
  return CliFilesystemError.make({
    cause,
    operation: "write-output",
    path: "standard stream",
    message: "Unable to write command output.",
  });
}

export const OutputWriterLive = Layer.effect(
  OutputWriter,
  Effect.gen(function* () {
    const stdio = yield* Stdio;
    return {
      stdout: (value) =>
        Stream.make(value).pipe(
          Stream.run(stdio.stdout()),
          Effect.mapError(outputFailure),
        ),
      stderr: (value) =>
        Stream.make(value).pipe(
          Stream.run(stdio.stderr()),
          Effect.mapError(outputFailure),
        ),
    };
  }),
);

interface ErrorView {
  readonly code: string;
  readonly message: string;
  readonly hint: string;
  readonly details?: ReadonlyArray<string>;
}

function failureView(error: CliFailure): ErrorView {
  switch (error._tag) {
    case "CliFilesystemError":
      return {
        code: "filesystem_error",
        message: error.message,
        hint: "Check local paths and permissions, then retry.",
      };
    case "CliInputError":
      return { code: error.code, message: error.message, hint: error.hint };
    case "CliValidationError":
      return {
        code: "invalid_document",
        message: error.message,
        hint: error.hint,
        details: error.details,
      };
    case "CliBuildError":
      return {
        code: "build_failed",
        message: error.message,
        hint: error.hint,
        details: error.details,
      };
    case "CliGenerationError":
      return {
        code: error.code,
        message: error.message,
        hint: error.hint,
        details: error.details,
      };
    case "CliInteractiveError":
      return { code: error.code, message: error.message, hint: error.hint };
    case "CliStorageError":
      return { code: error.code, message: error.message, hint: error.hint };
    case "CliExportError":
      return { code: error.code, message: error.message, hint: error.hint };
    case "CliShareError":
      return {
        code: error.code,
        message: error.message,
        hint: error.hint,
        details: error.details,
      };
  }
}

function textError(error: ErrorView): string {
  const details = error.details?.map((detail) => `  - ${detail}`).join("\n");
  return (
    [
      `error: ${error.code}`,
      error.message,
      `next: ${error.hint}`,
      ...(details ? ["details:", details] : []),
    ].join("\n") + "\n"
  );
}

export const reportFailure = Effect.fn("sketchi.cli.output.failure")(function* (
  command: string,
  format: OutputFormat,
  error: CliFailure,
) {
  const writer = yield* OutputWriter;
  const view = failureView(error);
  const rendered =
    format === "json"
      ? encodeJson({ ok: false, command, error: view })
      : textError(view);
  yield* writer.stderr(redactShareLinks(rendered));
  return yield* CliCommandExit.make({ exitCode: exitCodeForFailure(error) });
});

export const reportSuccess = Effect.fn("sketchi.cli.output.success")(function* (
  command: string,
  format: OutputFormat,
  data: unknown,
  text: string,
  destination: "stdout" | "stderr" = "stdout",
) {
  const writer = yield* OutputWriter;
  const rendered =
    format === "json" ? encodeJson({ ok: true, command, data }) : text;
  yield* writer[destination](
    rendered.endsWith("\n") ? rendered : `${rendered}\n`,
  );
});

export function runReported<A, E extends CliFailure, R>(
  command: string,
  format: OutputFormat,
  effect: Effect.Effect<A, E, R>,
  renderText: (value: A) => string,
  renderData: (value: A) => unknown = (value) => value,
): Effect.Effect<void, CliCommandExit | CliFilesystemError, R | OutputWriter> {
  return effect.pipe(
    Effect.matchEffect({
      onFailure: (error) => reportFailure(command, format, error),
      onSuccess: (value) =>
        reportSuccess(command, format, renderData(value), renderText(value)),
    }),
  );
}

export function internalErrorText(format: OutputFormat): string {
  const error = {
    code: "internal_error",
    message: "Sketchi could not complete the command.",
    hint: "Retry once; if it persists, report the command and inputs without secrets.",
  };
  return format === "json"
    ? encodeJson({ ok: false, command: "sketchi", error })
    : textError(error);
}
