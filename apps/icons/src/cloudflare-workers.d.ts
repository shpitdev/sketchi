declare module "cloudflare:workers" {
  import type { IconAssetsBinding } from "./lib/catalog.server";
  import type { CommunityEnv } from "./lib/community.server";

  export const env: CommunityEnv & {
    ASSETS: IconAssetsBinding;
    SKETCHI_APP_SURFACE?: string;
  };
}
