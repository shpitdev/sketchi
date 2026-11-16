import { CommunityHttpApi, type CommunityPublished } from "@sketchi/community-icons/http-api";
import { Duration, Effect, Schedule, String } from "effect";
import { FetchHttpClient, HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";
import { HttpApiClient } from "effect/http-api";

import { CliIconError } from "./errors";
import { boundedResponse } from "./response-body";

export type PublishedIcon = Pick<typeof CommunityPublished.Type, "slug" | "url" | "created">;
const decodePublished = HttpApiClient.decodeResponse(CommunityHttpApi, {
	group: "community",
	endpoint: "publish",
});
interface Attempt {
	readonly response: HttpClientResponse.HttpClientResponse;
	readonly wait: number | undefined;
}
const retryPolicy = Schedule.recurs(3).pipe(
	Schedule.addDelay(({ input }: Schedule.Metadata<number, Attempt>) =>
		Effect.succeed(Duration.seconds(input.wait ?? 0)),
	),
);

/** Generated community transport; the draw endpoint and filesystem flow retain their owners. */
export const publishIcon = Effect.fn("sketchi.cli.icon.publish")(function* (
	endpoint: string,
	icon: {
		readonly name: string;
		readonly recipe: unknown;
		readonly judge: { readonly recognizable: boolean; readonly model?: string };
	},
) {
	const failed = (message: string, details: readonly string[] = []) =>
		new CliIconError({
			code: "publish_failed",
			message,
			hint: "Publish it later with --publish, or share the .excalidrawlib.",
			details: [...details],
		});
	const unreadable = () => failed("The community store returned an unreadable response.");
	const network = () => failed("The community icon store could not be reached.");
	const client = yield* HttpApiClient.make(CommunityHttpApi, {
		transformClient: (http) =>
			http.pipe(
				HttpClient.mapRequest((request) =>
					request.pipe(
						HttpClientRequest.setUrl(endpoint),
						HttpClientRequest.setHeader("x-sketchi-client", "sketchi-cli"),
					),
				),
			),
	});
	const attempt = Effect.gen(function* () {
		const response = yield* client.community
			.publish({
				payload: {
					name: icon.name,
					recipe: icon.recipe,
					verdict: {
						recognizable: icon.judge.recognizable,
						...(icon.judge.model ? { judge: String.slice(0, 64)(icon.judge.model) } : {}),
					},
				},
				responseMode: "response-only",
			})
			.pipe(Effect.mapError(network));
		const bounded = yield* boundedResponse(response, 64 * 1024, unreadable, network);
		const rawWait = response.headers["retry-after"];
		const wait = rawWait ? Number(rawWait) : undefined;
		return {
			response: bounded,
			wait: wait !== undefined && Number.isFinite(wait) && wait >= 0 ? wait : undefined,
		} satisfies Attempt;
	}).pipe(
		Effect.timeoutOrElse({
			duration: "30 seconds",
			orElse: () => Effect.fail(failed("The community store did not answer in time.")),
		}),
	);
	const { response } = yield* attempt.pipe(
		Effect.repeat({
			schedule: retryPolicy,
			while: ({ response, wait }) => response.status === 429 && wait !== undefined && wait <= 90,
		}),
	);
	return yield* decodePublished(response).pipe(
		Effect.map(({ slug, url, created }): PublishedIcon => ({ slug, url, created })),
		Effect.mapError((error) => {
			if (response.status >= 200 && response.status < 300) return unreadable();
			return "error" in error
				? failed(error.error.message, [`http_status:${response.status}`, error.error.code])
				: failed(`The community store answered HTTP ${response.status}.`, [
						`http_status:${response.status}`,
					]);
		}),
	);
	// @effect-diagnostics-next-line strictEffectProvide:off -- CLI publish is the outgoing network entry point and owns its Fetch transport.
}, Effect.provide(FetchHttpClient.layer));
