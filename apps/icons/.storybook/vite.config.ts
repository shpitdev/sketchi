import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [tailwindcss()],
	resolve: {
		alias: [
			{
				find: /^@sketchi\/ui\/(.*)$/,
				replacement: `${new URL("../../../packages/ui/src/", import.meta.url).pathname}$1`,
			},
		],
	},
});
