import type { CloudflareAiGateway, CloudflareAiGatewayProvider } from "@sketchi/diagram-generation";

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
 * goes to `onLog`, so its cost can be read back.
 */
export function httpGateway(
	access: GatewayAccess,
	onLog: (logId: string) => void,
): CloudflareAiGatewayProvider {
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
					const response = await send(`${base}/${data.provider}/${data.endpoint}`, {
						method: "POST",
						headers,
						body: JSON.stringify(data.query),
						...(options?.signal ? { signal: options.signal } : {}),
					});
					const logId = response.headers.get("cf-aig-log-id");
					if (logId) onLog(logId);
					return response;
				},
			};
		},
	};
}

export interface GatewayLogCost {
	readonly logId: string;
	/** USD, as the gateway priced the call; undefined while the log has no cost yet. */
	readonly cost?: number;
	readonly model?: string;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * What each logged call cost, read from the gateway's logs. A log lands a
 * little after its response, so a missing one is read again a few times.
 */
export async function readLogCosts(
	access: GatewayAccess,
	gatewayId: string,
	logIds: readonly string[],
	options: { readonly attempts?: number; readonly waitMs?: number } = {},
): Promise<GatewayLogCost[]> {
	const send = access.fetch ?? fetch;
	const attempts = options.attempts ?? 6;
	const waitMs = options.waitMs ?? 2_000;
	const read = async (logId: string): Promise<GatewayLogCost> => {
		for (let attempt = 1; ; attempt += 1) {
			try {
				const response = await send(
					`https://api.cloudflare.com/client/v4/accounts/${access.accountId}/ai-gateway/gateways/${gatewayId}/logs/${logId}`,
					{ headers: { authorization: `Bearer ${access.token}` } },
				);
				if (response.ok) {
					const body = (await response.json()) as {
						readonly result?: { readonly cost?: unknown; readonly model?: unknown };
					};
					const cost = body.result?.cost;
					if (typeof cost === "number" && Number.isFinite(cost)) {
						return {
							logId,
							cost,
							...(typeof body.result?.model === "string" ? { model: body.result.model } : {}),
						};
					}
				} else {
					await response.body?.cancel();
				}
			} catch {
				// An unreachable or malformed read is tried again, like a log that has not landed.
			}
			if (attempt >= attempts) return { logId };
			await sleep(waitMs * attempt);
		}
	};
	const costs: GatewayLogCost[] = [];
	for (const logId of logIds) costs.push(await read(logId));
	return costs;
}
