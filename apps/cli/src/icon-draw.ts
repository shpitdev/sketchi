import { basename, extname, join, resolve } from "node:path";

import { Clock, Duration, Effect, Schema } from "effect";

import { type CliFailure, type CliFilesystemError, CliIconError } from "./errors.js";
import { LocalFileSystem } from "./filesystem.js";
import { MAX_API_RESPONSE_BYTES, readBoundedText } from "./response-body.js";

export const DEFAULT_ICON_DRAW_ENDPOINT = "https://playground.sketchi.app/api/v1/icons/draw";
export const SKETCHI_ICON_DRAW_ENDPOINT_ENV = "SKETCHI_ICON_DRAW_ENDPOINT";
export const DEFAULT_COMMUNITY_ENDPOINT = "https://icons.sketchi.app/api/community";
export const SKETCHI_COMMUNITY_ENDPOINT_ENV = "SKETCHI_COMMUNITY_ENDPOINT";

/** One draw attempt: the service answers within 85 s; this covers that and the upload. */
const ICON_DRAW_ATTEMPT_TIMEOUT = "120 seconds";
/** One publish attempt. Waits between attempts are outside it. */
const PUBLISH_ATTEMPT_TIMEOUT = "30 seconds";
/** A rate-limited request waits for Retry-After up to this long, at most this many times. */
const MAX_RETRY_WAIT_SECONDS = 90;
const MAX_RATE_LIMIT_RETRIES = 3;
const MAX_INPUT_BYTES = 4 * 1024 * 1024;
const NAME_MAX_LENGTH = 48;

const SOURCE_KINDS: Readonly<Record<string, "svg" | "image">> = {
	".svg": "svg",
	".png": "image",
	".jpg": "image",
	".jpeg": "image",
	".webp": "image",
};

export function resolveIconDrawEndpoint(): string {
	return process.env[SKETCHI_ICON_DRAW_ENDPOINT_ENV]?.trim() || DEFAULT_ICON_DRAW_ENDPOINT;
}

export function resolveCommunityEndpoint(): string {
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
		.slice(0, NAME_MAX_LENGTH);
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

const IconDrawSuccess = Schema.Struct({
	ok: Schema.Literal(true),
	name: Schema.String,
	recipe: Schema.Struct({ parts: Schema.Array(Schema.Unknown) }),
	previews: Schema.Struct({ png28: Schema.String, png112: Schema.String }),
	excalidrawlib: Schema.Struct({
		type: Schema.Literal("excalidrawlib"),
		version: Schema.Number,
		source: Schema.String,
		libraryItems: Schema.Array(Schema.Unknown),
	}),
	judge: Schema.Struct({
		recognizable: Schema.Boolean,
		picked: Schema.optionalKey(Schema.String),
		model: Schema.optionalKey(Schema.String),
		error: Schema.optionalKey(Schema.String),
	}),
	author: Schema.Struct({ model: Schema.String, rounds: Schema.Number }),
	usage: Schema.Struct({ calls: Schema.Number, ms: Schema.Number }),
});
type IconDrawSuccess = typeof IconDrawSuccess.Type;

const EndpointFailure = Schema.Struct({
	status: Schema.optionalKey(Schema.String),
	issues: Schema.optionalKey(
		Schema.Array(
			Schema.Struct({
				code: Schema.optionalKey(Schema.String),
				message: Schema.optionalKey(Schema.String),
				hint: Schema.optionalKey(Schema.String),
			}),
		),
	),
});

const CommunityPublished = Schema.Struct({
	slug: Schema.String,
	url: Schema.String,
	created: Schema.Boolean,
});

const decodeSuccess = Schema.decodeUnknownEffect(Schema.fromJsonString(IconDrawSuccess));
const decodeFailure = Schema.decodeUnknownEffect(Schema.fromJsonString(EndpointFailure));
const decodePublished = Schema.decodeUnknownEffect(Schema.fromJsonString(CommunityPublished));

function base64(bytes: Uint8Array): string {
	return Buffer.from(bytes).toString("base64");
}

function retryAfterSeconds(response: Response): number | undefined {
	const value = response.headers.get("retry-after");
	if (!value) return undefined;
	const seconds = Number(value);
	return Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined;
}

/** What one POST answered: its status, its body, and how long it asks a rate-limited client to wait. */
interface Answer {
	readonly status: number;
	readonly ok: boolean;
	readonly text: string;
}

/**
 * One POST, waiting out a short rate limit and trying again, as the service asks. Each attempt
 * (request and body) has its own time limit, so a Retry-After wait never eats into the next
 * attempt's time.
 */
const postWithRetry = Effect.fn("sketchi.cli.icon.post")(function* (
	url: string,
	body: string,
	options: {
		readonly attemptTimeout: Duration.Input;
		readonly maxBytes: number;
		readonly failNetwork: () => CliIconError;
		readonly failMalformed: () => CliIconError;
		readonly failTimeout: () => CliIconError;
	},
) {
	for (let attempt = 0; ; attempt += 1) {
		const { answer, wait } = yield* Effect.gen(function* () {
			const response = yield* Effect.tryPromise({
				try: (signal) =>
					globalThis.fetch(url, {
						method: "POST",
						headers: { "content-type": "application/json", "x-sketchi-client": "sketchi-cli" },
						body,
						signal,
					}),
				catch: options.failNetwork,
			});
			const text = yield* readBoundedText(
				response,
				options.maxBytes,
				options.failMalformed,
				options.failNetwork,
			);
			return {
				answer: { status: response.status, ok: response.ok, text } satisfies Answer,
				wait: retryAfterSeconds(response),
			};
		}).pipe(
			Effect.timeoutOrElse({
				duration: options.attemptTimeout,
				orElse: () => Effect.fail(options.failTimeout()),
			}),
		);
		if (
			answer.status !== 429 ||
			attempt >= MAX_RATE_LIMIT_RETRIES ||
			wait === undefined ||
			wait > MAX_RETRY_WAIT_SECONDS
		) {
			return answer;
		}
		yield* Effect.sleep(Duration.seconds(wait));
	}
});

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
	if (!chosen || chosen.length > NAME_MAX_LENGTH) {
		return yield* iconError(
			"icon_input",
			`The name must be 1-${NAME_MAX_LENGTH} characters.`,
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
	if (bytes.byteLength > MAX_INPUT_BYTES) {
		return yield* iconError(
			"icon_input",
			`${input.source.path} is larger than ${MAX_INPUT_BYTES / (1024 * 1024)} MB.`,
			"Send a smaller export of the logo; 512 px is plenty.",
		);
	}
	const kind = SOURCE_KINDS[extname(input.source.path).toLowerCase()];
	const body = JSON.stringify({
		name: input.source.name,
		...(kind === "svg" ? { svg: new TextDecoder().decode(bytes) } : { image: base64(bytes) }),
		...(input.model ? { model: input.model } : {}),
	});
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
	const response = yield* postWithRetry(input.endpoint, body, {
		attemptTimeout: ICON_DRAW_ATTEMPT_TIMEOUT,
		maxBytes: MAX_API_RESPONSE_BYTES,
		failNetwork: network,
		failMalformed: malformed,
		failTimeout: () =>
			iconError("icon_timeout", "The Sketchi icon service did not answer in time.", "Retry once."),
	});
	if (response.ok) return yield* decodeSuccess(response.text).pipe(Effect.mapError(malformed));
	const failure = yield* decodeFailure(response.text).pipe(Effect.mapError(malformed));
	const issue = failure.issues?.[0];
	const details = [`http_status:${String(response.status)}`, ...(issue?.code ? [issue.code] : [])];
	const message = issue?.message ?? `The icon service answered HTTP ${String(response.status)}.`;
	const hint = issue?.hint ?? "Retry once; if it persists, try another export of the logo.";
	if (response.status === 429) {
		return yield* iconError(
			issue?.code === "daily_limit" ? "daily_limit" : "rate_limited",
			message,
			hint,
			details,
		);
	}
	if (response.status === 400 || response.status === 422) {
		return yield* iconError("icon_rejected", message, hint, details);
	}
	if (response.status === 504) return yield* iconError("icon_timeout", message, hint, details);
	return yield* iconError("endpoint_failure", message, hint, details);
});

export interface PublishedIcon {
	readonly slug: string;
	readonly url: string;
	readonly created: boolean;
}

/** The community store's error envelope: `{ error: { code, message } }`. */
const CommunityFailure = Schema.Struct({
	error: Schema.optionalKey(
		Schema.Struct({
			code: Schema.optionalKey(Schema.String),
			message: Schema.optionalKey(Schema.String),
		}),
	),
});
const decodeCommunityFailure = Schema.decodeUnknownEffect(Schema.fromJsonString(CommunityFailure));

/** Publish a drawn icon to the community store, with the judge's verdict. */
export const publishIcon = Effect.fn("sketchi.cli.icon.publish")(function* (
	endpoint: string,
	icon: IconDrawSuccess,
) {
	const failed = (message: string, details: readonly string[] = []) =>
		iconError(
			"publish_failed",
			message,
			"Publish it later with --publish, or share the .excalidrawlib.",
			details,
		);
	const unreadable = () => failed("The community store returned an unreadable response.");
	const response = yield* postWithRetry(
		endpoint,
		JSON.stringify({
			name: icon.name,
			recipe: icon.recipe,
			verdict: {
				recognizable: icon.judge.recognizable,
				...(icon.judge.model ? { judge: icon.judge.model.slice(0, 64) } : {}),
			},
		}),
		{
			attemptTimeout: PUBLISH_ATTEMPT_TIMEOUT,
			maxBytes: 64 * 1024,
			failNetwork: () => failed("The community icon store could not be reached."),
			failMalformed: unreadable,
			failTimeout: () => failed("The community store did not answer in time."),
		},
	);
	if (response.ok) {
		return yield* decodePublished(response.text).pipe(Effect.mapError(unreadable));
	}
	const refusal = yield* decodeCommunityFailure(response.text).pipe(
		Effect.orElseSucceed(() => ({ error: undefined })),
	);
	return yield* failed(
		refusal.error?.message ?? `The community store answered HTTP ${String(response.status)}.`,
		[
			`http_status:${String(response.status)}`,
			...(refusal.error?.code ? [refusal.error.code] : []),
		],
	);
});

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
