import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
	plugins: [react()],
	resolve: {
		alias: {
			"@sketchi/cloudflare": new URL(
				"../../packages/cloudflare/src/",
				import.meta.url,
			).pathname.slice(0, -1),
		},
	},
	test: {
		environment: "jsdom",
		globals: true,
		include: ["apps/icons/tests/**/*.test.{ts,tsx}"],
	},
});
