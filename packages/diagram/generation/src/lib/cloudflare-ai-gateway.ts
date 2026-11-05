import { Context } from "effect";

import type { DiagramGenerationCacheMode } from "./candidates.js";

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
				metadata?: Record<string, number | string | boolean | null | bigint>;
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

export function cacheModeHeaders(
	cacheMode: DiagramGenerationCacheMode | undefined,
): Record<string, string> {
	return cacheMode === "fresh"
		? {
				"Cache-Control": "no-store",
				"cf-aig-skip-cache": "true",
				Pragma: "no-cache",
			}
		: {};
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
