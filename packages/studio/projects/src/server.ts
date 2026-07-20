import { Effect, Layer } from "effect";
import { nanoid } from "nanoid";

import {
  makeStudioObjectStoreLayer,
  type StudioObjectBucket,
} from "./server/bucket.js";
import {
  handleCreateFromArtifactRequestEffect,
  handleGetDiagramRequestEffect,
  handleGetProjectRequestEffect,
  handleListProjectsRequestEffect,
  type StudioProjectsHttpHandlers,
} from "./server/http.js";
import {
  makeStudioPersistencePolicyLayer,
  makeStudioRecordFactoryLayer,
  StudioPersistencePolicyLive,
  type StudioProjects,
  StudioProjectsLive,
  StudioRecordFactoryLive,
} from "./server/service.js";
import {
  type StudioSessionService,
  StudioSessionServiceLive,
} from "./server/session.js";
import {
  makeStudioSourceArtifactStoreLayer,
  type StudioSourceArtifacts,
} from "./server/source-artifacts.js";

export * from "./contracts.js";
export * from "./server/bucket.js";
export * from "./server/errors.js";
export * from "./server/http.js";
export * from "./server/service.js";
export * from "./server/session.js";
export * from "./server/source-artifacts.js";

export interface StudioProjectsServerOptions {
  readonly bucket: StudioObjectBucket;
  readonly createId?: (kind: "dia" | "proj") => string;
  readonly listingConcurrency?: number;
  readonly now?: () => string;
  readonly sourceArtifacts: StudioSourceArtifacts;
}

export type StudioProjectsServer = StudioProjectsHttpHandlers;

/**
 * Current Playground Promise host edge. Persistence and HTTP workflows remain
 * Effect-native behind this one runtime bridge until issue #243 owns app wiring.
 */
export function createStudioProjectsServer(
  options: StudioProjectsServerOptions,
): StudioProjectsServer {
  const objectStoreLayer = makeStudioObjectStoreLayer(options.bucket);
  const sourceArtifactLayer = makeStudioSourceArtifactStoreLayer(
    options.sourceArtifacts,
  );
  const policyLayer =
    options.listingConcurrency !== undefined
      ? makeStudioPersistencePolicyLayer({
          listingConcurrency: options.listingConcurrency,
        })
      : StudioPersistencePolicyLive;
  const recordFactoryLayer =
    options.createId || options.now
      ? makeStudioRecordFactoryLayer({
          createId: options.createId ?? ((kind) => `${kind}_${nanoid(14)}`),
          now: options.now ?? (() => new Date().toISOString()),
        })
      : StudioRecordFactoryLive;
  const dependencies = Layer.mergeAll(
    objectStoreLayer,
    sourceArtifactLayer,
    policyLayer,
    recordFactoryLayer,
    StudioSessionServiceLive,
  );
  const appLayer = StudioProjectsLive.pipe(Layer.provideMerge(dependencies));
  const run = (
    effect: Effect.Effect<
      Response,
      never,
      StudioProjects | StudioSessionService
    >,
    signal: AbortSignal,
  ) =>
    Effect.runPromise(effect.pipe(Effect.provide(appLayer)), {
      signal,
    });

  return {
    handleCreateFromArtifactRequest: (request) =>
      run(handleCreateFromArtifactRequestEffect(request), request.signal),
    handleGetDiagramRequest: (request, diagramId) =>
      run(handleGetDiagramRequestEffect(request, diagramId), request.signal),
    handleGetProjectRequest: (request, projectId) =>
      run(handleGetProjectRequestEffect(request, projectId), request.signal),
    handleListProjectsRequest: (request) =>
      run(handleListProjectsRequestEffect(request), request.signal),
  };
}
