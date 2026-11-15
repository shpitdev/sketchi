import { Context, Effect } from "effect";

import { StudioSourceArtifactError } from "./errors.server.js";

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
>()("@sketchi/studio/projects/StudioSourceArtifactStore") {}
