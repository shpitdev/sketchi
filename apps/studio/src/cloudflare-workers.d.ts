declare module "cloudflare:workers" {
  import type { CodeModeObjectBucket } from "@sketchi/diagram-agent";
  import type { CloudflareAiGatewayProvider } from "@sketchi/diagram-generation";
  import type { CloudflareBrowserRunBinding } from "./lib/codemode-browser-renderer.server";

  export const env: {
    AI?: CloudflareAiGatewayProvider;
    BROWSER?: CloudflareBrowserRunBinding;
    LOADER?: unknown;
    SKETCHI_ARTIFACTS?: CodeModeObjectBucket;
    SKETCHI_AI_GATEWAY_ID?: string;
    SKETCHI_AI_MODEL?: string;
    SKETCHI_RENDER_ASSET_ORIGIN?: string;
  };
}
