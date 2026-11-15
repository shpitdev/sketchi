import { defineConfig } from "vitest/config";

import drawing from "./vitest.config.ts";

export default defineConfig({
	...drawing,
	test: {
		...drawing.test,
		name: "drawing-routing",
		include: [
			"tools/drawing-tests/routing*-fuzz.test.ts",
			"tools/drawing-tests/text-fit-fuzz.test.ts",
		],
		exclude: [],
	},
});
