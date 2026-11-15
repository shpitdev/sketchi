import { Cause, Effect, Layer, Schema, Stream } from "effect";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http";
import { AsyncResult, Atom, AtomHttpApi } from "effect/reactivity";

import { StudioHttpApi } from "./http-api";

export class StudioApi extends AtomHttpApi.Service<StudioApi>()("StudioProjectsClient", {
	api: StudioHttpApi,
	httpClient: FetchHttpClient.layer,
	transformClient: HttpClient.mapRequest((request) =>
		HttpClientRequest.prependUrl(window.location.origin)(request),
	),
}) {}

export const projectsRuntime = Atom.runtime((get) =>
	Layer.merge(get(StudioApi.runtime.layer), FetchHttpClient.layer),
);

export class StudioRequestError extends Schema.TaggedError<
	StudioRequestError,
	{ readonly brand: unique symbol }
>()("StudioRequestError", { message: Schema.String, cause: Schema.optionalKey(Schema.Unknown) }) {}

export const projectsQuery = projectsRuntime
	.atom(Effect.flatMap(StudioApi, (api) => api.projects.list({})))
	.pipe(Atom.setIdleTTL(0), Atom.withServerValueInitial);

export const projectQuery = Atom.family((projectId: string) =>
	projectsRuntime
		.atom(Effect.flatMap(StudioApi, (api) => api.projects.project({ params: { projectId } })))
		.pipe(Atom.setIdleTTL(0), Atom.withServerValueInitial),
);

// A different artifact owns a different mutation, including its errors and scope.
export const createProject = Atom.family((artifactId: string) =>
	projectsRuntime
		.fn(() =>
			Stream.fromEffect(
				Effect.flatMap(StudioApi, (api) => api.projects.create({ payload: { artifactId } })),
			),
		)
		.pipe(
			Atom.setIdleTTL(0),
			Atom.withServerValue(() => AsyncResult.initial()),
		),
);

export function resourceError<A, E>(result: AsyncResult.AsyncResult<A, E>, fallback: string) {
	if (!AsyncResult.isFailure(result)) return fallback;
	const error = Cause.squash(result.cause);
	return typeof error === "object" &&
		error !== null &&
		"message" in error &&
		typeof error.message === "string"
		? error.message
		: fallback;
}
