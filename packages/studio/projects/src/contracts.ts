import { Schema } from "effect";

const NonEmptyString = Schema.NonEmptyString;

export const StudioRecordIdSchema = Schema.String.check(
  Schema.isPattern(/^[a-z0-9_-]{6,80}$/i),
).pipe(Schema.brand("StudioRecordId"));
export type StudioRecordId = typeof StudioRecordIdSchema.Type;

export function makeStudioRecordId(input: string): StudioRecordId {
  return Schema.decodeUnknownSync(StudioRecordIdSchema)(input);
}

export const IsoDateStringSchema = NonEmptyString.pipe(
  Schema.brand("IsoDateString"),
);
export type IsoDateString = typeof IsoDateStringSchema.Type;

export function makeIsoDateString(input: string): IsoDateString {
  return Schema.decodeUnknownSync(IsoDateStringSchema)(input);
}

export class AnonymousStudioOwner extends Schema.Class<AnonymousStudioOwner>(
  "AnonymousStudioOwner",
)({
  kind: Schema.Literal("anonymous"),
  sessionId: StudioRecordIdSchema,
}) {}

export class AuthenticatedStudioOwner extends Schema.Class<AuthenticatedStudioOwner>(
  "AuthenticatedStudioOwner",
)({
  displayName: Schema.optional(NonEmptyString),
  kind: Schema.Literal("authenticated"),
  subjectId: NonEmptyString,
}) {}

export const StudioOwnerSchema = Schema.Union([
  AnonymousStudioOwner,
  AuthenticatedStudioOwner,
]);
export type StudioOwner = typeof StudioOwnerSchema.Type;

export class StudioProjectSource extends Schema.Class<StudioProjectSource>(
  "StudioProjectSource",
)({
  artifactId: NonEmptyString,
  kind: Schema.Literal("playground-artifact"),
}) {}
export const StudioProjectSourceSchema = StudioProjectSource;

export class StudioProjectRecord extends Schema.Class<StudioProjectRecord>(
  "StudioProjectRecord",
)({
  createdAt: IsoDateStringSchema,
  diagramIds: Schema.Array(StudioRecordIdSchema).pipe(Schema.mutable),
  id: StudioRecordIdSchema,
  owner: StudioOwnerSchema,
  source: StudioProjectSource,
  title: NonEmptyString,
  updatedAt: IsoDateStringSchema,
}) {}
export const StudioProjectRecordSchema = StudioProjectRecord;

export class StudioDiagramRecord extends Schema.Class<StudioDiagramRecord>(
  "StudioDiagramRecord",
)({
  artifactDiagramId: Schema.optional(NonEmptyString),
  artifactId: NonEmptyString,
  createdAt: IsoDateStringSchema,
  id: StudioRecordIdSchema,
  owner: StudioOwnerSchema,
  projectId: StudioRecordIdSchema,
  source: StudioProjectSource,
  title: NonEmptyString,
  updatedAt: IsoDateStringSchema,
}) {}
export const StudioDiagramRecordSchema = StudioDiagramRecord;

export class AnonymousStudioAuthStatus extends Schema.Class<AnonymousStudioAuthStatus>(
  "AnonymousStudioAuthStatus",
)({
  message: NonEmptyString,
  status: Schema.Literal("anonymous"),
}) {}

export class AuthenticatedStudioAuthStatus extends Schema.Class<AuthenticatedStudioAuthStatus>(
  "AuthenticatedStudioAuthStatus",
)({
  displayName: Schema.optional(NonEmptyString),
  status: Schema.Literal("authenticated"),
}) {}

export const StudioAuthStatusSchema = Schema.Union([
  AnonymousStudioAuthStatus,
  AuthenticatedStudioAuthStatus,
]);
export type StudioAuthStatus = typeof StudioAuthStatusSchema.Type;

export class AnonymousStudioPublicSession extends Schema.Class<AnonymousStudioPublicSession>(
  "AnonymousStudioPublicSession",
)({ kind: Schema.Literal("anonymous") }) {}

export class AuthenticatedStudioPublicSession extends Schema.Class<AuthenticatedStudioPublicSession>(
  "AuthenticatedStudioPublicSession",
)({
  displayName: Schema.optional(NonEmptyString),
  kind: Schema.Literal("authenticated"),
}) {}

export const StudioPublicSessionSchema = Schema.Union([
  AnonymousStudioPublicSession,
  AuthenticatedStudioPublicSession,
]);
export type StudioPublicSession = typeof StudioPublicSessionSchema.Type;

export class StudioProjectSummary extends Schema.Class<StudioProjectSummary>(
  "StudioProjectSummary",
)({
  createdAt: IsoDateStringSchema,
  diagramCount: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  id: StudioRecordIdSchema,
  primaryDiagramId: Schema.optional(StudioRecordIdSchema),
  source: StudioProjectSource,
  title: NonEmptyString,
  updatedAt: IsoDateStringSchema,
}) {}
export const StudioProjectSummarySchema = StudioProjectSummary;

export class StudioDiagramSummary extends Schema.Class<StudioDiagramSummary>(
  "StudioDiagramSummary",
)({
  artifactDiagramId: Schema.optional(NonEmptyString),
  artifactId: NonEmptyString,
  createdAt: IsoDateStringSchema,
  editUrl: NonEmptyString,
  id: StudioRecordIdSchema,
  projectId: StudioRecordIdSchema,
  reviewUrl: NonEmptyString,
  source: StudioProjectSource,
  title: NonEmptyString,
  updatedAt: IsoDateStringSchema,
}) {}
export const StudioDiagramSummarySchema = StudioDiagramSummary;

export class StudioProjectDetails extends Schema.Class<StudioProjectDetails>(
  "StudioProjectDetails",
)({
  diagrams: Schema.Array(StudioDiagramSummary).pipe(Schema.mutable),
  project: StudioProjectSummary,
}) {}
export const StudioProjectDetailsSchema = StudioProjectDetails;

export class CreateStudioProjectFromArtifactRequest extends Schema.Class<CreateStudioProjectFromArtifactRequest>(
  "CreateStudioProjectFromArtifactRequest",
)({ artifactId: NonEmptyString }) {}
export const CreateStudioProjectFromArtifactRequestSchema =
  CreateStudioProjectFromArtifactRequest;

export class StudioProjectsListResponse extends Schema.Class<StudioProjectsListResponse>(
  "StudioProjectsListResponse",
)({
  auth: StudioAuthStatusSchema,
  ok: Schema.Literal(true),
  projects: Schema.Array(StudioProjectSummary).pipe(Schema.mutable),
  session: StudioPublicSessionSchema,
}) {}
export const StudioProjectsListResponseSchema = StudioProjectsListResponse;

export class StudioProjectDetailsResponse extends Schema.Class<StudioProjectDetailsResponse>(
  "StudioProjectDetailsResponse",
)({
  auth: StudioAuthStatusSchema,
  details: StudioProjectDetails,
  ok: Schema.Literal(true),
  session: StudioPublicSessionSchema,
}) {}
export const StudioProjectDetailsResponseSchema = StudioProjectDetailsResponse;

export class StudioDiagramDetailsResponse extends Schema.Class<StudioDiagramDetailsResponse>(
  "StudioDiagramDetailsResponse",
)({
  auth: StudioAuthStatusSchema,
  diagram: StudioDiagramSummary,
  ok: Schema.Literal(true),
  project: StudioProjectSummary,
  session: StudioPublicSessionSchema,
}) {}
export const StudioDiagramDetailsResponseSchema = StudioDiagramDetailsResponse;

export class StudioProjectUrls extends Schema.Class<StudioProjectUrls>(
  "StudioProjectUrls",
)({
  diagram: NonEmptyString,
  edit: NonEmptyString,
  project: NonEmptyString,
}) {}

export class CreateStudioProjectFromArtifactResponse extends Schema.Class<CreateStudioProjectFromArtifactResponse>(
  "CreateStudioProjectFromArtifactResponse",
)({
  auth: StudioAuthStatusSchema,
  diagram: StudioDiagramSummary,
  ok: Schema.Literal(true),
  project: StudioProjectSummary,
  session: StudioPublicSessionSchema,
  urls: StudioProjectUrls,
}) {}
export const CreateStudioProjectFromArtifactResponseSchema =
  CreateStudioProjectFromArtifactResponse;

export function studioProjectUrl(projectId: string): string {
  return `/projects/${encodeURIComponent(projectId)}`;
}

export function studioDiagramUrl(diagramId: string): string {
  return `/diagrams/${encodeURIComponent(diagramId)}`;
}

export function studioDiagramEditUrl(diagramId: string): string {
  return `${studioDiagramUrl(diagramId)}/edit`;
}
