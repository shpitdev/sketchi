import "@tanstack/react-start/server-only";

import {
  CodeModeArtifactStorage,
  CodeModeRuntimeEnvironment,
  getArtifact,
  RenderedDiagramSceneSchema,
} from "@sketchi/diagram-agent";
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
  StudioProjects,
  StudioSessionService,
  StudioProjectsLive,
  StudioSourceArtifactError,
  StudioSourceArtifactStore,
  type StudioObjectBucket,
} from "@sketchi/studio-projects/server";
import { Context, Effect, Layer } from "effect";

import { artifactStoreForBindings } from "../codemode/service.server";
import {
  PlaygroundBindings,
  PlaygroundClock,
  PlaygroundIds,
} from "../runtime/context.server";

export class PlaygroundStudioLocalBucket extends Context.Service<
  PlaygroundStudioLocalBucket,
  MemoryStudioObjectBucket
>()("@sketchi/playground/PlaygroundStudioLocalBucket") {}

export const PlaygroundStudioLocalBucketLive = Layer.effect(
  PlaygroundStudioLocalBucket,
  Effect.sync(() => new MemoryStudioObjectBucket()),
);

export interface PlaygroundStudioShape {
  readonly createFromArtifact: (
    request: Request,
  ) => Effect.Effect<Response, never, PlaygroundBindings>;
  readonly getDiagram: (
    request: Request,
    diagramId: string,
  ) => Effect.Effect<Response, never, PlaygroundBindings>;
  readonly getProject: (
    request: Request,
    projectId: string,
  ) => Effect.Effect<Response, never, PlaygroundBindings>;
  readonly listProjects: (
    request: Request,
  ) => Effect.Effect<Response, never, PlaygroundBindings>;
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
    const localStorage = yield* CodeModeArtifactStorage;
    const ids = yield* PlaygroundIds;
    const localBucket = yield* PlaygroundStudioLocalBucket;

    const scope = yield* Effect.scope;
    const dependencies = yield* Layer.build(
      Layer.mergeAll(
        StudioPersistencePolicyLive,
        makeStudioRecordFactoryLayer({
          createId: (kind) => makeStudioRecordId(ids.create(kind)),
          now: clock.nowIso.pipe(Effect.map(makeIsoDateString)),
        }),
        makeStudioSessionServiceLayer({
          createSessionId: () => ids.create("anon"),
        }),
      ),
    );
    const session = Context.get(dependencies, StudioSessionService);
    const servicesByBucket = new WeakMap<
      object,
      Effect.Effect<Context.Context<StudioProjects>>
    >();

    const studioServicesForBindings = Effect.fn(
      "playground.studio.servicesForBindings",
    )(function* (env: Context.Service.Shape<typeof PlaygroundBindings>) {
      const binding = env.SKETCHI_ARTIFACTS ?? localBucket;
      let services = servicesByBucket.get(binding);
      if (!services) {
        const storage = artifactStoreForBindings(env, localStorage);
        const sourceArtifacts = StudioSourceArtifactStore.of({
          load: Effect.fn("playground.studio.sourceArtifact.load")(function* (
            artifactId: string,
          ) {
            // Source persistence consumes only the stored scene and diagram id;
            // HTTP URL/correlation metadata is not part of this lookup.
            const artifact = yield* getArtifact({
              artifactId,
              format: "scene",
              inline: true,
            }).pipe(
              Effect.provideService(CodeModeArtifactStorage, storage),
              Effect.provideService(CodeModeRuntimeEnvironment, {
                createId: ids.create,
              }),
            );
            if (!artifact.ok) {
              return yield* StudioSourceArtifactError.make({
                artifactId,
                code: artifact.status,
                message: `Playground artifact "${artifactId}" is not available for Studio persistence.`,
                status: artifact.status === "storage_failed" ? 500 : 404,
              });
            }
            const scene = RenderedDiagramSceneSchema.safeParse(artifact.inline);
            if (!scene.success) {
              return yield* StudioSourceArtifactError.make({
                artifactId,
                code: "invalid_scene",
                message: `Playground artifact "${artifactId}" does not include a renderable scene.`,
                status: 422,
              });
            }
            return { diagramId: artifact.diagramId, title: scene.data.title };
          }),
        });
        const appLayer = StudioProjectsLive.pipe(
          Layer.provide(
            Layer.merge(
              makeStudioObjectStoreLayer(
                studioBucketForBindings(env, localBucket),
              ),
              Layer.succeed(StudioSourceArtifactStore, sourceArtifacts),
            ),
          ),
        );
        services = yield* Effect.cached(
          Layer.buildWithScope(appLayer, scope).pipe(
            Effect.provide(dependencies),
          ),
        );
        servicesByBucket.set(binding, services);
      }
      return yield* services;
    });

    const runStudioHandler = Effect.fn(
      "playground.studio.provideRequestServices",
    )(function* (
      handler: Effect.Effect<
        Response,
        never,
        StudioProjects | StudioSessionService
      >,
    ) {
      const env = yield* PlaygroundBindings;
      const services = yield* studioServicesForBindings(env);
      return yield* handler.pipe(
        Effect.provide(services),
        Effect.provideService(StudioSessionService, session),
      );
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
