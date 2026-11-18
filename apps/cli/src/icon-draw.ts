// @effect-diagnostics-next-line nodeBuiltinImport:off -- The CLI translates host paths synchronously before handing them to its filesystem adapter.
import { basename, extname, join, resolve } from "node:path";

import {
	ICON_DRAW_PATH,
	ICON_IMAGE_MAX_BYTES,
	ICON_NAME_MAX_LENGTH,
	IconDrawHttpApi,
	type IconDrawSuccess,
} from "@sketchi/icon-draw/http-api";
import { Clock, Duration, Effect, Result, Schedule } from "effect";
import { FetchHttpClient, HttpClient } from "effect/http";
import { HttpApiClient } from "effect/http-api";

import { publishIcon, type PublishedIcon } from "./community-client";
export { publishIcon } from "./community-client";
export type { PublishedIcon } from "./community-client";

import { type CliFailure, type CliFilesystemError, CliIconError } from "./errors";
import { LocalFileSystem } from "./filesystem";
import { oneShotJsonClient } from "./one-shot-json-client";
import { boundedResponse, MAX_API_RESPONSE_BYTES } from "./response-body";

export const DEFAULT_ICON_DRAW_ENDPOINT = `https://playground.sketchi.app${ICON_DRAW_PATH}`;
export const SKETCHI_ICON_DRAW_ENDPOINT_ENV = "SKETCHI_ICON_DRAW_ENDPOINT";
export const DEFAULT_COMMUNITY_ENDPOINT = "https://icons.sketchi.app/api/community";
export const SKETCHI_COMMUNITY_ENDPOINT_ENV = "SKETCHI_COMMUNITY_ENDPOINT";

/** One draw attempt: the service answers within 85 s; this covers that and the upload. */
const ICON_DRAW_ATTEMPT_TIMEOUT = "120 seconds";
/** A rate-limited request waits for Retry-After up to this long, at most this many times. */
const MAX_RETRY_WAIT_SECONDS = 90;
const MAX_RATE_LIMIT_RETRIES = 3;
const decodeDraw = HttpApiClient.decodeResponse(IconDrawHttpApi, {
	group: "icons",
	endpoint: "draw",
});
const retryPolicy = Schedule.recurs(MAX_RATE_LIMIT_RETRIES).pipe(
	Schedule.addDelay(({ input }: Schedule.Metadata<number, { readonly wait: number | undefined }>) =>
		Effect.succeed(Duration.seconds(input.wait ?? 0)),
	),
);

const SOURCE_KINDS: Readonly<Record<string, "svg" | "image">> = {
	".svg": "svg",
	".png": "image",
	".jpg": "image",
	".jpeg": "image",
	".webp": "image",
};

export function resolveIconDrawEndpoint(): string {
	// @effect-diagnostics-next-line processEnv:off -- Endpoint overrides are read from the invoking CLI environment when selecting a remote host.
	return process.env[SKETCHI_ICON_DRAW_ENDPOINT_ENV]?.trim() || DEFAULT_ICON_DRAW_ENDPOINT;
}

export function resolveCommunityEndpoint(): string {
	// @effect-diagnostics-next-line processEnv:off -- Endpoint overrides are read from the invoking CLI environment when selecting a remote host.
	return process.env[SKETCHI_COMMUNITY_ENDPOINT_ENV]?.trim() || DEFAULT_COMMUNITY_ENDPOINT;
}

function iconError(
	code: CliIconError["code"],
	message: string,
	hint: string,
	details: readonly string[] = [],
): CliIconError {
	return CliIconError.make({ code, message, hint, details: [...details] });
}

/** A file's name as a logo name: `google-cloud_run.svg` is `google cloud run`. */
export function nameFromFile(path: string): string {
	return basename(path, extname(path))
		.replace(/[-_.]+/gu, " ")
		.replace(/\s+/gu, " ")
		.trim()
		.slice(0, ICON_NAME_MAX_LENGTH);
}

/** A name as a file stem: `Google Cloud Run` is `google-cloud-run`. */
export function fileStem(name: string): string {
	return (
		name
			.normalize("NFKD")
			.toLowerCase()
			.replace(/[^a-z0-9]+/gu, "-")
			.replace(/^-+|-+$/gu, "") || "icon"
	);
}

export interface IconSourceFile {
	readonly path: string;
	readonly name: string;
}

/** The logos a path names: one file, or every SVG, PNG, JPEG and WebP directly in a folder. */
export const iconSources = Effect.fn("sketchi.cli.icon.sources")(function* (
	path: string,
	name: string | undefined,
) {
	const fs = yield* LocalFileSystem;
	const kind = yield* fs.kind(path);
	if (kind === "missing") {
		return yield* iconError(
			"icon_input",
			`Nothing exists at ${path}.`,
			"Pass an SVG, PNG, JPEG or WebP file, or a folder of them.",
		);
	}
	if (kind === "directory") {
		if (name !== undefined) {
			return yield* iconError(
				"icon_input",
				"--name names one logo, and a folder holds several.",
				"Name each file after its logo, or draw the files one at a time.",
			);
		}
		const entries = yield* fs.list(path);
		const files = entries
			.filter((entry) => entry.kind === "file" && SOURCE_KINDS[extname(entry.name).toLowerCase()])
			.map((entry) => entry.name)
			.sort((left, right) => left.localeCompare(right));
		if (files.length === 0) {
			return yield* iconError(
				"icon_input",
				`${path} holds no SVG, PNG, JPEG or WebP files.`,
				"Put logo files directly in the folder.",
			);
		}
		return files.map(
			(file) => ({ path: join(path, file), name: nameFromFile(file) }) satisfies IconSourceFile,
		);
	}
	if (!SOURCE_KINDS[extname(path).toLowerCase()]) {
		return yield* iconError(
			"icon_input",
			`${path} is not an SVG, PNG, JPEG or WebP file.`,
			"Pass the logo as .svg, .png, .jpg or .webp.",
		);
	}
	const chosen = (name ?? nameFromFile(path)).trim();
	if (!chosen || chosen.length > ICON_NAME_MAX_LENGTH) {
		return yield* iconError(
			"icon_input",
			`The name must be 1-${ICON_NAME_MAX_LENGTH} characters.`,
			'Pass --name "Brand" with the logo\'s brand or product name.',
		);
	}
	return [{ path, name: chosen } satisfies IconSourceFile];
});

/** Ask the hosted service to draw one logo. */
export const requestIconDraw = Effect.fn("sketchi.cli.icon.draw")(function* (input: {
	readonly endpoint: string;
	readonly source: IconSourceFile;
	readonly model?: string;
}) {
	const fs = yield* LocalFileSystem;
	const bytes = yield* fs.readBytes(input.source.path);
	if (bytes.byteLength > ICON_IMAGE_MAX_BYTES) {
		return yield* iconError(
			"icon_input",
			`${input.source.path} is larger than ${ICON_IMAGE_MAX_BYTES / (1024 * 1024)} MB.`,
			"Send a smaller export of the logo; 512 px is plenty.",
		);
	}
	const kind = SOURCE_KINDS[extname(input.source.path).toLowerCase()];
	const payload = {
		name: input.source.name,
		...(kind === "svg"
			? { svg: new TextDecoder().decode(bytes) }
			: { image: Buffer.from(bytes).toString("base64") }),
		...(input.model ? { model: input.model } : {}),
	};
	const network = () =>
		iconError(
			"network_failure",
			"The Sketchi icon service could not be reached.",
			"Check your network connection and retry.",
		);
	const malformed = () =>
		iconError(
			"malformed_response",
			"The Sketchi icon service returned an unreadable response.",
			"Retry once; if it persists, report the logo.",
		);
	const http = yield* HttpClient.HttpClient;
	const client = yield* HttpApiClient.makeWith(IconDrawHttpApi, {
		httpClient: oneShotJsonClient(http, input.endpoint),
	});
	// The scope owns the whole exchange, including a body that stalls after headers arrive.
	const attempt = Effect.gen(function* () {
		const response = yield* client.icons
			.draw({ payload, responseMode: "response-only" })
			.pipe(Effect.mapError(network));
		if (response.status === 204 || response.status === 205 || response.status === 304) {
			return yield* malformed();
		}
		const bounded = yield* boundedResponse(response, MAX_API_RESPONSE_BYTES, malformed, network);
		const decoded = yield* decodeDraw(bounded).pipe(Effect.result);
		if (Result.isSuccess(decoded)) return { icon: decoded.success, wait: undefined };
		const refusal = decoded.failure;
		if (!("body" in refusal)) return yield* malformed();
		const rawWait = response.headers["retry-after"];
		const seconds = rawWait ? Number(rawWait) : NaN;
		// Only a decoded admission refusal is safe to replay. No redirects or ambiguous paid outcomes.
		const issueCode = refusal.body.issues[0].code;
		const wait =
			refusal.httpStatus === 429 &&
			(issueCode === "rate_limited" || issueCode === "daily_limit") &&
			seconds >= 0 &&
			seconds <= MAX_RETRY_WAIT_SECONDS
				? seconds
				: undefined;
		return { refusal, wait };
	}).pipe(
		Effect.scoped,
		Effect.timeoutOrElse({
			duration: ICON_DRAW_ATTEMPT_TIMEOUT,
			orElse: () =>
				Effect.fail(
					iconError(
						"icon_timeout",
						"The Sketchi icon service did not answer in time.",
						"Retry once.",
					),
				),
		}),
	);
	const answer = yield* attempt.pipe(
		Effect.repeat({ schedule: retryPolicy, while: ({ wait }) => wait !== undefined }),
	);
	if (answer.icon) return answer.icon;
	const {
		httpStatus,
		body: {
			issues: [issue],
		},
	} = answer.refusal;
	const code =
		httpStatus === 429
			? issue.code === "daily_limit"
				? "daily_limit"
				: "rate_limited"
			: httpStatus === 400 || httpStatus === 422
				? "icon_rejected"
				: httpStatus === 504
					? "icon_timeout"
					: "endpoint_failure";
	return yield* iconError(code, issue.message, issue.hint, [
		`http_status:${httpStatus}`,
		issue.code,
	]);
	// @effect-diagnostics-next-line strictEffectProvide:off -- This CLI adapter owns the Fetch transport.
}, Effect.provide(FetchHttpClient.layer));

export interface DrawnIcon {
	readonly name: string;
	readonly source: string;
	readonly files: readonly string[];
	readonly recognizable: boolean;
	readonly picked?: string;
	readonly rounds: number;
	readonly model: string;
	readonly ms: number;
	readonly published?: PublishedIcon;
	readonly publishError?: string;
}

export interface IconDrawFailureEntry {
	/** The logo file, or the pack, that did not finish. */
	readonly source: string;
	readonly code: CliIconError["code"] | "filesystem_error";
	readonly message: string;
}

export interface IconDrawRun {
	readonly icons: readonly DrawnIcon[];
	readonly failed: readonly IconDrawFailureEntry[];
	/** One library holding every icon written, when a folder was drawn. */
	readonly pack?: string;
}

/**
 * A file stem for each logo and the pack, distinct within the run: the pack keeps the folder's
 * name, and a logo whose stem is taken (acme.svg beside acme.png, or logos/logos.svg beside the
 * logos pack) gets the next free `-2`, `-3`.
 */
export function reserveStems(
	names: readonly string[],
	packStem: string | undefined,
): readonly string[] {
	const taken = new Set(packStem === undefined ? [] : [packStem]);
	return names.map((name) => {
		const base = fileStem(name);
		let stem = base;
		for (let next = 2; taken.has(stem); next += 1) stem = `${base}-${String(next)}`;
		taken.add(stem);
		return stem;
	});
}

function prettyJson(value: unknown): string {
	return `${JSON.stringify(value, null, 2)}\n`;
}

/** Write one drawn icon under its reserved stem: its library, both previews and its recipe. */
const writeIcon = Effect.fn("sketchi.cli.icon.write")(function* (
	dest: string,
	stem: string,
	icon: IconDrawSuccess,
) {
	const fs = yield* LocalFileSystem;
	const files = {
		library: join(dest, `${stem}.excalidrawlib`),
		png28: join(dest, `${stem}.28.png`),
		png112: join(dest, `${stem}.112.png`),
		recipe: join(dest, `${stem}.recipe.json`),
	};
	yield* fs.writeText(files.library, prettyJson(icon.excalidrawlib), true);
	yield* fs.writeBytes(files.png28, Buffer.from(icon.previews.png28, "base64"), true);
	yield* fs.writeBytes(files.png112, Buffer.from(icon.previews.png112, "base64"), true);
	yield* fs.writeText(files.recipe, prettyJson(icon.recipe), true);
	return Object.values(files);
});

/**
 * Draw every logo a path names, write each icon beside the others in `dest`, and for a folder
 * one `.excalidrawlib` pack of them all. Every file name is reserved before anything is
 * written, so no logo overwrites another or the pack. One logo that fails to draw or write
 * does not stop the rest; the run fails only when no icon was written.
 */
export const drawIcons = Effect.fn("sketchi.cli.icon.drawAll")(function* (input: {
	readonly path: string;
	readonly name?: string;
	readonly dest: string;
	readonly endpoint: string;
	readonly model?: string;
	readonly publish?: { readonly endpoint: string };
}) {
	const fs = yield* LocalFileSystem;
	const sources = yield* iconSources(input.path, input.name);
	const folder = (yield* fs.kind(input.path)) === "directory";
	const packStem = folder ? fileStem(basename(resolve(input.path))) : undefined;
	const stems = reserveStems(
		sources.map((source) => source.name),
		packStem,
	);
	yield* fs.makeDirectory(input.dest, true);
	const icons: DrawnIcon[] = [];
	const failed: IconDrawFailureEntry[] = [];
	const libraryItems: unknown[] = [];
	let firstError: CliFailure | undefined;
	const fail = (source: string, error: CliIconError | CliFilesystemError) => {
		failed.push({
			source,
			code: error._tag === "CliIconError" ? error.code : "filesystem_error",
			message: error.message,
		});
		firstError ??= error;
	};
	for (const [index, source] of sources.entries()) {
		const startedAt = yield* Clock.currentTimeMillis;
		const drawn = yield* requestIconDraw({
			endpoint: input.endpoint,
			source,
			...(input.model ? { model: input.model } : {}),
		}).pipe(Effect.result);
		if (drawn._tag === "Failure") {
			fail(source.path, drawn.failure);
			// A spent daily budget refuses every later logo too.
			if (drawn.failure._tag === "CliIconError" && drawn.failure.code === "daily_limit") break;
			continue;
		}
		const icon = drawn.success;
		const written = yield* writeIcon(input.dest, stems[index] ?? fileStem(icon.name), icon).pipe(
			Effect.result,
		);
		if (written._tag === "Failure") {
			fail(source.path, written.failure);
			continue;
		}
		libraryItems.push(...icon.excalidrawlib.libraryItems);
		const published = input.publish
			? yield* publishIcon(input.publish.endpoint, icon).pipe(Effect.result)
			: undefined;
		const finishedAt = yield* Clock.currentTimeMillis;
		icons.push({
			name: icon.name,
			source: source.path,
			files: written.success,
			recognizable: icon.judge.recognizable,
			...(icon.judge.picked ? { picked: icon.judge.picked } : {}),
			rounds: icon.author.rounds,
			model: icon.author.model,
			ms: finishedAt - startedAt,
			...(published?._tag === "Success" ? { published: published.success } : {}),
			...(published?._tag === "Failure" ? { publishError: published.failure.message } : {}),
		});
	}
	if (icons.length === 0 && firstError) return yield* firstError;
	let pack: string | undefined;
	if (packStem !== undefined && libraryItems.length > 0) {
		const path = join(input.dest, `${packStem}.excalidrawlib`);
		const packed = yield* fs
			.writeText(
				path,
				prettyJson({
					type: "excalidrawlib",
					version: 2,
					source: "https://sketchi.app",
					libraryItems,
				}),
				true,
			)
			.pipe(Effect.result);
		if (packed._tag === "Success") pack = path;
		else fail(path, packed.failure);
	}
	return { icons, failed, ...(pack ? { pack } : {}) } satisfies IconDrawRun;
});

export function iconDrawText(run: IconDrawRun): string {
	const lines = run.icons.flatMap((icon) => [
		`${icon.recognizable ? "✓" : "!"} ${icon.name}: drawn in ${String(icon.rounds)} rounds, ${(icon.ms / 1000).toFixed(0)} s; ${
			icon.recognizable
				? "the judge picked it out of look-alikes"
				: `the judge did not pick it out${icon.picked ? ` (it picked ${icon.picked})` : ""}`
		}`,
		...icon.files.map((file) => `  ${file}`),
		...(icon.published ? [`  published: ${icon.published.url}`] : []),
		...(icon.publishError ? [`  not published: ${icon.publishError}`] : []),
	]);
	return [
		...lines,
		...(run.pack ? [`pack: ${run.pack}`] : []),
		...run.failed.map((entry) => `✗ ${entry.source}: ${entry.code}: ${entry.message}`),
	].join("\n");
}
