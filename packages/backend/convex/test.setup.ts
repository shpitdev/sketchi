// Manual module map for convex-test (avoid import.meta.glob in non-Vite test runner).
export const modules = {
  "./_generated/api.js": () => import("./_generated/api.js"),
  "./_generated/server.js": () => import("./_generated/server.js"),
  "./excalidrawShareLinks.ts": () => import("./excalidrawShareLinks"),
  "./healthCheck.ts": () => import("./healthCheck"),
  "./export.ts": () => import("./export"),
};
