declare module "cloudflare:workers" {
  import type { CloudflareAiGatewayProvider } from "@sketchi/diagram-generation";
  import type { TelemetryPipeline } from "@sketchi/observability";

  export const env: {
    AI?: CloudflareAiGatewayProvider;
    SKETCHI_AI_GATEWAY_ID?: string;
    SKETCHI_AI_MODEL?: string;
    TELEMETRY_SPANS?: TelemetryPipeline;
  };

  export function waitUntil(promise: Promise<unknown>): void;
}
