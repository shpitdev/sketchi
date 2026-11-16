import { defineConfig } from "vitest/config";
import diagrams from "./vitest.config";

export default defineConfig({
	...diagrams,
	test: {
		...diagrams.test,
		name: "diagrams-graph",
		include: ["packages/diagrams/src/graph/**/*.test.ts"],
		exclude: ["**/node_modules/**", "**/routing*-fuzz.test.ts", "**/text-fit-fuzz.test.ts"],
	},
});
