declare module "cloudflare:workers" {
  import type { ArtifactObjectBucket } from "@sketchi/diagrams/build";
  import type { CloudflareAiGatewayProvider } from "@sketchi/cloudflare/ai-gateway";
  import type { TelemetryPipeline } from "@sketchi/observability";
  import type { CodeModePngRendererNamespace } from "./features/render/browser-renderer.server";
  import type { PlaygroundAssetsBinding } from "./features/build/icon-catalog.server";

  export const env: {
    AI?: CloudflareAiGatewayProvider;
    ASSETS?: PlaygroundAssetsBinding;
    CODEMODE_PNG_RENDERER?: CodeModePngRendererNamespace;
    STUDIO_MCP_SESSION?: import("@sketchi/cloudflare/mcp-session").McpSessionNamespace;
    LOADER?: import("./features/mcp/sandbox.server").SketchiWorkerLoader;
    SKETCHI_ARTIFACTS?: ArtifactObjectBucket;
    SKETCHI_AI_GATEWAY_ID?: string;
    SKETCHI_AI_GENERATE_MODEL?: string;
    SKETCHI_STUDIO_MODEL?: string;
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
    setAlarm(scheduledTime: number): Promise<void>;
    deleteAll(): Promise<void>;
  }

  export abstract class RpcTarget {}

  export abstract class DurableObject<Env = unknown> {
    protected readonly ctx: {
      waitUntil(promise: Promise<unknown>): void;
      readonly storage: DurableObjectStorage;
    };
    protected readonly env: Env;
    constructor(ctx: unknown, env: Env);
  }
}
