import {
	type CloudflareAiGateway,
	type CloudflareAiGatewayProvider,
	isTransientHttpStatus,
} from "@sketchi/cloudflare/ai-gateway";
import { Duration, Effect, Schedule, Schema } from "effect";
import {
	FetchHttpClient,
	HttpClient,
	HttpClientError,
	HttpClientRequest,
	HttpClientResponse,
} from "effect/http";

/** Sketchi's Cloudflare account, whose AI Gateway stores the provider keys Studio uses. */
export const SKETCHI_ACCOUNT_ID = "75f9660f39e4dafe8b95980b87e7399a";
/** Studio's gateway (`SKETCHI_AI_GATEWAY_ID`). */
export const SKETCHI_GATEWAY_ID = "google-ai-studio";

export interface GatewayAccess {
	readonly accountId: string;
	readonly token: string;
	readonly fetch?: typeof fetch;
}

/**
 * The Worker's AI binding over HTTPS: the same provider requests, sent to the
 * gateway's provider routes with an authenticated-gateway token, so the
 * gateway answers with the provider keys it stores. Each response's log id
 * goes to `onLog`, so its cost can be read back. `onDispatch` counts requests
 * handed to fetch, even if no response or log ID comes back.
 */
export function httpGateway(
	access: GatewayAccess,
	track: { readonly onDispatch: () => void; readonly onLog: (logId: string) => void },
): CloudflareAiGatewayProvider {
	// The HTTPS binding adapter passes the provider's signal through to the native host fetch.
	const send = access.fetch ?? fetch;
	return {
		gateway(gatewayId: string): CloudflareAiGateway {
			const base = `https://gateway.ai.cloudflare.com/v1/${access.accountId}/${gatewayId}`;
			return {
				getUrl: async (provider) => (provider ? `${base}/${provider}` : base),
				run: async (data, options) => {
					const headers = new Headers(data.headers);
					headers.set("cf-aig-authorization", `Bearer ${access.token}`);
					const gateway = options?.gateway;
					if (gateway?.metadata) {
						headers.set(
							"cf-aig-metadata",
							JSON.stringify(gateway.metadata, (_key, value: unknown) =>
								typeof value === "bigint" ? value.toString() : value,
							),
						);
					}
					if (gateway?.collectLog !== undefined) {
						headers.set("cf-aig-collect-log", String(gateway.collectLog));
					}
					if (gateway?.skipCache) headers.set("cf-aig-skip-cache", "true");
					const body = JSON.stringify(data.query);
					const signal = options?.signal;
					signal?.throwIfAborted();
					track.onDispatch();
					const response = await send(`${base}/${data.provider}/${data.endpoint}`, {
						method: "POST",
						headers,
						body,
						redirect: "error", // Do not let fetch replay a paid POST to a redirect target.
						...(signal ? { signal } : {}),
					});
					const logId = response.headers.get("cf-aig-log-id");
					if (logId) track.onLog(logId);
					return response;
				},
			};
		},
	};
}

const decodeLog = HttpClientResponse.schemaBodyJson(
	Schema.Struct({ result: Schema.Struct({ cost: Schema.Finite }) }),
);

// Six GETs at most per log: 5 seconds each, with gaps of 2, 4, 6, 8 and 10 seconds.
const logRetry = Schedule.recurs(5).pipe(
	Schedule.addDelay(({ attempt }) => Effect.succeed(Duration.seconds(2 * attempt))),
);

/** No price unless every log is priced. The caller keeps the draw and charges its estimate. */
export const priceLogs = Effect.fn("sketchi.iconBatch.priceLogs")(
	function* (access: GatewayAccess, logIds: readonly string[]) {
		if (logIds.length === 0) return undefined;
		const client = (yield* HttpClient.HttpClient).pipe(
			HttpClient.withScope,
			HttpClient.filterStatusOk,
		);
		const base = `https://api.cloudflare.com/client/v4/accounts/${access.accountId}/ai-gateway/gateways/${SKETCHI_GATEWAY_ID}/logs`;

		return yield* Effect.reduce(
			logIds,
			() => 0,
			(total, logId) =>
				client
					.execute(
						HttpClientRequest.get(`${base}/${logId}`).pipe(
							HttpClientRequest.bearerToken(access.token),
						),
					)
					.pipe(
						Effect.flatMap(decodeLog),
						// Closing this attempt's scope aborts the transport even after headers arrived.
						Effect.scoped,
						Effect.timeout("5 seconds"),
						Effect.retry({
							schedule: logRetry,
							while: (error) => {
								if (
									!HttpClientError.isHttpClientError(error) ||
									error.reason._tag !== "StatusCodeError"
								) {
									return true;
								}
								const { status } = error.reason.response;
								return status === 404 || isTransientHttpStatus(status);
							},
						}),
						Effect.map(({ result }) => total + result.cost),
					),
		).pipe(Effect.orElseSucceed(() => undefined));
	},
	(effect, access) => {
		// @effect-diagnostics-next-line strictEffectProvide:off -- This cost-log adapter owns the outgoing Fetch transport, separate from model POSTs.
		const priced = effect.pipe(Effect.provide(FetchHttpClient.layer));
		return access.fetch
			? priced.pipe(Effect.provideService(FetchHttpClient.Fetch, access.fetch))
			: priced;
	},
);
