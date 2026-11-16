import { Schema } from "effect";

const NonEmptyString = Schema.NonEmptyString;

export const StudioRecordIdSchema = Schema.String.check(
	Schema.isBetweenLength(6, 80),
	Schema.isPattern(/^[a-z0-9_-]{6,80}$/iu),
).pipe(Schema.brand("StudioRecordId"));
export type StudioRecordId = typeof StudioRecordIdSchema.Type;

export function makeStudioRecordId(input: string): StudioRecordId {
	return StudioRecordIdSchema.make(input);
}

export const AnonymousStudioSessionIdSchema = StudioRecordIdSchema.check(
	Schema.isPattern(/^anon_/),
	Schema.isBetweenLength(17, 69),
);

export const IsoDateStringSchema = NonEmptyString.pipe(Schema.brand("IsoDateString"));
export type IsoDateString = typeof IsoDateStringSchema.Type;

export function makeIsoDateString(input: string): IsoDateString {
	return IsoDateStringSchema.make(input);
}

export const AnonymousStudioOwner = Schema.Struct({
	kind: Schema.Literal("anonymous"),
	sessionId: AnonymousStudioSessionIdSchema,
}).annotate({ identifier: "AnonymousStudioOwner" });

export interface AnonymousStudioOwner extends Schema.Schema.Type<typeof AnonymousStudioOwner> {}

export const AuthenticatedStudioOwner = Schema.Struct({
	displayName: Schema.optional(NonEmptyString),
	kind: Schema.Literal("authenticated"),
	subjectId: NonEmptyString,
}).annotate({ identifier: "AuthenticatedStudioOwner" });

export interface AuthenticatedStudioOwner extends Schema.Schema.Type<
	typeof AuthenticatedStudioOwner
> {}

export const StudioOwnerSchema = Schema.Union([AnonymousStudioOwner, AuthenticatedStudioOwner]);
export type StudioOwner = typeof StudioOwnerSchema.Type;

export const StudioProjectSource = Schema.Struct({
	artifactId: NonEmptyString,
	kind: Schema.Literal("playground-artifact"),
}).annotate({ identifier: "StudioProjectSource" });

export interface StudioProjectSource extends Schema.Schema.Type<typeof StudioProjectSource> {}

export const StudioProjectRecord = Schema.Struct({
	createdAt: IsoDateStringSchema,
	diagramIds: Schema.Array(StudioRecordIdSchema).pipe(Schema.mutable),
	id: StudioRecordIdSchema,
	owner: StudioOwnerSchema,
	source: StudioProjectSource,
	title: NonEmptyString,
	updatedAt: IsoDateStringSchema,
}).annotate({ identifier: "StudioProjectRecord" });

export interface StudioProjectRecord extends Schema.Schema.Type<typeof StudioProjectRecord> {}

export const StudioDiagramRecord = Schema.Struct({
	artifactDiagramId: Schema.optional(NonEmptyString),
	artifactId: NonEmptyString,
	createdAt: IsoDateStringSchema,
	id: StudioRecordIdSchema,
	owner: StudioOwnerSchema,
	projectId: StudioRecordIdSchema,
	savedAt: Schema.optional(IsoDateStringSchema),
	source: StudioProjectSource,
	title: NonEmptyString,
	updatedAt: IsoDateStringSchema,
}).annotate({ identifier: "StudioDiagramRecord" });

export interface StudioDiagramRecord extends Schema.Schema.Type<typeof StudioDiagramRecord> {}

const StudioDrawingElement = Schema.Record(Schema.String, Schema.Unknown).check(
	Schema.makeFilter(
		(value) =>
			typeof value["id"] === "string" &&
			value["id"].length > 0 &&
			typeof value["type"] === "string" &&
			value["type"].length > 0,
		{ message: "Each drawing element needs an id and a type." },
	),
);

/** A diagram's saved Excalidraw drawing: its live elements, app state and image files. */
export const StudioDrawing = Schema.Struct({
	appState: Schema.Record(Schema.String, Schema.Unknown),
	elements: Schema.Array(StudioDrawingElement),
	files: Schema.Record(Schema.String, Schema.Unknown),
}).annotate({ identifier: "StudioDrawing" });

export interface StudioDrawing extends Schema.Schema.Type<typeof StudioDrawing> {}

export const AnonymousStudioAuthStatus = Schema.Struct({
	message: NonEmptyString,
	status: Schema.Literal("anonymous"),
}).annotate({ identifier: "AnonymousStudioAuthStatus" });

export interface AnonymousStudioAuthStatus extends Schema.Schema.Type<
	typeof AnonymousStudioAuthStatus
> {}

export const AuthenticatedStudioAuthStatus = Schema.Struct({
	displayName: Schema.optional(NonEmptyString),
	status: Schema.Literal("authenticated"),
}).annotate({ identifier: "AuthenticatedStudioAuthStatus" });

export interface AuthenticatedStudioAuthStatus extends Schema.Schema.Type<
	typeof AuthenticatedStudioAuthStatus
> {}

export const StudioAuthStatusSchema = Schema.Union([
	AnonymousStudioAuthStatus,
	AuthenticatedStudioAuthStatus,
]);
export type StudioAuthStatus = typeof StudioAuthStatusSchema.Type;

export const AnonymousStudioPublicSession = Schema.Struct({
	kind: Schema.Literal("anonymous"),
}).annotate({ identifier: "AnonymousStudioPublicSession" });

export interface AnonymousStudioPublicSession extends Schema.Schema.Type<
	typeof AnonymousStudioPublicSession
> {}

export const AuthenticatedStudioPublicSession = Schema.Struct({
	displayName: Schema.optional(NonEmptyString),
	kind: Schema.Literal("authenticated"),
}).annotate({ identifier: "AuthenticatedStudioPublicSession" });

export interface AuthenticatedStudioPublicSession extends Schema.Schema.Type<
	typeof AuthenticatedStudioPublicSession
> {}

export const StudioPublicSessionSchema = Schema.Union([
	AnonymousStudioPublicSession,
	AuthenticatedStudioPublicSession,
]);
export type StudioPublicSession = typeof StudioPublicSessionSchema.Type;

export const StudioProjectSummary = Schema.Struct({
	createdAt: IsoDateStringSchema,
	diagramCount: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
	id: StudioRecordIdSchema,
	primaryDiagramId: Schema.optional(StudioRecordIdSchema),
	source: StudioProjectSource,
	title: NonEmptyString,
	updatedAt: IsoDateStringSchema,
}).annotate({ identifier: "StudioProjectSummary" });

export interface StudioProjectSummary extends Schema.Schema.Type<typeof StudioProjectSummary> {}

export const StudioDiagramSummary = Schema.Struct({
	artifactDiagramId: Schema.optional(NonEmptyString),
	artifactId: NonEmptyString,
	createdAt: IsoDateStringSchema,
	editUrl: NonEmptyString,
	id: StudioRecordIdSchema,
	projectId: StudioRecordIdSchema,
	reviewUrl: NonEmptyString,
	/** When the diagram's drawing was last saved; absent until the first Save. */
	savedAt: Schema.optional(IsoDateStringSchema),
	source: StudioProjectSource,
	title: NonEmptyString,
	updatedAt: IsoDateStringSchema,
}).annotate({ identifier: "StudioDiagramSummary" });

export interface StudioDiagramSummary extends Schema.Schema.Type<typeof StudioDiagramSummary> {}

export const StudioProjectDetails = Schema.Struct({
	diagrams: Schema.Array(StudioDiagramSummary).pipe(Schema.mutable),
	project: StudioProjectSummary,
}).annotate({ identifier: "StudioProjectDetails" });

export interface StudioProjectDetails extends Schema.Schema.Type<typeof StudioProjectDetails> {}

export const CreateStudioProjectFromArtifactRequest = Schema.Struct({
	artifactId: NonEmptyString,
}).annotate({ identifier: "CreateStudioProjectFromArtifactRequest" });

export interface CreateStudioProjectFromArtifactRequest extends Schema.Schema.Type<
	typeof CreateStudioProjectFromArtifactRequest
> {}

export const StudioProjectsListResponse = Schema.Struct({
	auth: StudioAuthStatusSchema,
	ok: Schema.Literal(true),
	projects: Schema.Array(StudioProjectSummary).pipe(Schema.mutable),
	session: StudioPublicSessionSchema,
}).annotate({ identifier: "StudioProjectsListResponse" });

export interface StudioProjectsListResponse extends Schema.Schema.Type<
	typeof StudioProjectsListResponse
> {}

export const StudioProjectDetailsResponse = Schema.Struct({
	auth: StudioAuthStatusSchema,
	details: StudioProjectDetails,
	ok: Schema.Literal(true),
	session: StudioPublicSessionSchema,
}).annotate({ identifier: "StudioProjectDetailsResponse" });

export interface StudioProjectDetailsResponse extends Schema.Schema.Type<
	typeof StudioProjectDetailsResponse
> {}

export const StudioDiagramDetailsResponse = Schema.Struct({
	auth: StudioAuthStatusSchema,
	diagram: StudioDiagramSummary,
	ok: Schema.Literal(true),
	project: StudioProjectSummary,
	session: StudioPublicSessionSchema,
}).annotate({ identifier: "StudioDiagramDetailsResponse" });

export interface StudioDiagramDetailsResponse extends Schema.Schema.Type<
	typeof StudioDiagramDetailsResponse
> {}

export const StudioDrawingResponse = Schema.Struct({
	auth: StudioAuthStatusSchema,
	drawing: StudioDrawing,
	ok: Schema.Literal(true),
	session: StudioPublicSessionSchema,
}).annotate({ identifier: "StudioDrawingResponse" });

export interface StudioDrawingResponse extends Schema.Schema.Type<typeof StudioDrawingResponse> {}

export const SaveStudioDrawingResponse = Schema.Struct({
	auth: StudioAuthStatusSchema,
	diagram: StudioDiagramSummary,
	ok: Schema.Literal(true),
	session: StudioPublicSessionSchema,
}).annotate({ identifier: "SaveStudioDrawingResponse" });

export interface SaveStudioDrawingResponse extends Schema.Schema.Type<
	typeof SaveStudioDrawingResponse
> {}

export const StudioProjectUrls = Schema.Struct({
	diagram: NonEmptyString,
	edit: NonEmptyString,
	project: NonEmptyString,
}).annotate({ identifier: "StudioProjectUrls" });

export interface StudioProjectUrls extends Schema.Schema.Type<typeof StudioProjectUrls> {}

export const CreateStudioProjectFromArtifactResponse = Schema.Struct({
	auth: StudioAuthStatusSchema,
	diagram: StudioDiagramSummary,
	ok: Schema.Literal(true),
	project: StudioProjectSummary,
	session: StudioPublicSessionSchema,
	urls: StudioProjectUrls,
}).annotate({ identifier: "CreateStudioProjectFromArtifactResponse" });

export interface CreateStudioProjectFromArtifactResponse extends Schema.Schema.Type<
	typeof CreateStudioProjectFromArtifactResponse
> {}

export function studioProjectUrl(projectId: string): string {
	return `/projects/${encodeURIComponent(projectId)}`;
}

export function studioDiagramUrl(diagramId: string): string {
	return `/diagrams/${encodeURIComponent(diagramId)}`;
}

export function studioDiagramEditUrl(diagramId: string): string {
	return `${studioDiagramUrl(diagramId)}/edit`;
}
