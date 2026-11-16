import { defineConfig } from "vitest/config";
import diagrams from "./vitest.config.js";

export default defineConfig({
	...diagrams,
	test: {
		...diagrams.test,
		name: "diagrams-family",
		include: ["packages/diagrams/src/families/**/*.test.ts"],
		exclude: ["**/node_modules/**", "**/routing*-fuzz.test.ts", "**/text-fit-fuzz.test.ts"],
	},
});
