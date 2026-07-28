declare module "cloudflare:workers" {
  import type { CodeModeObjectBucket } from "@sketchi/diagram-agent";
  import type { CloudflareAiGatewayProvider } from "@sketchi/diagram-generation";
  import type { CodeModeUsagePipelineBinding } from "./server/bindings/studio-env.server";
  import type { CloudflareBrowserRunBinding } from "./server/codemode/browser-renderer.server";

  export const env: {
    AI?: CloudflareAiGatewayProvider;
    BROWSER?: CloudflareBrowserRunBinding;
    CODEMODE_USAGE_EVENTS?: CodeModeUsagePipelineBinding;
    CODEMODE_USAGE_ISSUES?: CodeModeUsagePipelineBinding;
    LOADER?: unknown;
    SKETCHI_ARTIFACTS?: CodeModeObjectBucket;
    SKETCHI_AI_GATEWAY_ID?: string;
    SKETCHI_AI_MODEL?: string;
    SKETCHI_RENDER_ASSET_ORIGIN?: string;
  };

  export function waitUntil(promise: Promise<unknown>): void;
}
