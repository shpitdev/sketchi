import { Context, Effect, Layer } from "effect";

import { StudioSourceArtifactError } from "./errors.js";

export interface StudioSourceArtifact {
  diagramId: string;
  title: string;
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

export function makeStudioSourceArtifactStoreTestLayer(
  service: StudioSourceArtifactStoreShape,
) {
  return Layer.succeed(StudioSourceArtifactStore, service);
}
