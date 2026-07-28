declare module "cloudflare:workers" {
  import type { IconAssetsBinding } from "./lib/catalog.server";

  export const env: {
    ASSETS: IconAssetsBinding;
    SKETCHI_APP_SURFACE?: string;
  };
}
