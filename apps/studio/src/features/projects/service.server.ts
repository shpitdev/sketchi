import {
	recordMetric,
	withTelemetryCorrelation,
	type TelemetryCorrelationInput,
} from "@sketchi/observability";
import {
	Cause,
	Array,
	String as Str,
	Context,
	Duration,
	Effect,
	Exit,
	Layer,
	Metric,
	Option,
	Schema,
} from "effect";

import {
	IsoDateStringSchema,
	makeIsoDateString,
	makeStudioRecordId,
	StudioDiagramRecord,
	StudioDrawing,
	StudioProjectRecord,
	StudioProjectSource,
	StudioRecordIdSchema,
	studioDiagramEditUrl,
	studioDiagramUrl,
	studioProjectUrl,
	type StudioDiagramSummary,
	type StudioOwner,
	type StudioProjectDetails,
	type StudioProjectSummary,
	type IsoDateString,
} from "./contracts";
import {
	makeStudioJsonPersistence,
	StudioObjectStore,
	type StudioObjectMetadata,
} from "./bucket.server";
import { StudioNotFoundError, type StudioProjectsError } from "./errors.server";
import { ensureOwner } from "./session.server";
import { StudioSourceArtifactStore } from "./source-artifacts.server";

const STUDIO_PREFIX = "studio";
const STUDIO_LISTING_CONCURRENCY = 8;

const studioPersistenceRequests = Metric.counter("sketchi_studio_persistence_requests", {
	description: "Studio persistence boundary requests by terminal outcome",
	incremental: true,
});
const studioPersistenceFailures = Metric.counter("sketchi_studio_persistence_failures", {
	description: "Studio persistence typed failures",
	incremental: true,
});
const studioPersistenceDuration = Metric.histogram("sketchi_studio_persistence_duration_ms", {
	description: "Studio persistence boundary duration in milliseconds",
	boundaries: Metric.boundariesFromIterable([1, 5, 10, 25, 50, 100, 250, 500, 1_000, 2_500, 5_000]),
});

type StudioPersistenceOperation =
	| "createFromArtifact"
	| "getDiagram"
	| "getDrawing"
	| "getProject"
	| "listProjects"
	| "saveDrawing";

function observeStudioPersistence<A>(
	operation: StudioPersistenceOperation,
	correlation: TelemetryCorrelationInput,
	effect: Effect.Effect<A, StudioProjectsError>,
): Effect.Effect<A, StudioProjectsError> {
	const observed = effect.pipe(
		Effect.exit,
		Effect.timed,
		Effect.onExit((timedExit) =>
			Effect.gen(function* () {
				if (Exit.isFailure(timedExit)) return;
				const [duration, exit] = timedExit.value;
				const error = Exit.isFailure(exit)
					? Option.getOrUndefined(Cause.findErrorOption(exit.cause))
					: undefined;
				if (Exit.isFailure(exit) && !error) return;
				const attributes = {
					...(error ? { failureCategory: error._tag } : {}),
					operation,
					surface: "studio",
				};
				const outcomeAttributes = {
					...attributes,
					outcome: Exit.isSuccess(exit) ? "success" : "failure",
				};
				yield* recordMetric(studioPersistenceRequests, 1, outcomeAttributes);
				if (error) yield* recordMetric(studioPersistenceFailures, 1, attributes);
				yield* recordMetric(
					studioPersistenceDuration,
					Duration.toMillis(duration),
					outcomeAttributes,
				);
			}),
		),
		Effect.flatMap(([, exit]) => exit),
	);
	return withTelemetryCorrelation(observed, correlation);
}

const StudioProjectIndexEntry = Schema.Struct({
	ownerKey: Schema.NonEmptyString,
	projectId: StudioRecordIdSchema,
	updatedAt: IsoDateStringSchema,
}).annotate({ identifier: "StudioProjectIndexEntry" });

interface StudioProjectIndexEntry extends Schema.Schema.Type<typeof StudioProjectIndexEntry> {}

export interface StudioProjectCreateSuccess {
	diagram: StudioDiagramSummary;
	ok: true;
	project: StudioProjectSummary;
	urls: {
		diagram: string;
		edit: string;
		project: string;
	};
}

export interface StudioProjectsShape {
	readonly createFromArtifact: (input: {
		readonly artifactId: string;
		readonly session: StudioOwner;
	}) => Effect.Effect<StudioProjectCreateSuccess, StudioProjectsError>;
	readonly getDiagram: (
		session: StudioOwner,
		diagramId: string,
	) => Effect.Effect<
		{
			readonly diagram: StudioDiagramSummary;
			readonly project: StudioProjectSummary;
		},
		StudioProjectsError
	>;
	readonly getDrawing: (
		session: StudioOwner,
		diagramId: string,
	) => Effect.Effect<StudioDrawing, StudioProjectsError>;
	readonly getProject: (
		session: StudioOwner,
		projectId: string,
	) => Effect.Effect<StudioProjectDetails, StudioProjectsError>;
	readonly listProjects: (
		session: StudioOwner,
	) => Effect.Effect<StudioProjectSummary[], StudioProjectsError>;
	/** One authoritative atomic R2 drawing replacement; native metadata owns its save time. */
	readonly saveDrawing: (
		session: StudioOwner,
		diagramId: string,
		drawing: StudioDrawing,
	) => Effect.Effect<StudioDiagramSummary, StudioProjectsError>;
}

export class StudioProjects extends Context.Service<StudioProjects, StudioProjectsShape>()(
	"@sketchi/studio/projects/StudioProjects",
) {}

export interface StudioRecordFactoryShape {
	readonly createId: (kind: "dia" | "proj") => typeof StudioRecordIdSchema.Type;
	readonly now: Effect.Effect<IsoDateString>;
}

export class StudioRecordFactory extends Context.Service<
	StudioRecordFactory,
	StudioRecordFactoryShape
>()("@sketchi/studio/projects/StudioRecordFactory") {}

function keySegment(value: string): string {
	return encodeURIComponent(value);
}

export function studioOwnerKey(owner: StudioOwner): string {
	return owner.kind === "authenticated"
		? `authenticated/${keySegment(owner.subjectId)}`
		: `anonymous/${keySegment(owner.sessionId)}`;
}

export function studioOwnerProjectsPrefix(owner: StudioOwner): string {
	return `${STUDIO_PREFIX}/owners/${studioOwnerKey(owner)}/projects/`;
}

export function studioOwnerProjectEntryKey(owner: StudioOwner, projectId: string): string {
	return `${studioOwnerProjectsPrefix(owner)}${keySegment(projectId)}.json`;
}

export function studioProjectRecordKey(projectId: string): string {
	return `${STUDIO_PREFIX}/projects/${keySegment(projectId)}.json`;
}

export function studioDiagramRecordKey(diagramId: string): string {
	return `${STUDIO_PREFIX}/diagrams/${keySegment(diagramId)}.json`;
}

export function studioDrawingKey(diagramId: string): string {
	return `${STUDIO_PREFIX}/drawings/${keySegment(diagramId)}.json`;
}

function projectSummary(record: StudioProjectRecord): StudioProjectSummary {
	return {
		createdAt: record.createdAt,
		diagramCount: record.diagramIds.length,
		id: record.id,
		primaryDiagramId: record.diagramIds[0],
		source: record.source,
		title: record.title,
		updatedAt: record.updatedAt,
	};
}

function diagramSummary(
	record: StudioDiagramRecord,
	drawing: StudioObjectMetadata | null,
): StudioDiagramSummary {
	return {
		artifactDiagramId: record.artifactDiagramId,
		artifactId: record.artifactId,
		createdAt: record.createdAt,
		editUrl: studioDiagramEditUrl(record.id),
		id: record.id,
		projectId: record.projectId,
		reviewUrl: studioDiagramUrl(record.id),
		savedAt: drawing ? makeIsoDateString(drawing.uploaded.toISOString()) : undefined,
		source: record.source,
		title: record.title,
		updatedAt: drawing ? makeIsoDateString(drawing.uploaded.toISOString()) : record.updatedAt,
	};
}

function sortedProjects(projects: StudioProjectSummary[]): StudioProjectSummary[] {
	return [...projects].sort((left, right) => Str.localeCompare(left.updatedAt)(right.updatedAt));
}

export const StudioProjectsLive = Layer.effect(
	StudioProjects,
	Effect.gen(function* () {
		const objectStore = yield* StudioObjectStore;
		const sourceArtifacts = yield* StudioSourceArtifactStore;
		const recordFactory = yield* StudioRecordFactory;
		const json = makeStudioJsonPersistence(objectStore);

		const readProjectRecord = Effect.fn("studioPersistence.projects.readProject")(function* (
			projectId: string,
		) {
			return yield* json.read(
				studioProjectRecordKey(projectId),
				StudioProjectRecord,
				"project",
				projectId,
			);
		});

		const readDiagramRecord = Effect.fn("studioPersistence.projects.readDiagram")(function* (
			diagramId: string,
		) {
			return yield* json.read(
				studioDiagramRecordKey(diagramId),
				StudioDiagramRecord,
				"diagram",
				diagramId,
			);
		});

		const listOwnerProjectEntryKeys = Effect.fn("studioPersistence.projects.listOwnerIndex")(
			function* (session: StudioOwner) {
				const prefix = studioOwnerProjectsPrefix(session);
				const keys: string[] = [];
				let cursor: string | undefined;

				do {
					const result = yield* objectStore.list(cursor ? { cursor, prefix } : { prefix });
					keys.push(...Array.map(result.objects, (object) => object.key));
					cursor = result.truncated === true && result.cursor ? result.cursor : undefined;
				} while (cursor);

				return keys;
			},
		);

		const listOwnerProjectIds = Effect.fn("studioPersistence.projects.loadOwnerIndex")(function* (
			session: StudioOwner,
		) {
			const ownerKey = studioOwnerKey(session);
			const entryKeys = yield* listOwnerProjectEntryKeys(session);
			const entries = yield* Effect.forEach(
				entryKeys,
				(entryKey) =>
					json
						.read(entryKey, StudioProjectIndexEntry, "owner-index", entryKey)
						.pipe(Effect.catchTag("StudioNotFoundError", () => Effect.succeed(null))),
				{ concurrency: STUDIO_LISTING_CONCURRENCY },
			);

			return Array.flatMap(entries, (entry) =>
				entry && entry.ownerKey === ownerKey ? [entry.projectId] : [],
			);
		});

		const writeOwnerProjectEntry = Effect.fn("studioPersistence.projects.writeOwnerIndex")(
			function* (session: StudioOwner, projectId: string, updatedAt: IsoDateString) {
				const entry = StudioProjectIndexEntry.make({
					ownerKey: studioOwnerKey(session),
					projectId: makeStudioRecordId(projectId),
					updatedAt,
				});

				yield* json.put(
					studioOwnerProjectEntryKey(session, projectId),
					StudioProjectIndexEntry,
					entry,
				);
			},
		);

		const listProjects = Effect.fn("studioPersistence.projects.list")(function* (
			session: StudioOwner,
		) {
			const projectIds = yield* listOwnerProjectIds(session);
			const records = yield* Effect.forEach(
				projectIds,
				(projectId) =>
					getProject(session, projectId, 1).pipe(
						Effect.map((details) => details.project),
						Effect.catchTags({
							StudioNotFoundError: () => Effect.succeed(null),
							StudioOwnershipError: () => Effect.succeed(null),
						}),
					),
				{ concurrency: STUDIO_LISTING_CONCURRENCY },
			);

			return sortedProjects(Array.flatMap(records, (record) => (record === null ? [] : [record])));
		});

		const getProject = Effect.fn("studioPersistence.projects.getProject")(function* (
			session: StudioOwner,
			projectId: string,
			diagramConcurrency = STUDIO_LISTING_CONCURRENCY,
		) {
			const project = yield* readProjectRecord(projectId);
			yield* ensureOwner(project.owner, session, "project", project.id);

			const diagrams = yield* Effect.forEach(
				project.diagramIds,
				(diagramId) =>
					readDiagramRecord(diagramId).pipe(
						Effect.flatMap((diagram) =>
							ensureOwner(diagram.owner, session, "diagram", diagram.id).pipe(
								Effect.andThen(
									Effect.map(objectStore.head(studioDrawingKey(diagram.id)), (metadata) =>
										diagramSummary(diagram, metadata),
									),
								),
							),
						),
						Effect.catchTags({
							StudioNotFoundError: () => Effect.succeed(null),
							StudioOwnershipError: () => Effect.succeed(null),
						}),
					),
				{ concurrency: diagramConcurrency },
			);

			// The project is a publication reference, never a partially assembled view.
			// A failed final put can commit before its response is lost; best-effort
			// cleanup may leave that record after deleting a child.
			if (Array.some(diagrams, (diagram) => diagram === null))
				return yield* StudioNotFoundError.make({ id: projectId, resource: "project" });

			return {
				diagrams: Array.flatMap(diagrams, (diagram) => (diagram === null ? [] : [diagram])),
				project: {
					...projectSummary(project),
					updatedAt: makeIsoDateString(
						Array.reduce(diagrams, project.updatedAt, (latest, diagram) =>
							diagram && diagram.updatedAt > latest ? diagram.updatedAt : latest,
						),
					),
				},
			};
		});

		const getDiagram = Effect.fn("studioPersistence.projects.getDiagram")(function* (
			session: StudioOwner,
			diagramId: string,
		) {
			const diagram = yield* readDiagramRecord(diagramId);
			yield* ensureOwner(diagram.owner, session, "diagram", diagram.id);
			const project = yield* readProjectRecord(diagram.projectId);
			yield* ensureOwner(project.owner, session, "project", project.id);

			if (!project.diagramIds.includes(diagram.id))
				return yield* StudioNotFoundError.make({ id: diagramId, resource: "diagram" });
			const metadata = yield* objectStore.head(studioDrawingKey(diagram.id));
			const summary = diagramSummary(diagram, metadata);
			return {
				diagram: summary,
				project: {
					...projectSummary(project),
					updatedAt: summary.updatedAt > project.updatedAt ? summary.updatedAt : project.updatedAt,
				},
			};
		});

		const readOwnedDiagram = Effect.fn("studioPersistence.projects.readOwnedDiagram")(function* (
			session: StudioOwner,
			diagramId: string,
		) {
			const diagram = yield* readDiagramRecord(diagramId);
			yield* ensureOwner(diagram.owner, session, "diagram", diagram.id);
			const project = yield* readProjectRecord(diagram.projectId);
			yield* ensureOwner(project.owner, session, "project", project.id);
			if (!project.diagramIds.includes(diagram.id))
				return yield* StudioNotFoundError.make({ id: diagramId, resource: "diagram" });
			return diagram;
		});

		const getDrawing = Effect.fn("studioPersistence.projects.getDrawing")(function* (
			session: StudioOwner,
			diagramId: string,
		) {
			const diagram = yield* readOwnedDiagram(session, diagramId);
			return yield* json.read(studioDrawingKey(diagram.id), StudioDrawing, "diagram", diagram.id);
		});

		const saveDrawing = Effect.fn("studioPersistence.projects.saveDrawing")(function* (
			session: StudioOwner,
			diagramId: string,
			drawing: StudioDrawing,
		) {
			const diagram = yield* readOwnedDiagram(session, diagramId);
			const metadata = yield* json.put(studioDrawingKey(diagram.id), StudioDrawing, drawing);
			return diagramSummary(diagram, metadata);
		});

		const createFromArtifact = Effect.fn("studioPersistence.projects.createFromArtifact")(
			function* (input: { readonly artifactId: string; readonly session: StudioOwner }) {
				const sourceArtifact = yield* sourceArtifacts.load(input.artifactId);
				const createdAt = yield* recordFactory.now;
				const projectId = recordFactory.createId("proj");
				const diagramId = recordFactory.createId("dia");
				const source = StudioProjectSource.make({
					artifactId: input.artifactId,
					kind: "playground-artifact",
				});
				const diagram = StudioDiagramRecord.make({
					artifactDiagramId: sourceArtifact.diagramId,
					artifactId: input.artifactId,
					createdAt,
					id: diagramId,
					owner: input.session,
					projectId,
					source,
					title: sourceArtifact.title,
					updatedAt: createdAt,
				});
				const project = StudioProjectRecord.make({
					createdAt,
					diagramIds: [diagram.id],
					id: projectId,
					owner: input.session,
					source,
					title: sourceArtifact.title,
					updatedAt: createdAt,
				});

				yield* withTelemetryCorrelation(
					Effect.gen(function* () {
						yield* json.put(studioDiagramRecordKey(diagram.id), StudioDiagramRecord, diagram);
						yield* writeOwnerProjectEntry(input.session, project.id, createdAt);
						yield* json.put(studioProjectRecordKey(project.id), StudioProjectRecord, project);
					}).pipe(
						Effect.onError(() =>
							Effect.forEach(
								[
									studioOwnerProjectEntryKey(input.session, project.id),
									studioProjectRecordKey(project.id),
									studioDiagramRecordKey(diagram.id),
								],
								(key) => objectStore.delete(key).pipe(Effect.ignore),
								{ discard: true },
							),
						),
					),
					{ artifactId: input.artifactId, projectId: project.id },
				);

				return {
					diagram: diagramSummary(diagram, null),
					ok: true,
					project: projectSummary(project),
					urls: {
						diagram: studioDiagramUrl(diagram.id),
						edit: studioDiagramEditUrl(diagram.id),
						project: studioProjectUrl(project.id),
					},
				} satisfies StudioProjectCreateSuccess;
			},
		);

		return {
			createFromArtifact: (input) =>
				observeStudioPersistence(
					"createFromArtifact",
					{ artifactId: input.artifactId },
					createFromArtifact(input),
				),
			getDiagram: (session, diagramId) =>
				observeStudioPersistence("getDiagram", {}, getDiagram(session, diagramId)),
			getDrawing: (session, diagramId) =>
				observeStudioPersistence("getDrawing", {}, getDrawing(session, diagramId)),
			getProject: (session, projectId) =>
				observeStudioPersistence("getProject", { projectId }, getProject(session, projectId)),
			listProjects: (session) =>
				observeStudioPersistence("listProjects", {}, listProjects(session)),
			saveDrawing: (session, diagramId, drawing) =>
				observeStudioPersistence("saveDrawing", {}, saveDrawing(session, diagramId, drawing)),
		};
	}),
);

export function makeStudioRecordFactoryLayer(factory: StudioRecordFactoryShape) {
	return Layer.succeed(StudioRecordFactory, factory);
}
