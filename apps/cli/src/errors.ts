import { Schema } from "effect";

export class CliFilesystemError extends Schema.TaggedErrorClass<CliFilesystemError>()(
  "CliFilesystemError",
  {
    cause: Schema.Defect(),
    operation: Schema.String,
    path: Schema.String,
    message: Schema.String,
  },
) {}

export class CliInputError extends Schema.TaggedErrorClass<CliInputError>()(
  "CliInputError",
  {
    code: Schema.Literals([
      "input_read_failed",
      "invalid_json",
      "interactive_stdin",
    ]),
    message: Schema.String,
    hint: Schema.String,
  },
) {}

export class CliValidationError extends Schema.TaggedErrorClass<CliValidationError>()(
  "CliValidationError",
  {
    message: Schema.String,
    hint: Schema.String,
    details: Schema.Array(Schema.String),
  },
) {}

export class CliBuildError extends Schema.TaggedErrorClass<CliBuildError>()(
  "CliBuildError",
  {
    status: Schema.String,
    message: Schema.String,
    hint: Schema.String,
    details: Schema.Array(Schema.String),
  },
) {}

export class CliStorageError extends Schema.TaggedErrorClass<CliStorageError>()(
  "CliStorageError",
  {
    code: Schema.Literals([
      "diagram_not_found",
      "diagram_already_exists",
      "diagram_busy",
      "corrupt_record",
      "unsafe_storage_entry",
      "storage_commit_failed",
    ]),
    diagramId: Schema.optionalKey(Schema.String),
    message: Schema.String,
    hint: Schema.String,
  },
) {}

export class CliExportError extends Schema.TaggedErrorClass<CliExportError>()(
  "CliExportError",
  {
    code: Schema.Literals(["format_unavailable", "export_write_failed"]),
    format: Schema.String,
    message: Schema.String,
    hint: Schema.String,
  },
) {}

export type CliFailure =
  | CliFilesystemError
  | CliInputError
  | CliValidationError
  | CliBuildError
  | CliStorageError
  | CliExportError;

export function exitCodeForFailure(error: CliFailure): number {
  switch (error._tag) {
    case "CliInputError":
      return error.code === "interactive_stdin" ? 2 : 3;
    case "CliValidationError":
      return 3;
    case "CliBuildError":
      return 4;
    case "CliStorageError":
      if (error.code === "diagram_not_found") return 5;
      if (
        error.code === "diagram_already_exists" ||
        error.code === "diagram_busy"
      ) {
        return 6;
      }
      return 7;
    case "CliFilesystemError":
      return 7;
    case "CliExportError":
      return 8;
  }
}
