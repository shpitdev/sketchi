declare module "cloudflare:workers" {
  import type { IconAssetsBinding } from "./lib/catalog.server";
  import type { CommunityEnv } from "./lib/community.server";

  export const env: CommunityEnv & {
    ASSETS: IconAssetsBinding;
    SKETCHI_APP_SURFACE?: string;
    EXCALIDRAW_LIBRARY_SUBMIT?: string;
    EXCALIDRAW_LIBRARY_BACKEND?: string;
    EXCALIDRAW_LIBRARY_GITHUB_API?: string;
  };

  /** The Durable Object storage calls the icons Worker's objects make. */
  export interface DurableObjectStorage {
    get<T>(key: string): Promise<T | undefined>;
    put<T>(key: string, value: T): Promise<void>;
    setAlarm(scheduledTime: number): Promise<void>;
    deleteAll(): Promise<void>;
  }

  export abstract class DurableObject<Env = unknown> {
    protected readonly ctx: { readonly storage: DurableObjectStorage };
    protected readonly env: Env;
    constructor(ctx: unknown, env: Env);
  }
}
