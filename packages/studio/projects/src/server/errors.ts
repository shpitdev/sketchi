import { Schema } from "effect";

const StudioResourceKind = Schema.Literals([
  "diagram",
  "owner-index",
  "project",
  "session",
  "source-artifact",
]);

export type StudioResourceKind = typeof StudioResourceKind.Type;

export class StudioNotFoundError extends Schema.TaggedErrorClass<StudioNotFoundError>()(
  "StudioNotFoundError",
  {
    id: Schema.String,
    resource: StudioResourceKind,
  },
) {}

export class StudioDecodeError extends Schema.TaggedErrorClass<StudioDecodeError>()(
  "StudioDecodeError",
  {
    cause: Schema.Defect(),
    key: Schema.String,
    message: Schema.String,
    operation: Schema.Literals(["decode", "encode"]),
  },
) {}

export class StudioSessionError extends Schema.TaggedErrorClass<StudioSessionError>()(
  "StudioSessionError",
  {
    cause: Schema.Defect(),
    message: Schema.String,
  },
) {}

export class StudioOwnershipError extends Schema.TaggedErrorClass<StudioOwnershipError>()(
  "StudioOwnershipError",
  {
    id: Schema.String,
    resource: StudioResourceKind,
  },
) {}

export class StudioStorageError extends Schema.TaggedErrorClass<StudioStorageError>()(
  "StudioStorageError",
  {
    cause: Schema.Defect(),
    message: Schema.String,
    operation: Schema.Literals(["delete", "get", "list", "put"]),
    target: Schema.String,
  },
) {}

export class StudioSourceArtifactError extends Schema.TaggedErrorClass<StudioSourceArtifactError>()(
  "StudioSourceArtifactError",
  {
    artifactId: Schema.String,
    cause: Schema.optionalKey(Schema.Defect()),
    code: Schema.String,
    message: Schema.String,
    status: Schema.Number,
  },
) {}

export class StudioInvalidInputError extends Schema.TaggedErrorClass<StudioInvalidInputError>()(
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
  | StudioPersistenceError
  | StudioSourceArtifactError;

export type StudioHttpError =
  | StudioInvalidInputError
  | StudioProjectsError
  | StudioSessionError;

export function failureMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error ? cause.message : fallback;
}
