import { defineConfig } from "vitest/config";
export default defineConfig({
	test: { name: "diagrams", include: ["packages/diagrams/src/**/*.test.ts"], testTimeout: 60_000 },
});
