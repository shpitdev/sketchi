import { families } from "@sketchi/diagrams/family";
import { createFileRoute, notFound } from "@tanstack/react-router";

export const Route = createFileRoute("/api/v1/$family/build")({
	beforeLoad: ({ params }) => {
		if (!families.some((family) => family.path === `/api/v1/${params.family.toLowerCase()}/build`))
			notFound({ throw: true });
	},
	server: {
		handlers: {
			POST: async ({ request, params }) => {
				const [
					{ getPlaygroundRequestBoundary },
					{ familyForBuildPath, handleFamilyBuildRequest },
					{ runPlaygroundEffect },
				] = await Promise.all([
					import("@/server/bindings/cloudflare-bindings.server"),
					import("@/server/codemode/api.server"),
					import("@/server/runtime/runtime.server"),
				]);
				const family = familyForBuildPath(`/api/v1/${params.family.toLowerCase()}/build`);
				if (!family) return new Response("Not Found", { status: 404 });
				return runPlaygroundEffect(
					handleFamilyBuildRequest(family, request),
					getPlaygroundRequestBoundary(request),
				);
			},
		},
	},
});
