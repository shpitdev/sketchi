declare module "cloudflare:workers" {
  import type { CodeModeObjectBucket } from "@sketchi/diagram-agent";
  import type { CloudflareAiGatewayProvider } from "@sketchi/diagram-generation";

  export const env: {
    AI?: CloudflareAiGatewayProvider;
    LOADER?: unknown;
    SKETCHI_ARTIFACTS?: CodeModeObjectBucket;
    SKETCHI_AI_GATEWAY_ID?: string;
    SKETCHI_AI_MODEL?: string;
  };
}
