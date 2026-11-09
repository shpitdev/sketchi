import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/community/")({
	server: {
		handlers: {
			GET: async ({ request }) => {
				const [{ handleCommunityList }, { getCommunityEnv }] = await Promise.all([
					import("../../../lib/community.server.js"),
					import("../../../lib/community-env.server.js"),
				]);
				return handleCommunityList(request, getCommunityEnv());
			},
			POST: async ({ request }) => {
				const [{ handleCommunityPublish }, { getCommunityEnv }] = await Promise.all([
					import("../../../lib/community.server.js"),
					import("../../../lib/community-env.server.js"),
				]);
				return handleCommunityPublish(request, getCommunityEnv());
			},
			OPTIONS: async () => {
				const { corsPreflight } = await import("../../../lib/cors-policy.js");
				return corsPreflight();
			},
		},
	},
});
