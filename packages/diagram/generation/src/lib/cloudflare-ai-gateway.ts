import { Context } from "effect";

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
