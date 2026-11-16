import { Context, Effect, Predicate, Record as EffectRecord, Schema, String } from "effect";
import { HttpClient, HttpClientError, HttpClientResponse } from "effect/http";

export type CloudflareAiGatewayMetadata = Record<string, number | string | boolean | null | bigint>;

export interface CloudflareAiGateway {
	run(
		data: {
			endpoint: string;
			headers: Record<string, string>;
			provider: string;
			query: unknown;
		},
		options?: {
			gateway?: {
				collectLog?: boolean;
				metadata?: CloudflareAiGatewayMetadata;
				skipCache?: boolean;
			};
			signal?: AbortSignal;
		},
	): Promise<Response>;
	getUrl(provider?: string): Promise<string>;
}

export interface CloudflareAiGatewayProvider {
	gateway(gatewayId: string): CloudflareAiGateway;
}

export class CloudflareAiGatewayBinding extends Context.Service<
	CloudflareAiGatewayBinding,
	CloudflareAiGatewayProvider
>()("@sketchi/diagram-generation/CloudflareAiGatewayBinding") {}

export interface GatewayHttpClientOptions {
	readonly gateway: CloudflareAiGateway;
	/** The gateway's provider route, such as `openai` or `anthropic`. */
	readonly provider: string;
	/** Upstream headers besides the JSON content type. The provider client's own headers are not sent. */
	readonly headers?: Record<string, string>;
	readonly collectLog: boolean;
	readonly metadata: CloudflareAiGatewayMetadata;
	/**
	 * Request fields the provider client cannot express. An object merges into the
	 * client's object of the same name; any other value replaces the client's field.
	 */
	readonly bodyFields?: Record<string, unknown>;
	/**
	 * `stream` hands the gateway's body to the caller as it arrives. `buffer` reads it
	 * within the request, so a body that breaks fails as a retryable `TransportError`
	 * rather than as an undecodable reply.
	 */
	readonly responseBody: "stream" | "buffer";
	/** Sees each attempt's status and headers as they arrive, before any body is read. */
	readonly onResponse?: (response: Pick<Response, "status" | "headers">) => void;
}

const decodeJsonObject = Schema.decodeUnknownEffect(
	Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown)),
);

function withBodyFields(
	body: Record<string, unknown>,
	fields: Record<string, unknown>,
): Record<string, unknown> {
	return {
		...body,
		...EffectRecord.map(fields, (value, key) => {
			const current = body[key];
			return Predicate.isObject(current) && Predicate.isObject(value)
				? { ...current, ...value }
				: value;
		}),
	};
}

/**
 * A provider client's `HttpClient` that sends each JSON request through the gateway
 * binding, which holds the provider key. `HttpClient.make` aborts the binding's signal
 * when the request is interrupted, including while its body is read.
 */
export function makeGatewayHttpClient(options: GatewayHttpClientOptions): HttpClient.HttpClient {
	return HttpClient.make(
		Effect.fn("cloudflare.aiGateway.request")(function* (request, url, signal) {
			if (signal.aborted) return yield* Effect.interrupt;
			const encodeError = (fields: { readonly description?: string; readonly cause?: unknown }) =>
				new HttpClientError.HttpClientError({
					reason: new HttpClientError.EncodeError({ request, ...fields }),
				});
			if (request.body._tag !== "Uint8Array") {
				return yield* Effect.fail(
					encodeError({ description: "Expected a JSON provider request." }),
				);
			}
			const payload = yield* decodeJsonObject(new TextDecoder().decode(request.body.body)).pipe(
				Effect.mapError((cause) => encodeError({ cause })),
			);
			const transportError = (cause: unknown) =>
				new HttpClientError.HttpClientError({
					reason: new HttpClientError.TransportError({ request, cause }),
				});
			const response = yield* Effect.tryPromise({
				try: () =>
					options.gateway.run(
						{
							endpoint: `${String.replace(/^\//, "")(url.pathname)}${url.search}`,
							provider: options.provider,
							headers: { "Content-Type": "application/json", ...options.headers },
							query: withBodyFields(payload, options.bodyFields ?? {}),
						},
						{
							gateway: {
								collectLog: options.collectLog,
								skipCache: true,
								metadata: options.metadata,
							},
							signal,
						},
					),
				catch: transportError,
			});
			options.onResponse?.(response);
			if (options.responseBody === "stream") return HttpClientResponse.fromWeb(request, response);
			const body = yield* Effect.tryPromise({
				try: () => response.arrayBuffer(),
				catch: transportError,
			});
			return HttpClientResponse.fromWeb(
				request,
				new Response(body, { status: response.status, headers: response.headers }),
			);
		}),
	);
}

export function parseJsonResponse(text: string): unknown {
	if (!text) return {};

	try {
		return JSON.parse(text);
	} catch {
		return { text };
	}
}

export function isTransientHttpStatus(status: number): boolean {
	return status === 408 || status === 425 || status === 429 || status >= 500;
}

/** The bare model id for a Google route, without its gateway routing prefix. */
export function stripGoogleModelPrefix(model: string): string {
	return model.replace(/^google-ai-studio\//, "").replace(/^google\//, "");
}

/** The bare model id for an Anthropic route, without its gateway routing prefix. */
export function stripAnthropicModelPrefix(model: string): string {
	return model.replace(/^anthropic\//, "");
}
