import { Context, Effect, Layer } from "effect";

import { failureMessage, StudioSourceArtifactError } from "./errors.js";

export interface StudioSourceArtifact {
  diagramId: string;
  title: string;
}

export interface StudioSourceArtifactLoadFailure {
  code: string;
  message: string;
  ok: false;
  status: number;
}

export interface StudioSourceArtifactLoadSuccess {
  artifact: StudioSourceArtifact;
  ok: true;
}

export type StudioSourceArtifactLoadResult =
  | StudioSourceArtifactLoadSuccess
  | StudioSourceArtifactLoadFailure;

/** Promise host contract retained only for the current Playground runtime edge. */
export interface StudioSourceArtifacts {
  load(
    artifactId: string,
    signal?: AbortSignal,
  ): Promise<StudioSourceArtifactLoadResult>;
}

export interface StudioSourceArtifactStoreShape {
  readonly load: (
    artifactId: string,
  ) => Effect.Effect<StudioSourceArtifact, StudioSourceArtifactError>;
}

export class StudioSourceArtifactStore extends Context.Service<
  StudioSourceArtifactStore,
  StudioSourceArtifactStoreShape
>()("@sketchi/studio-projects/StudioSourceArtifactStore") {}

export function makeStudioSourceArtifactStoreLayer(
  sourceArtifacts: StudioSourceArtifacts,
) {
  return Layer.succeed(StudioSourceArtifactStore, {
    load: Effect.fn("studioPersistence.sourceArtifact.load")(function* (
      artifactId: string,
    ) {
      const result = yield* Effect.tryPromise({
        try: (signal) => sourceArtifacts.load(artifactId, signal),
        catch: (cause) =>
          StudioSourceArtifactError.make({
            artifactId,
            cause,
            code: "storage_failed",
            message: failureMessage(
              cause,
              `Playground artifact "${artifactId}" could not be loaded.`,
            ),
            status: 500,
          }),
      });

      if (!result.ok) {
        return yield* Effect.fail(
          StudioSourceArtifactError.make({
            artifactId,
            code: result.code,
            message: result.message,
            status: result.status,
          }),
        );
      }

      return result.artifact;
    }),
  });
}

export function makeStudioSourceArtifactStoreTestLayer(
  service: StudioSourceArtifactStoreShape,
) {
  return Layer.succeed(StudioSourceArtifactStore, service);
}
