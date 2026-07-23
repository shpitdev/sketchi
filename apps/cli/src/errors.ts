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

export class CliGenerationError extends Schema.TaggedErrorClass<CliGenerationError>()(
  "CliGenerationError",
  {
    code: Schema.Literals([
      "provider_failure",
      "generation_timeout",
      "malformed_output",
      "invalid_generated_document",
    ]),
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
      "detached_edit",
      "patch_source_unavailable",
      "patch_conflict",
      "replacement_conflict",
      "restore_conflict",
      "revision_not_found",
      "corrupt_revision",
      "corrupt_record",
      "unsafe_storage_entry",
      "storage_commit_failed",
    ]),
    diagramId: Schema.optionalKey(Schema.String),
    message: Schema.String,
    hint: Schema.String,
  },
) {}

export class CliShareError extends Schema.TaggedErrorClass<CliShareError>()(
  "CliShareError",
  {
    code: Schema.Literals([
      "invalid_share_link",
      "unsupported_scene",
      "share_payload_too_large",
      "share_crypto_failed",
      "share_transport_failed",
      "share_timeout",
      "share_api_changed",
      "share_link_unavailable",
    ]),
    message: Schema.String,
    hint: Schema.String,
    details: Schema.Array(Schema.String),
  },
) {}

export class CliExportError extends Schema.TaggedErrorClass<CliExportError>()(
  "CliExportError",
  {
    code: Schema.Literals([
      "format_unavailable",
      "invalid_destination",
      "render_failed",
      "export_write_failed",
    ]),
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
  | CliGenerationError
  | CliStorageError
  | CliExportError
  | CliShareError;

export function exitCodeForFailure(error: CliFailure): number {
  switch (error._tag) {
    case "CliInputError":
      return error.code === "interactive_stdin" ? 2 : 3;
    case "CliValidationError":
      return 3;
    case "CliBuildError":
      return 4;
    case "CliGenerationError":
      switch (error.code) {
        case "invalid_generated_document":
          return 3;
        case "provider_failure":
          return 10;
        case "generation_timeout":
          return 11;
        case "malformed_output":
          return 12;
      }
    case "CliStorageError":
      if (error.code === "diagram_not_found") return 5;
      if (error.code === "revision_not_found") return 5;
      if (
        error.code === "diagram_already_exists" ||
        error.code === "diagram_busy" ||
        error.code === "detached_edit" ||
        error.code === "patch_conflict" ||
        error.code === "replacement_conflict" ||
        error.code === "restore_conflict"
      ) {
        return 6;
      }
      return 7;
    case "CliFilesystemError":
      return 7;
    case "CliExportError":
      return 8;
    case "CliShareError":
      return error.code === "share_transport_failed" ||
        error.code === "share_timeout" ||
        error.code === "share_api_changed" ||
        error.code === "share_link_unavailable"
        ? 13
        : 3;
  }
}
