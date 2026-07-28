import "@tanstack/react-start/server-only";

import { RenderedDiagramSceneSchema } from "@sketchi/diagram-agent";
import {
  handleCreateFromArtifactRequestEffect,
  handleGetDiagramRequestEffect,
  handleGetProjectRequestEffect,
  handleListProjectsRequestEffect,
  isStudioObjectBucket,
  makeIsoDateString,
  makeStudioRecordId,
  makeStudioObjectStoreLayer,
  makeStudioRecordFactoryLayer,
  makeStudioSessionServiceLayer,
  MemoryStudioObjectBucket,
  StudioPersistencePolicyLive,
  StudioProjectsLive,
  StudioSourceArtifactError,
  StudioSourceArtifactStore,
  type StudioObjectBucket,
} from "@sketchi/studio-projects/server";
import { Context, Effect, Layer } from "effect";

import { PlaygroundCodeMode } from "../codemode/service.server";
import {
  PlaygroundBindings,
  PlaygroundClock,
  PlaygroundIds,
  PlaygroundRequestMetadata,
} from "../runtime/context.server";

export class PlaygroundStudioLocalBucket extends Context.Service<
  PlaygroundStudioLocalBucket,
  MemoryStudioObjectBucket
>()("@sketchi/playground/PlaygroundStudioLocalBucket") {}

export const PlaygroundStudioLocalBucketLive = Layer.effect(
  PlaygroundStudioLocalBucket,
  Effect.sync(() => new MemoryStudioObjectBucket()),
);

type PlaygroundStudioRequestContext =
  | PlaygroundBindings
  | PlaygroundRequestMetadata;

export interface PlaygroundStudioShape {
  readonly createFromArtifact: (
    request: Request,
  ) => Effect.Effect<Response, never, PlaygroundStudioRequestContext>;
  readonly getDiagram: (
    request: Request,
    diagramId: string,
  ) => Effect.Effect<Response, never, PlaygroundStudioRequestContext>;
  readonly getProject: (
    request: Request,
    projectId: string,
  ) => Effect.Effect<Response, never, PlaygroundStudioRequestContext>;
  readonly listProjects: (
    request: Request,
  ) => Effect.Effect<Response, never, PlaygroundStudioRequestContext>;
}

export class PlaygroundStudio extends Context.Service<
  PlaygroundStudio,
  PlaygroundStudioShape
>()("@sketchi/playground/PlaygroundStudio") {}

function unavailableStudioBucket(): StudioObjectBucket {
  const unavailable = () =>
    new Error(
      "Studio persistence requires an object bucket with list support.",
    );
  return {
    async get() {
      throw unavailable();
    },
    async list() {
      throw unavailable();
    },
    async put() {
      throw unavailable();
    },
  };
}

function studioBucketForBindings(
  env: Context.Service.Shape<typeof PlaygroundBindings>,
  localBucket: MemoryStudioObjectBucket,
): StudioObjectBucket {
  const bucket = env.SKETCHI_ARTIFACTS ?? localBucket;
  return isStudioObjectBucket(bucket) ? bucket : unavailableStudioBucket();
}

export const PlaygroundStudioLayer = Layer.effect(
  PlaygroundStudio,
  Effect.gen(function* () {
    const clock = yield* PlaygroundClock;
    const codeMode = yield* PlaygroundCodeMode;
    const ids = yield* PlaygroundIds;
    const localBucket = yield* PlaygroundStudioLocalBucket;

    const runStudioHandler = Effect.fn(
      "playground.studio.provideRequestServices",
    )(function* (
      handler: Effect.Effect<
        Response,
        never,
        | import("@sketchi/studio-projects/server").StudioProjects
        | import("@sketchi/studio-projects/server").StudioSessionService
      >,
    ) {
      const env = yield* PlaygroundBindings;
      const metadata = yield* PlaygroundRequestMetadata;
      const sourceArtifactLayer = Layer.succeed(StudioSourceArtifactStore, {
        load: Effect.fn("playground.studio.sourceArtifact.load")(function* (
          artifactId: string,
        ) {
          const artifact = yield* codeMode
            .getArtifact({ artifactId, format: "scene", inline: true })
            .pipe(
              Effect.provideService(PlaygroundBindings, env),
              Effect.provideService(PlaygroundIds, ids),
              Effect.provideService(PlaygroundRequestMetadata, metadata),
            );
          if (!artifact.ok) {
            return yield* Effect.fail(
              StudioSourceArtifactError.make({
                artifactId,
                code: artifact.status,
                message: `Playground artifact "${artifactId}" is not available for Studio persistence.`,
                status: artifact.status === "storage_failed" ? 500 : 404,
              }),
            );
          }

          const scene = RenderedDiagramSceneSchema.safeParse(artifact.inline);
          if (!scene.success) {
            return yield* Effect.fail(
              StudioSourceArtifactError.make({
                artifactId,
                code: "invalid_scene",
                message: `Playground artifact "${artifactId}" does not include a renderable scene.`,
                status: 422,
              }),
            );
          }
          return {
            diagramId: artifact.diagramId,
            title: scene.data.title,
          };
        }),
      });
      const dependencies = Layer.mergeAll(
        makeStudioObjectStoreLayer(studioBucketForBindings(env, localBucket)),
        sourceArtifactLayer,
        StudioPersistencePolicyLive,
        makeStudioRecordFactoryLayer({
          createId: (kind) => makeStudioRecordId(ids.create(kind)),
          now: clock.nowIso.pipe(Effect.map(makeIsoDateString)),
        }),
        makeStudioSessionServiceLayer({
          createSessionId: () => ids.create("anon"),
        }),
      );
      const appLayer = StudioProjectsLive.pipe(
        Layer.provideMerge(dependencies),
      );
      return yield* handler.pipe(Effect.provide(appLayer));
    });

    return PlaygroundStudio.of({
      createFromArtifact: Effect.fn("playground.studio.createFromArtifact")(
        (request) =>
          runStudioHandler(handleCreateFromArtifactRequestEffect(request)),
      ),
      getDiagram: Effect.fn("playground.studio.getDiagram")(
        (request, diagramId) =>
          runStudioHandler(handleGetDiagramRequestEffect(request, diagramId)),
      ),
      getProject: Effect.fn("playground.studio.getProject")(
        (request, projectId) =>
          runStudioHandler(handleGetProjectRequestEffect(request, projectId)),
      ),
      listProjects: Effect.fn("playground.studio.listProjects")((request) =>
        runStudioHandler(handleListProjectsRequestEffect(request)),
      ),
    });
  }),
);

export const handleListStudioProjectsRequest = Effect.fn(
  "playground.http.studio.listProjects",
)(function* (request: Request) {
  const studio = yield* PlaygroundStudio;
  return yield* studio.listProjects(request);
});

export const handleCreateStudioProjectFromArtifactRequest = Effect.fn(
  "playground.http.studio.createFromArtifact",
)(function* (request: Request) {
  const studio = yield* PlaygroundStudio;
  return yield* studio.createFromArtifact(request);
});

export const handleGetStudioProjectRequest = Effect.fn(
  "playground.http.studio.getProject",
)(function* (request: Request, projectId: string) {
  const studio = yield* PlaygroundStudio;
  return yield* studio.getProject(request, projectId);
});

export const handleGetStudioDiagramRequest = Effect.fn(
  "playground.http.studio.getDiagram",
)(function* (request: Request, diagramId: string) {
  const studio = yield* PlaygroundStudio;
  return yield* studio.getDiagram(request, diagramId);
});
