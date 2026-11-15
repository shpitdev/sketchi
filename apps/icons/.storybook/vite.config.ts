import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [tailwindcss()],
	resolve: {
		alias: [
			{
				find: "@sketchi/diagrams",
				replacement: new URL("../../../packages/diagrams/src/", import.meta.url).pathname.slice(
					0,
					-1,
				),
			},
			{
				find: /^@sketchi\/ui\/(.*)$/,
				replacement: `${new URL("../../../packages/ui/src/", import.meta.url).pathname}$1`,
			},
		],
	},
});
