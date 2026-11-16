import { defineConfig } from "vitest/config";

import drawing from "./vitest.config.ts";

export default defineConfig({
	...drawing,
	test: {
		...drawing.test,
		name: "drawing-routing",
		include: [
			"packages/diagrams/src/graph/tests/routing*-fuzz.test.ts",
			"packages/diagrams/src/graph/tests/text-fit-fuzz.test.ts",
		],
		exclude: [],
	},
});
