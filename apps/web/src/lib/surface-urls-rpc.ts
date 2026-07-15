import { createServerFn } from "@tanstack/react-start";

import { resolveWebSurfaceUrls } from "./surface-urls";

export const getWebSurfaceUrls = createServerFn({ method: "GET" }).handler(
  async () => {
    const { getWebBindings } = await import("./cloudflare-bindings.server");

    return resolveWebSurfaceUrls(getWebBindings());
  },
);
