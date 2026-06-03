import { defineWorkspace } from "vitest/config";

export default defineWorkspace([
  "packages/diagram-core/vitest.config.ts",
  "packages/diagram-renderer/vitest.config.ts",
  "packages/diagram-studio-ui/vitest.config.ts",
]);
