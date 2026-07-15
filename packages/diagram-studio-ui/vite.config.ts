import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "packages/diagram-studio-ui/dist",
    lib: {
      entry: "packages/diagram-studio-ui/src/index.ts",
      formats: ["es"],
      fileName: "index",
    },
    rollupOptions: {
      external: [
        "react",
        "react-dom",
        "@excalidraw/excalidraw",
        "@excalidraw/excalidraw/types",
        "@sketchi/diagram-core",
        "@sketchi/diagram-excalidraw",
        "@sketchi/diagram-generation",
        "@sketchi/diagram-renderer",
        "@sketchi/diagram-scenarios",
      ],
    },
  },
  resolve: {
    alias: {
      "@sketchi/diagram-core": new URL(
        "../diagram-core/src/index.ts",
        import.meta.url,
      ).pathname,
      "@sketchi/diagram-excalidraw": new URL(
        "../diagram-excalidraw/src/index.ts",
        import.meta.url,
      ).pathname,
      "@sketchi/diagram-generation": new URL(
        "../diagram-generation/src/index.ts",
        import.meta.url,
      ).pathname,
      "@sketchi/diagram-renderer": new URL(
        "../diagram-renderer/src/index.ts",
        import.meta.url,
      ).pathname,
      "@sketchi/diagram-scenarios": new URL(
        "../diagram-scenarios/src/index.ts",
        import.meta.url,
      ).pathname,
    },
  },
});
