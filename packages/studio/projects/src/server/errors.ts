import { Schema } from "effect";

const StudioResourceKind = Schema.Literals([
  "diagram",
  "owner-index",
  "project",
  "session",
  "source-artifact",
]);

export type StudioResourceKind = typeof StudioResourceKind.Type;

export class StudioNotFoundError extends Schema.TaggedError<StudioNotFoundError>()(
  "StudioNotFoundError",
  {
    id: Schema.String,
    resource: StudioResourceKind,
  },
) {}

export class StudioDecodeError extends Schema.TaggedError<StudioDecodeError>()(
  "StudioDecodeError",
  {
    cause: Schema.Defect(),
    key: Schema.String,
    message: Schema.String,
    operation: Schema.Literals(["decode", "encode"]),
  },
) {}

export class StudioSessionError extends Schema.TaggedError<StudioSessionError>()(
  "StudioSessionError",
  {
    cause: Schema.Defect(),
    message: Schema.String,
  },
) {}

export class StudioOwnershipError extends Schema.TaggedError<StudioOwnershipError>()(
  "StudioOwnershipError",
  {
    id: Schema.String,
    resource: StudioResourceKind,
  },
) {}

export class StudioStorageError extends Schema.TaggedError<StudioStorageError>()(
  "StudioStorageError",
  {
    cause: Schema.Defect(),
    message: Schema.String,
    operation: Schema.Literals(["delete", "get", "list", "put"]),
    target: Schema.String,
  },
) {}

export class StudioSourceArtifactError extends Schema.TaggedError<StudioSourceArtifactError>()(
  "StudioSourceArtifactError",
  {
    artifactId: Schema.String,
    cause: Schema.optionalKey(Schema.Defect()),
    code: Schema.String,
    message: Schema.String,
    status: Schema.Number,
  },
) {}

export class StudioInvalidInputError extends Schema.TaggedError<StudioInvalidInputError>()(
  "StudioInvalidInputError",
  {
    cause: Schema.optionalKey(Schema.Defect()),
    message: Schema.String,
  },
) {}

export type StudioPersistenceError =
  | StudioDecodeError
  | StudioNotFoundError
  | StudioOwnershipError
  | StudioStorageError;

export type StudioProjectsError =
  StudioPersistenceError | StudioSourceArtifactError;

export type StudioHttpError =
  StudioInvalidInputError | StudioProjectsError | StudioSessionError;

export function failureMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error ? cause.message : fallback;
}
