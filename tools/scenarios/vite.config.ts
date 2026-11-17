import { defineConfig } from "vite";

import manifest from "./package.json" with { type: "json" };

// Frontierclimb runs dist/cli.js with plain Node. Workspace packages emit
// extensionless imports for bundlers, so the CLI ships as one file with them
// inlined. This package's own npm dependencies stay external and resolve from
// here at run time, as before; that includes the Excalidraw editor module it
// loads by file URL.
const external = Object.keys(manifest.dependencies).filter((name) => !name.startsWith("@sketchi/"));

export default defineConfig({
	build: {
		ssr: "tools/scenarios/src/cli.ts",
		outDir: "tools/scenarios/dist",
		emptyOutDir: false,
		target: "node24",
		minify: false,
		rolldownOptions: { output: { entryFileNames: "cli.js" } },
	},
	ssr: { target: "node", noExternal: true, external },
});
