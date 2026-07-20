import {
  recordMetric,
  withTelemetryCorrelation,
  type TelemetryCorrelationInput,
} from "@sketchi/observability";
import { nanoid } from "nanoid";
import { Clock, Context, Effect, Layer, Metric, Schema } from "effect";

import {
  IsoDateStringSchema,
  makeIsoDateString,
  makeStudioRecordId,
  StudioDiagramRecord,
  StudioDiagramRecordSchema,
  StudioProjectRecord,
  StudioProjectRecordSchema,
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
} from "../contracts.js";
import { makeStudioJsonPersistence, StudioObjectStore } from "./bucket.js";
import type { StudioProjectsError } from "./errors.js";
import { StudioSessionService } from "./session.js";
import { StudioSourceArtifactStore } from "./source-artifacts.js";

const STUDIO_PREFIX = "studio";

const studioPersistenceRequests = Metric.counter(
  "sketchi_studio_persistence_requests",
  {
    description: "Studio persistence boundary requests by terminal outcome",
    incremental: true,
  },
);
const studioPersistenceFailures = Metric.counter(
  "sketchi_studio_persistence_failures",
  {
    description: "Studio persistence typed failures",
    incremental: true,
  },
);
const studioPersistenceDuration = Metric.histogram(
  "sketchi_studio_persistence_duration_ms",
  {
    description: "Studio persistence boundary duration in milliseconds",
    boundaries: Metric.boundariesFromIterable([
      1, 5, 10, 25, 50, 100, 250, 500, 1_000, 2_500, 5_000,
    ]),
  },
);

type StudioPersistenceOperation =
  | "createFromArtifact"
  | "getDiagram"
  | "getProject"
  | "listProjects";

function observeStudioPersistence<A>(
  operation: StudioPersistenceOperation,
  correlation: TelemetryCorrelationInput,
  effect: Effect.Effect<A, StudioProjectsError>,
): Effect.Effect<A, StudioProjectsError> {
  const observed = Effect.gen(function* () {
    const startedAt = yield* Clock.currentTimeMillis;
    return yield* effect.pipe(
      Effect.tap(() =>
        Effect.gen(function* () {
          const finishedAt = yield* Clock.currentTimeMillis;
          yield* recordMetric(studioPersistenceRequests, 1, {
            operation,
            outcome: "success",
            surface: "studio",
          });
          yield* recordMetric(
            studioPersistenceDuration,
            finishedAt - startedAt,
            {
              operation,
              outcome: "success",
              surface: "studio",
            },
          );
        }),
      ),
      Effect.tapError((error) =>
        Effect.gen(function* () {
          const finishedAt = yield* Clock.currentTimeMillis;
          yield* recordMetric(studioPersistenceRequests, 1, {
            failureCategory: error._tag,
            operation,
            outcome: "failure",
            surface: "studio",
          });
          yield* recordMetric(studioPersistenceFailures, 1, {
            failureCategory: error._tag,
            operation,
            surface: "studio",
          });
          yield* recordMetric(
            studioPersistenceDuration,
            finishedAt - startedAt,
            {
              failureCategory: error._tag,
              operation,
              outcome: "failure",
              surface: "studio",
            },
          );
        }),
      ),
    );
  });
  return withTelemetryCorrelation(observed, correlation);
}

class StudioProjectIndexEntry extends Schema.Class<StudioProjectIndexEntry>(
  "StudioProjectIndexEntry",
)({
  ownerKey: Schema.NonEmptyString,
  projectId: StudioRecordIdSchema,
  updatedAt: IsoDateStringSchema,
}) {}

const StudioProjectIndexEntrySchema = StudioProjectIndexEntry;

export interface StudioProjectCreateSuccess {
  diagram: StudioDiagramSummary;
  diagramRecord: StudioDiagramRecord;
  ok: true;
  project: StudioProjectSummary;
  projectRecord: StudioProjectRecord;
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
  readonly getProject: (
    session: StudioOwner,
    projectId: string,
  ) => Effect.Effect<StudioProjectDetails, StudioProjectsError>;
  readonly listProjects: (
    session: StudioOwner,
  ) => Effect.Effect<StudioProjectSummary[], StudioProjectsError>;
}

export class StudioProjects extends Context.Service<
  StudioProjects,
  StudioProjectsShape
>()("@sketchi/studio-projects/StudioProjects") {}

export class StudioPersistencePolicyConfig extends Schema.Class<StudioPersistencePolicyConfig>(
  "StudioPersistencePolicyConfig",
)({ listingConcurrency: Schema.Number }) {}

export class StudioPersistencePolicy extends Context.Service<
  StudioPersistencePolicy,
  StudioPersistencePolicyConfig
>()("@sketchi/studio-projects/StudioPersistencePolicy") {}

const INVALID_LISTING_CONCURRENCY_MESSAGE =
  "Studio listing concurrency must be a finite positive integer.";

function validateStudioPersistencePolicy(
  config: StudioPersistencePolicyConfig,
): StudioPersistencePolicyConfig {
  if (
    !Number.isSafeInteger(config.listingConcurrency) ||
    config.listingConcurrency <= 0
  ) {
    throw new TypeError(INVALID_LISTING_CONCURRENCY_MESSAGE);
  }

  return Object.freeze({
    listingConcurrency: config.listingConcurrency,
  });
}

export const studioPersistencePolicyDefaults = validateStudioPersistencePolicy({
  listingConcurrency: 8,
});

export const StudioPersistencePolicyLive = Layer.succeed(
  StudioPersistencePolicy,
  studioPersistencePolicyDefaults,
);

export interface StudioRecordFactoryShape {
  readonly createId: (kind: "dia" | "proj") => typeof StudioRecordIdSchema.Type;
  readonly now: Effect.Effect<IsoDateString>;
}

export class StudioRecordFactory extends Context.Service<
  StudioRecordFactory,
  StudioRecordFactoryShape
>()("@sketchi/studio-projects/StudioRecordFactory") {}

export const StudioRecordFactoryLive = Layer.succeed(StudioRecordFactory, {
  createId: (kind) => makeStudioRecordId(`${kind}_${nanoid(14)}`),
  now: Clock.currentTimeMillis.pipe(
    Effect.map((millis) => makeIsoDateString(new Date(millis).toISOString())),
  ),
});

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

export function studioOwnerProjectEntryKey(
  owner: StudioOwner,
  projectId: string,
): string {
  return `${studioOwnerProjectsPrefix(owner)}${keySegment(projectId)}.json`;
}

export function studioProjectRecordKey(projectId: string): string {
  return `${STUDIO_PREFIX}/projects/${keySegment(projectId)}.json`;
}

export function studioDiagramRecordKey(diagramId: string): string {
  return `${STUDIO_PREFIX}/diagrams/${keySegment(diagramId)}.json`;
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

function diagramSummary(record: StudioDiagramRecord): StudioDiagramSummary {
  return {
    artifactDiagramId: record.artifactDiagramId,
    artifactId: record.artifactId,
    createdAt: record.createdAt,
    editUrl: studioDiagramEditUrl(record.id),
    id: record.id,
    projectId: record.projectId,
    reviewUrl: studioDiagramUrl(record.id),
    source: record.source,
    title: record.title,
    updatedAt: record.updatedAt,
  };
}

function sortedProjects(
  projects: StudioProjectSummary[],
): StudioProjectSummary[] {
  return [...projects].sort((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt),
  );
}

export const StudioProjectsLive = Layer.effect(
  StudioProjects,
  Effect.gen(function* () {
    const objectStore = yield* StudioObjectStore;
    const sourceArtifacts = yield* StudioSourceArtifactStore;
    const sessions = yield* StudioSessionService;
    const policy = yield* StudioPersistencePolicy;
    const recordFactory = yield* StudioRecordFactory;
    const json = makeStudioJsonPersistence(objectStore);

    const readProjectRecord = Effect.fn(
      "studioPersistence.projects.readProject",
    )(function* (projectId: string) {
      return yield* json.read(
        studioProjectRecordKey(projectId),
        StudioProjectRecordSchema,
        "project",
        projectId,
      );
    });

    const readDiagramRecord = Effect.fn(
      "studioPersistence.projects.readDiagram",
    )(function* (diagramId: string) {
      return yield* json.read(
        studioDiagramRecordKey(diagramId),
        StudioDiagramRecordSchema,
        "diagram",
        diagramId,
      );
    });

    const listOwnerProjectEntryKeys = Effect.fn(
      "studioPersistence.projects.listOwnerIndex",
    )(function* (session: StudioOwner) {
      const prefix = studioOwnerProjectsPrefix(session);
      const keys: string[] = [];
      let cursor: string | undefined;

      do {
        const result = yield* objectStore.list(
          cursor ? { cursor, prefix } : { prefix },
        );
        keys.push(...result.objects.map((object) => object.key));
        cursor =
          result.truncated === true && result.cursor
            ? result.cursor
            : undefined;
      } while (cursor);

      return keys;
    });

    const listOwnerProjectIds = Effect.fn(
      "studioPersistence.projects.loadOwnerIndex",
    )(function* (session: StudioOwner) {
      const ownerKey = studioOwnerKey(session);
      const entryKeys = yield* listOwnerProjectEntryKeys(session);
      const entries = yield* Effect.forEach(
        entryKeys,
        (entryKey) =>
          json
            .read(
              entryKey,
              StudioProjectIndexEntrySchema,
              "owner-index",
              entryKey,
            )
            .pipe(
              Effect.catchTag("StudioNotFoundError", () =>
                Effect.succeed(null),
              ),
            ),
        { concurrency: policy.listingConcurrency },
      );

      return entries.flatMap((entry) =>
        entry && entry.ownerKey === ownerKey ? [entry.projectId] : [],
      );
    });

    const writeOwnerProjectEntry = Effect.fn(
      "studioPersistence.projects.writeOwnerIndex",
    )(function* (
      session: StudioOwner,
      projectId: string,
      updatedAt: IsoDateString,
    ) {
      const entry = StudioProjectIndexEntry.make({
        ownerKey: studioOwnerKey(session),
        projectId: makeStudioRecordId(projectId),
        updatedAt,
      });

      yield* json.put(
        studioOwnerProjectEntryKey(session, projectId),
        StudioProjectIndexEntrySchema,
        entry,
      );
    });

    const listProjects = Effect.fn("studioPersistence.projects.list")(
      function* (session: StudioOwner) {
        const projectIds = yield* listOwnerProjectIds(session);
        const records = yield* Effect.forEach(
          projectIds,
          (projectId) =>
            readProjectRecord(projectId).pipe(
              Effect.flatMap((record) =>
                sessions
                  .ensureOwner(record.owner, session, "project", record.id)
                  .pipe(Effect.as(record)),
              ),
              Effect.catchTags({
                StudioNotFoundError: () => Effect.succeed(null),
                StudioOwnershipError: () => Effect.succeed(null),
              }),
            ),
          { concurrency: policy.listingConcurrency },
        );

        return sortedProjects(
          records.flatMap((record) =>
            record === null ? [] : [projectSummary(record)],
          ),
        );
      },
    );

    const getProject = Effect.fn("studioPersistence.projects.getProject")(
      function* (session: StudioOwner, projectId: string) {
        const project = yield* readProjectRecord(projectId);
        yield* sessions.ensureOwner(
          project.owner,
          session,
          "project",
          project.id,
        );

        const diagrams = yield* Effect.forEach(
          project.diagramIds,
          (diagramId) =>
            readDiagramRecord(diagramId).pipe(
              Effect.flatMap((diagram) =>
                sessions
                  .ensureOwner(diagram.owner, session, "diagram", diagram.id)
                  .pipe(Effect.as(diagram)),
              ),
              Effect.catchTags({
                StudioNotFoundError: () => Effect.succeed(null),
                StudioOwnershipError: () => Effect.succeed(null),
              }),
            ),
          { concurrency: policy.listingConcurrency },
        );

        return {
          diagrams: diagrams.flatMap((diagram) =>
            diagram === null ? [] : [diagramSummary(diagram)],
          ),
          project: projectSummary(project),
        };
      },
    );

    const getDiagram = Effect.fn("studioPersistence.projects.getDiagram")(
      function* (session: StudioOwner, diagramId: string) {
        const diagram = yield* readDiagramRecord(diagramId);
        yield* sessions.ensureOwner(
          diagram.owner,
          session,
          "diagram",
          diagram.id,
        );
        const project = yield* readProjectRecord(diagram.projectId);
        yield* sessions.ensureOwner(
          project.owner,
          session,
          "project",
          project.id,
        );

        return {
          diagram: diagramSummary(diagram),
          project: projectSummary(project),
        };
      },
    );

    const createFromArtifact = Effect.fn(
      "studioPersistence.projects.createFromArtifact",
    )(function* (input: {
      readonly artifactId: string;
      readonly session: StudioOwner;
    }) {
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
          yield* json.put(
            studioDiagramRecordKey(diagram.id),
            StudioDiagramRecordSchema,
            diagram,
          );
          yield* json.put(
            studioProjectRecordKey(project.id),
            StudioProjectRecordSchema,
            project,
          );
          yield* writeOwnerProjectEntry(input.session, project.id, createdAt);
        }),
        { artifactId: input.artifactId, projectId: project.id },
      );

      return {
        diagram: diagramSummary(diagram),
        diagramRecord: diagram,
        ok: true,
        project: projectSummary(project),
        projectRecord: project,
        urls: {
          diagram: studioDiagramUrl(diagram.id),
          edit: studioDiagramEditUrl(diagram.id),
          project: studioProjectUrl(project.id),
        },
      } satisfies StudioProjectCreateSuccess;
    });

    return {
      createFromArtifact: (input) =>
        observeStudioPersistence(
          "createFromArtifact",
          { artifactId: input.artifactId },
          createFromArtifact(input),
        ),
      getDiagram: (session, diagramId) =>
        observeStudioPersistence(
          "getDiagram",
          {},
          getDiagram(session, diagramId),
        ),
      getProject: (session, projectId) =>
        observeStudioPersistence(
          "getProject",
          { projectId },
          getProject(session, projectId),
        ),
      listProjects: (session) =>
        observeStudioPersistence("listProjects", {}, listProjects(session)),
    };
  }),
);

export function makeStudioPersistencePolicyLayer(
  config: StudioPersistencePolicyConfig,
) {
  return Layer.succeed(
    StudioPersistencePolicy,
    validateStudioPersistencePolicy(config),
  );
}

export function makeStudioPersistencePolicyTestLayer(
  config: StudioPersistencePolicyConfig,
) {
  return makeStudioPersistencePolicyLayer(config);
}

export function makeStudioRecordFactoryLayer(
  factory: StudioRecordFactoryShape,
) {
  return Layer.succeed(StudioRecordFactory, factory);
}

export function makeStudioRecordFactoryTestLayer(
  factory: StudioRecordFactoryShape,
) {
  return makeStudioRecordFactoryLayer(factory);
}
