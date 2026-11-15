import { Cause, Effect, Layer, Schema, Stream } from "effect";
import { FetchHttpClient, HttpClient, HttpClientError, HttpClientRequest } from "effect/http";
import { AsyncResult, Atom, AtomHttpApi } from "effect/reactivity";

import { StudioHttpApi, StudioHttpFailure } from "./http-api";
import { StudioRecordIdSchema } from "./contracts";

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
		.atom(
			Effect.gen(function* () {
				const id = yield* Schema.decodeUnknownEffect(StudioRecordIdSchema)(projectId);
				const api = yield* StudioApi;
				return yield* api.projects.project({ params: { projectId: id } });
			}),
		)
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
	const failed = Cause.squash(result.cause);
	const error = Schema.is(StudioHttpFailure)(failed) ? failed.body : failed;
	if (HttpClientError.isHttpClientError(error) || Schema.isSchemaError(error)) return fallback;
	return typeof error === "object" &&
		error !== null &&
		"message" in error &&
		typeof error.message === "string"
		? error.message
		: fallback;
}
