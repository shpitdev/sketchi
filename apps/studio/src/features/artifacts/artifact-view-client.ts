import { CanvasSpec } from "@sketchi/drawing";
import { Effect, Schema, Result } from "effect";
import { HttpClient, HttpClientRequest } from "effect/http";
import { HttpApiClient } from "effect/http-api";
import { AsyncResult, Atom } from "effect/reactivity";
import { projectsRuntime, StudioRequestError } from "../projects/client";
import { DiagramsHttpApi } from "@sketchi/diagrams/http-api";
import { type ArtifactProvenance } from "@sketchi/drawing/artifacts";

export type ArtifactViewState = AsyncResult.AsyncResult<ArtifactReview, unknown>;

export interface ArtifactReview {
	provenance?: ArtifactProvenance;
	scene: CanvasSpec;
}

export interface ArtifactRouteUrls {
	drawing: string;
	edit: string;
	review: string;
	scene: string;
}

export function artifactRouteUrls(artifactId: string): ArtifactRouteUrls {
	const encoded = encodeURIComponent(artifactId);
	return {
		drawing: `/api/v1/artifacts/${encoded}?format=excalidraw&raw=true`,
		edit: `/artifacts/${encoded}/edit`,
		review: `/artifacts/${encoded}`,
		scene: `/api/v1/artifacts/${encoded}?format=scene&raw=true`,
	};
}

export const loadArtifactReview = Effect.fn("Studio.artifact.review")(function* (
	artifactId: string,
) {
	const client = yield* HttpApiClient.make(DiagramsHttpApi, {
		transformClient: HttpClient.mapRequest(HttpClientRequest.prependUrl(window.location.origin)),
	});
	const artifact = yield* client.canvas
		.getArtifact({ params: { artifactId }, query: { format: "scene", inline: "true" } })
		.pipe(
			Effect.mapError(
				(cause) => new StudioRequestError({ message: "Artifact could not be loaded.", cause }),
			),
		);
	const parsed = Schema.decodeUnknownResult(CanvasSpec, { errors: "all" })(artifact.inline);
	if (!Result.isSuccess(parsed))
		return yield* new StudioRequestError({ message: "Artifact scene could not be rendered." });
	return {
		scene: parsed.success,
		...(artifact.provenance ? { provenance: artifact.provenance } : {}),
	};
});
export const artifactReview = Atom.family((artifactId: string) =>
	projectsRuntime
		.atom(loadArtifactReview(artifactId))
		.pipe(Atom.setIdleTTL(0), Atom.withServerValueInitial),
);
