import { createFileRoute } from "@tanstack/react-router";

import { CommunityPage } from "../../components/community-gallery/community-page.js";

export const Route = createFileRoute("/community/")({
	component: () => <CommunityPage />,
	head: () => ({ meta: [{ title: "Community icons · Sketchi Icons" }] }),
});
