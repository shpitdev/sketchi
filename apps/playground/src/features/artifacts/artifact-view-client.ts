import { CanvasSpec } from "@sketchi/drawing";
import { Effect, Schema, Result } from "effect";
import { HttpClient } from "effect/http";
import { AsyncResult, Atom } from "effect/reactivity";
import { projectsRuntime, StudioRequestError } from "../projects/client";
import { type GetArtifactResult } from "@sketchi/diagrams/build/code-mode/contract";
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

function isGetArtifactResult(value: unknown): value is GetArtifactResult {
	return Boolean(value) && typeof value === "object";
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
	const client = yield* HttpClient.HttpClient;
	const response = yield* client.get(
		new URL(
			`/api/v1/artifacts/${encodeURIComponent(artifactId)}?format=scene&inline=true`,
			window.location.origin,
		).href,
	);
	if (response.status < 200 || response.status >= 300)
		return yield* new StudioRequestError({ message: "Artifact could not be loaded." });
	const payload: unknown = yield* response.json.pipe(
		Effect.mapError(
			(cause) => new StudioRequestError({ message: "Artifact could not be loaded.", cause }),
		),
	);
	if (!isGetArtifactResult(payload) || !payload.ok)
		return yield* new StudioRequestError({ message: "Artifact could not be loaded." });
	const parsed = Schema.decodeUnknownResult(CanvasSpec, { errors: "all" })(payload.inline);
	if (!Result.isSuccess(parsed))
		return yield* new StudioRequestError({ message: "Artifact scene could not be rendered." });
	return {
		scene: parsed.success,
		...(payload.provenance ? { provenance: payload.provenance } : {}),
	};
});
export const artifactReview = Atom.family((artifactId: string) =>
	projectsRuntime
		.atom(loadArtifactReview(artifactId))
		.pipe(Atom.setIdleTTL(0), Atom.withServerValueInitial),
);
