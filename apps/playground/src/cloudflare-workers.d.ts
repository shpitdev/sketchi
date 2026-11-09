declare module "cloudflare:workers" {
  import type { CodeModeObjectBucket } from "@sketchi/diagram-agent";
  import type { CloudflareAiGatewayProvider } from "@sketchi/diagram-generation";
  import type { TelemetryPipeline } from "@sketchi/observability";
  import type { CodeModePngRendererNamespace } from "./server/codemode/browser-renderer.server";
  import type { PlaygroundAssetsBinding } from "./server/codemode/icon-catalog.server";

  export const env: {
    AI?: CloudflareAiGatewayProvider;
    ASSETS?: PlaygroundAssetsBinding;
    CODEMODE_PNG_RENDERER?: CodeModePngRendererNamespace;
    LOADER?: unknown;
    SKETCHI_ARTIFACTS?: CodeModeObjectBucket;
    SKETCHI_AI_GATEWAY_ID?: string;
    SKETCHI_AI_GENERATE_MODEL?: string;
    SKETCHI_AI_MODEL?: string;
    SKETCHI_RENDER_ASSET_ORIGIN?: string;
    TELEMETRY_SPANS?: TelemetryPipeline;
  };

  export function waitUntil(promise: Promise<unknown>): void;

  /** The Durable Object storage calls Studio's objects make. */
  export interface DurableObjectStorage {
    get<T>(key: string): Promise<T | undefined>;
    put<T>(key: string, value: T): Promise<void>;
    list<T>(options?: { prefix?: string }): Promise<Map<string, T>>;
    delete(keys: string[]): Promise<number>;
  }

  export abstract class DurableObject<Env = unknown> {
    protected readonly ctx: {
      waitUntil(promise: Promise<unknown>): void;
      readonly storage: DurableObjectStorage;
    };
    protected readonly env: Env;
    constructor(ctx: unknown, env: Env);
  }
}
