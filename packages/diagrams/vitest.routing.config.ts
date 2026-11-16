import { defineConfig } from "vitest/config";

import diagrams from "./vitest.config";

export default defineConfig({
	...diagrams,
	test: {
		...diagrams.test,
		name: "diagrams-routing",
		include: [
			"packages/diagrams/src/graph/tests/routing*-fuzz.test.ts",
			"packages/diagrams/src/graph/tests/text-fit-fuzz.test.ts",
		],
		exclude: [],
	},
});
