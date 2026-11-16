import { createFileRoute } from "@tanstack/react-router";

import { CommunityPage } from "../../features/community/community-page";
import { COMMUNITY_DESCRIPTION, pageMeta } from "../../shared/site";

export const Route = createFileRoute("/community/$slug")({
	component: CommunitySlugRoute,
	head: ({ params }) => ({
		meta: pageMeta({
			title: "Community icons · Sketchi Icons",
			description: COMMUNITY_DESCRIPTION,
			path: `/community/${params.slug}`,
		}),
	}),
});

function CommunitySlugRoute() {
	const { slug } = Route.useParams();
	return <CommunityPage slug={`community/${slug}`} />;
}
