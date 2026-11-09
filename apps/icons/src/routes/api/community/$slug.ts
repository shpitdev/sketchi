import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/community/$slug")({
	server: {
		handlers: {
			GET: async ({ params, request }) => {
				const [{ handleCommunityDetail }, { getCommunityEnv }] = await Promise.all([
					import("../../../lib/community.server.js"),
					import("../../../lib/community-env.server.js"),
				]);
				return handleCommunityDetail(request, getCommunityEnv(), params.slug);
			},
			PATCH: async ({ params, request }) => {
				const [{ handleCommunityVisibility }, { getCommunityEnv }] = await Promise.all([
					import("../../../lib/community.server.js"),
					import("../../../lib/community-env.server.js"),
				]);
				return handleCommunityVisibility(request, getCommunityEnv(), params.slug);
			},
			OPTIONS: async () => {
				const { corsPreflight } = await import("../../../lib/cors-policy.js");
				return corsPreflight();
			},
		},
	},
});
