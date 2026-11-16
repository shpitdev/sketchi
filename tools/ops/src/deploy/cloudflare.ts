import { Clock, Console, Duration, Effect, Option, Redacted, Schema } from "effect";
import { FetchHttpClient, HttpClientRequest } from "effect/http";

import { optionalEnv, writeOutputs } from "../outputs";
import { attempt, opsError } from "../process";
import { previewName, previewProjectConfig } from "./preview";
import { productionProjectConfig, selectProductionDomainDetachments } from "./production";
import { decodeBody, send } from "./http";

const API = "https://api.cloudflare.com/client/v4";

export interface CloudflareCredentials {
	readonly accountId: string;
	readonly apiToken: Redacted.Redacted<string>;
}

/** CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN, or none when either is unset. */
export const cloudflareCredentials = Effect.gen(function* () {
	const accountId = yield* optionalEnv("CLOUDFLARE_ACCOUNT_ID");
	const apiToken = yield* optionalEnv("CLOUDFLARE_API_TOKEN");
	return Option.all({ accountId, apiToken: Option.map(apiToken, Redacted.make) });
});

export const requireCloudflareCredentials = Effect.gen(function* () {
	const credentials = yield* cloudflareCredentials;
	if (Option.isNone(credentials)) {
		return yield* opsError("CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are required.");
	}
	return credentials.value;
});

function accountApi(credentials: CloudflareCredentials, path: string) {
	return `${API}/accounts/${encodeURIComponent(credentials.accountId)}${path}`;
}

function authorized(
	credentials: CloudflareCredentials,
	request: HttpClientRequest.HttpClientRequest,
) {
	return request.pipe(HttpClientRequest.bearerToken(credentials.apiToken));
}

const CloudflareErrors = Schema.Struct({
	errors: Schema.Array(Schema.Struct({ message: Schema.optional(Schema.String) })),
});

function cloudflareErrors(json: unknown) {
	return Schema.decodeUnknownOption(CloudflareErrors)(json).pipe(
		Option.map(({ errors }) => errors.map((error) => error.message ?? "unknown").join("; ")),
		Option.getOrElse(() => "Cloudflare returned an unknown error."),
	);
}

const WorkerSubdomain = Schema.Struct({
	result: Schema.Struct({
		subdomain: Schema.Struct({ preview_url_suffix: Schema.String }),
	}),
});

export interface PreviewCleanupOptions {
	readonly project: string;
	readonly prNumber: string | undefined;
	/** URL checks after the delete before reporting deletion-pending. */
	readonly attempts?: number;
	readonly interval?: Duration.Input;
	/** Bound on each URL check, so a hung hostname cannot hold the job. */
	readonly probeTimeout?: Duration.Input;
}

/**
 * Deletes this PR's Preview of the project's production Worker and waits until its URL stops
 * serving. The Worker comes from the project registry and the Preview name from the validated PR
 * number, so the one DELETE this sends can only name `pr-<N>` on that Worker.
 */
export const deletePreview = Effect.fn("ops.preview.delete")(function* (
	options: PreviewCleanupOptions,
) {
	const project = yield* attempt(() => previewProjectConfig(options.project));
	const name = yield* attempt(() => previewName(options.prNumber));
	const credentials = yield* cloudflareCredentials;
	if (Option.isNone(credentials)) {
		yield* Console.log(
			"::warning::Cloudflare credentials are not configured. Nothing was deleted.",
		);
		return;
	}
	const workerApi = accountApi(
		credentials.value,
		`/workers/workers/${encodeURIComponent(project.workerName)}`,
	);
	const worker = yield* send(authorized(credentials.value, HttpClientRequest.get(workerApi)));
	const suffix = worker.ok
		? Option.getOrUndefined(Schema.decodeUnknownOption(WorkerSubdomain)(worker.json))?.result
				.subdomain.preview_url_suffix
		: undefined;
	if (
		suffix === undefined ||
		!suffix.startsWith(`-${project.workerName}.`) ||
		!suffix.endsWith(".workers.dev")
	) {
		return yield* opsError(
			`Cannot resolve the Preview URL of ${project.workerName} (HTTP ${worker.status}).`,
		);
	}
	const previewUrl = `https://${name}${suffix}`;

	// 404 means it is already gone.
	const deleted = yield* send(
		authorized(
			credentials.value,
			HttpClientRequest.delete(`${workerApi}/previews/${encodeURIComponent(name)}`),
		),
	);
	if (!deleted.ok && deleted.status !== 404) {
		return yield* opsError(
			`Cloudflare Preview delete failed with HTTP ${deleted.status}: ${deleted.text}`,
		);
	}

	// A successful delete can leave the hostname serving the deleted code
	// (cloudflare/workers-sdk#15945), so only report deletion once it stops.
	const attempts = options.attempts ?? 12;
	for (let check = 1; check <= attempts; check += 1) {
		if (yield* previewRetired(previewUrl, options.probeTimeout ?? "10 seconds")) {
			yield* writeOutputs({
				comment_status: "deleted",
				preview_name: name,
				preview_url: previewUrl,
			});
			return;
		}
		if (check < attempts) yield* Effect.sleep(options.interval ?? "10 seconds");
	}
	yield* writeOutputs({
		comment_status: "deletion-pending",
		preview_name: name,
		preview_url: previewUrl,
	});
	return yield* opsError(
		`Cloudflare deleted Preview ${name}, but ${previewUrl} still serves after ${attempts} checks (cloudflare/workers-sdk#15945).`,
	);
});

/**
 * Cloudflare answers a hostname with no live Preview with a 404 marked as a Preview user error.
 * Anything else, including the app's own responses and a failed or slow check, means it serves.
 */
const previewRetired = Effect.fn("ops.preview.retired")(function* (
	previewUrl: string,
	timeout: Duration.Input,
) {
	const now = yield* Clock.currentTimeMillis;
	return yield* send(
		HttpClientRequest.get(`${previewUrl}/?sketchi-cleanup=${now}`).pipe(
			HttpClientRequest.setHeader("cache-control", "no-cache"),
		),
	).pipe(
		Effect.provideService(FetchHttpClient.RequestInit, { redirect: "manual" }),
		Effect.timeout(timeout),
		Effect.map(
			(response) => response.status === 404 && response.headers["x-preview-user-error"] === "true",
		),
		Effect.orElseSucceed(() => false),
	);
});

const DomainList = Schema.Struct({
	success: Schema.Literal(true),
	result: Schema.Array(Schema.Unknown),
});
const Success = Schema.Struct({ success: Schema.Literal(true) });

/**
 * Lists the project's approved custom domains that point at its Worker and, with `apply`,
 * detaches each by its listed id.
 */
export const detachProductionDomains = Effect.fn("ops.production.detachDomains")(function* (input: {
	readonly project: string;
	readonly apply: boolean;
}) {
	const project = yield* attempt(() => productionProjectConfig(input.project));
	const credentials = yield* requireCloudflareCredentials;
	if (project.domainPatterns.length === 0) return [];
	const endpoint = accountApi(credentials, "/workers/domains");
	const listed = yield* send(authorized(credentials, HttpClientRequest.get(endpoint)));
	const domains = yield* Schema.decodeUnknownEffect(DomainList)(listed.json).pipe(
		Effect.mapError(() =>
			opsError(`Unable to list Worker domains: ${cloudflareErrors(listed.json)}`),
		),
	);
	const detachments = yield* attempt(() =>
		selectProductionDomainDetachments(
			{ projectId: project.projectId, workerName: project.workerName },
			domains.result,
		),
	);
	if (!input.apply) return detachments;
	for (const domain of detachments) {
		const response = yield* send(
			authorized(
				credentials,
				HttpClientRequest.delete(`${endpoint}/${encodeURIComponent(domain.id)}`),
			),
		);
		if (!response.ok || Option.isNone(Schema.decodeUnknownOption(Success)(response.json))) {
			return yield* opsError(
				`Unable to detach ${domain.hostname}: ${cloudflareErrors(response.json)}`,
			);
		}
	}
	return detachments;
});

const Subdomain = Schema.Struct({
	success: Schema.Literal(true),
	result: Schema.Struct({ subdomain: Schema.NonEmptyString }),
});

/** The account's workers.dev subdomain. */
export const workersSubdomain = Effect.fn("ops.cloudflare.workersSubdomain")(function* (
	credentials: CloudflareCredentials,
) {
	const response = yield* send(
		authorized(credentials, HttpClientRequest.get(accountApi(credentials, "/workers/subdomain"))),
	);
	const body = yield* decodeBody(
		Subdomain,
		response,
		"Cloudflare workers.dev subdomain lookup failed",
	);
	return body.result.subdomain;
});

const Zones = Schema.Struct({
	success: Schema.Literal(true),
	result: Schema.Tuple([Schema.Struct({ status: Schema.Literal("active") })]),
});

/** Domain attachment needs sketchi.app as exactly one active zone in the account. */
export const requireActiveZone = Effect.fn("ops.cloudflare.requireActiveZone")(function* (
	credentials: CloudflareCredentials,
) {
	const url = `${API}/zones?name=sketchi.app&account.id=${encodeURIComponent(credentials.accountId)}`;
	const response = yield* send(authorized(credentials, HttpClientRequest.get(url)));
	yield* decodeBody(
		Zones,
		response,
		"sketchi.app must exist as one active Cloudflare zone before domain attachment",
	);
});
