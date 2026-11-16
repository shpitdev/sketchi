import { Context, Effect, Layer, Schema } from "effect";
import { Aead, SecureRandom } from "effect/crypto";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import { CliShareError } from "../errors";
import { readBoundedBody, readBoundedText } from "../response-body";
import {
	EXCALIDRAW_GET_ENDPOINT,
	EXCALIDRAW_POST_ENDPOINT,
	MAX_POST_RESPONSE_BYTES,
	MAX_SHARE_BODY_BYTES,
	OPENER_WAIT_MS,
	SHARE_BACKEND_TIMEOUT_MS,
	decodeSharePayload,
	encodeSharePayload,
	formatShareLink,
	generateShareKey,
	parseShareLink,
	serializeForShare,
} from "./protocol";

export interface OpenResult {
	readonly status: "not_requested" | "accepted" | "unconfirmed";
	readonly reason?: "missing_executable" | "nonzero_exit" | "timeout";
}

function shareFailure(
	code: "share_transport_failed" | "share_timeout" | "share_api_changed" | "share_link_unavailable",
	message: string,
	hint: string,
) {
	return CliShareError.make({ code, message, hint, details: [] });
}

function timeoutFailure() {
	return shareFailure(
		"share_timeout",
		"The Excalidraw storage request timed out.",
		"Retry once. The unofficial third-party backend may be unavailable.",
	);
}

function transportFailure() {
	return shareFailure(
		"share_transport_failed",
		"The Excalidraw storage request failed.",
		"Retry once. The unofficial third-party backend may be unavailable.",
	);
}

const request = Effect.fn("sketchi.cli.share.request")(function* (url: string, init: RequestInit) {
	return yield* Effect.tryPromise({
		try: (signal) => fetch(url, { ...init, redirect: "error", signal }),
		catch: transportFailure,
	});
});

const decodeUploadResponse = Schema.decodeUnknownEffect(
	Schema.Struct({ id: Schema.String, data: Schema.String }),
);
const decodeUploadJson = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown));

function apiChangedFailure() {
	return shareFailure(
		"share_api_changed",
		"The Excalidraw storage API returned an unexpected response.",
		"The unofficial API may have changed; update Sketchi compatibility before retrying.",
	);
}

export class ShareTransport extends Context.Service<
	ShareTransport,
	{
		readonly upload: (body: Uint8Array) => Effect.Effect<string, CliShareError>;
		readonly download: (id: string) => Effect.Effect<Uint8Array, CliShareError>;
	}
>()("@sketchi/cli/ShareTransport") {}

export const ShareTransportLive = Layer.succeed(ShareTransport, {
	upload: Effect.fn("sketchi.cli.share.transport.upload")(
		function* (body: Uint8Array) {
			const response = yield* request(EXCALIDRAW_POST_ENDPOINT, {
				method: "POST",
				body: Uint8Array.from(body),
			});
			const text = yield* readBoundedText(response, MAX_POST_RESPONSE_BYTES, transportFailure);
			if (!response.ok) return yield* transportFailure();
			const parsed = yield* decodeUploadJson(text).pipe(Effect.mapError(transportFailure));
			const value = yield* decodeUploadResponse(parsed).pipe(Effect.mapError(apiChangedFailure));
			if (
				!/^[A-Za-z0-9_-]{1,128}$/.test(value.id) ||
				value.data !== `${EXCALIDRAW_GET_ENDPOINT}${value.id}`
			) {
				return yield* apiChangedFailure();
			}
			return value.id;
		},
		Effect.timeoutOrElse({
			duration: SHARE_BACKEND_TIMEOUT_MS,
			orElse: () => Effect.fail(timeoutFailure()),
		}),
	),
	download: Effect.fn("sketchi.cli.share.transport.download")(
		function* (id: string) {
			const response = yield* request(`${EXCALIDRAW_GET_ENDPOINT}${id}`, {
				method: "GET",
			});
			if (response.status === 404) {
				return yield* shareFailure(
					"share_link_unavailable",
					"The Excalidraw share link is unavailable.",
					"Verify the complete bearer link or ask its sender to export a new link.",
				);
			}
			if (!response.ok) return yield* transportFailure();
			return yield* readBoundedBody(response, MAX_SHARE_BODY_BYTES, transportFailure);
		},
		Effect.timeoutOrElse({
			duration: SHARE_BACKEND_TIMEOUT_MS,
			orElse: () => Effect.fail(timeoutFailure()),
		}),
	),
});

export class LinkOpener extends Context.Service<
	LinkOpener,
	{ readonly open: (link: string) => Effect.Effect<OpenResult> }
>()("@sketchi/cli/LinkOpener") {}

function openerCommand(
	link: string,
	platform: NodeJS.Platform,
): {
	readonly command: string;
	readonly args: ReadonlyArray<string>;
} {
	switch (platform) {
		case "darwin":
			return { command: "open", args: [link] };
		case "win32":
			return {
				command: "cmd.exe",
				args: ["/d", "/s", "/c", "start", "", link],
			};
		default:
			return { command: "xdg-open", args: [link] };
	}
}

/**
 * Runs the platform opener with the link as an argument, never through a shell. A clean exit
 * releases the opener's process group so a browser it started keeps running; a failed exit,
 * timeout or interruption terminates the whole group, TERM then KILL.
 */
export function makeLinkOpenerLayer(
	platform: NodeJS.Platform = process.platform,
	waitMs: number = OPENER_WAIT_MS,
) {
	return Layer.effect(
		LinkOpener,
		Effect.gen(function* () {
			const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
			const open = Effect.fn("sketchi.cli.share.openLink")(function* (link: string) {
				const target = openerCommand(link, platform);
				const run = Effect.scoped(
					Effect.gen(function* () {
						const spawned = yield* Effect.result(
							ChildProcess.make(target.command, target.args, {
								stdin: "ignore",
								stdout: "ignore",
								stderr: "ignore",
								killSignal: "SIGTERM",
								forceKillAfter: "250 millis",
							}),
						);
						if (spawned._tag === "Failure") {
							return { status: "unconfirmed", reason: "missing_executable" } satisfies OpenResult;
						}
						const handle = spawned.success;
						// A signal exit has no code and fails exitCode; both are a failed opener.
						const code = yield* handle.exitCode.pipe(Effect.orElseSucceed(() => undefined));
						if (code !== 0) {
							return { status: "unconfirmed", reason: "nonzero_exit" } satisfies OpenResult;
						}
						// The returned re-reference is never needed: the opener has already exited.
						yield* Effect.ignore(handle.unref);
						return { status: "accepted" } satisfies OpenResult;
					}),
				);
				return yield* run.pipe(
					Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
					Effect.timeoutOrElse({
						duration: waitMs,
						orElse: () => Effect.succeed<OpenResult>({ status: "unconfirmed", reason: "timeout" }),
					}),
				);
			});
			return LinkOpener.of({ open });
		}),
	);
}

export const LinkOpenerLive = makeLinkOpenerLayer();

export class ExcalidrawShare extends Context.Service<
	ExcalidrawShare,
	{
		readonly share: (artifact: unknown) => Effect.Effect<{ readonly link: string }, CliShareError>;
		readonly pull: (link: string) => Effect.Effect<unknown, CliShareError>;
	}
>()("@sketchi/cli/ExcalidrawShare") {}

export const ExcalidrawShareLive = Layer.effect(
	ExcalidrawShare,
	Effect.gen(function* () {
		const transport = yield* ShareTransport;
		const crypto = yield* Effect.context<Aead.Aead | SecureRandom.SecureRandom>();
		const share = Effect.fn("sketchi.cli.share.upload")(function* (artifact: unknown) {
			const serialized = yield* serializeForShare(artifact);
			const key = yield* generateShareKey.pipe(Effect.provideContext(crypto));
			const body = yield* encodeSharePayload(serialized, key).pipe(Effect.provideContext(crypto));
			const id = yield* transport.upload(body);
			return { link: formatShareLink({ id, key }) };
		});
		const pull = Effect.fn("sketchi.cli.share.pull")(function* (link: string) {
			const parts = yield* parseShareLink(link);
			const body = yield* transport.download(parts.id);
			return yield* decodeSharePayload(body, parts.key).pipe(Effect.provideContext(crypto));
		});
		return { share, pull };
	}),
);
