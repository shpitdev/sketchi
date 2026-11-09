import { createFileRoute } from "@tanstack/react-router";

import { CommunityPage } from "../../components/community-gallery/community-page.js";

export const Route = createFileRoute("/community/$slug")({
	component: CommunitySlugRoute,
	head: () => ({ meta: [{ title: "Community icons · Sketchi Icons" }] }),
});

function CommunitySlugRoute() {
	const { slug } = Route.useParams();
	return <CommunityPage slug={`community/${slug}`} />;
}
