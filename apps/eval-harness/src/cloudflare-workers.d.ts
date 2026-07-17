declare module "cloudflare:workers" {
  import type { CloudflareAiGatewayProvider } from "@sketchi/diagram-generation";

  export const env: {
    AI?: CloudflareAiGatewayProvider;
    SKETCHI_AI_GATEWAY_ID?: string;
    SKETCHI_AI_MODEL?: string;
  };
}
