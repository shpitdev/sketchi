import "@tanstack/react-start/server-only";

import { CodeModeArtifactStorage } from "@sketchi/diagrams/build/code-mode/artifacts";
import { CodeModeRuntimeEnvironment, getArtifact } from "@sketchi/diagrams/build/code-mode/runtime";
import { RenderedDiagramSceneSchema } from "@sketchi/diagrams/build/code-mode/contract";
import {
	makeStudioObjectStoreLayer,
	MemoryStudioObjectBucket,
} from "../../features/projects/bucket.server";
import { makeIsoDateString, makeStudioRecordId } from "../../features/projects/contracts";
import { studioHttp } from "../../features/projects/http.server";
import {
	makeStudioRecordFactoryLayer,
	StudioProjectsLive,
} from "../../features/projects/service.server";
import { makeStudioSessionServiceLayer } from "../../features/projects/session.server";
import { StudioSourceArtifactError } from "../../features/projects/errors.server";
import { StudioSourceArtifactStore } from "../../features/projects/source-artifacts.server";
import { HttpServerRequest, HttpServerResponse } from "effect/http";
import { Context, Effect, Layer, Schema, Result } from "effect";

import { artifactStoreForBindings } from "../../features/build/capabilities.server";
import { PlaygroundBindings, PlaygroundClock, PlaygroundIds } from "../runtime/context.server";

export class PlaygroundStudioLocalBucket extends Context.Service<
	PlaygroundStudioLocalBucket,
	MemoryStudioObjectBucket
>()("@sketchi/playground/PlaygroundStudioLocalBucket") {}

export const PlaygroundStudioLocalBucketLive = Layer.effect(
	PlaygroundStudioLocalBucket,
	Effect.sync(() => new MemoryStudioObjectBucket()),
);

export class PlaygroundStudio extends Context.Service<
	PlaygroundStudio,
	{
		readonly handle: (request: Request) => Effect.Effect<Response, never, PlaygroundBindings>;
	}
>()("@sketchi/studio/ProjectsHttp") {}

export const PlaygroundStudioLayer = Layer.effect(
	PlaygroundStudio,
	Effect.gen(function* () {
		const clock = yield* PlaygroundClock;
		const localStorage = yield* CodeModeArtifactStorage;
		const ids = yield* PlaygroundIds;
		const localBucket = yield* PlaygroundStudioLocalBucket;

		// These services are stateless. Each request owns its binding-specific layer;
		// no retained bucket cache or alternate request controller is needed.
		return PlaygroundStudio.of({
			handle: Effect.fn("studio.projects.http")(function* (request: Request) {
				const env = yield* PlaygroundBindings;
				const storage = artifactStoreForBindings(env, localStorage);
				const sourceArtifacts = StudioSourceArtifactStore.of({
					load: Effect.fn("playground.studio.sourceArtifact.load")(function* (artifactId: string) {
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
						const scene = Schema.decodeUnknownResult(RenderedDiagramSceneSchema, {
							errors: "all",
							reportInput: true,
						})(artifact.inline);
						if (!Result.isSuccess(scene)) {
							return yield* StudioSourceArtifactError.make({
								artifactId,
								code: "invalid_scene",
								message: `Playground artifact "${artifactId}" does not include a renderable scene.`,
								status: 422,
							});
						}
						return {
							diagramId: artifact.diagramId,
							title: scene.success.title,
						};
					}),
				});
				const dependencies = Layer.mergeAll(
					makeStudioRecordFactoryLayer({
						createId: (kind) => makeStudioRecordId(ids.create(kind)),
						now: clock.nowIso.pipe(Effect.map(makeIsoDateString)),
					}),
					makeStudioSessionServiceLayer({ createSessionId: () => ids.create("anon") }),
					makeStudioObjectStoreLayer(env.SKETCHI_ARTIFACTS ?? localBucket),
					Layer.succeed(StudioSourceArtifactStore, sourceArtifacts),
				);
				return yield* Effect.scoped(
					Effect.gen(function* () {
						const http = yield* studioHttp;
						const response = yield* http.pipe(
							Effect.provideService(
								HttpServerRequest.HttpServerRequest,
								HttpServerRequest.fromWeb(request),
							),
						);
						return HttpServerResponse.toWeb(response);
					}),
				).pipe(
					// @effect-diagnostics-next-line strictEffectProvide:off -- This HTTP entry point owns the request binding, native router and stateless projects layer in one scope.
					Effect.provide(StudioProjectsLive.pipe(Layer.provideMerge(dependencies))),
					Effect.catch(() =>
						Effect.succeed(
							Response.json(
								{ ok: false, code: "storage_failed", message: "Studio persistence failed." },
								{ status: 500, headers: { "Cache-Control": "no-store" } },
							),
						),
					),
				);
			}),
		});
	}),
);

export const handleStudioProjectsRequest = Effect.fn("studio.projects.request")(function* (
	request: Request,
) {
	const studio = yield* PlaygroundStudio;
	return yield* studio.handle(request);
});
