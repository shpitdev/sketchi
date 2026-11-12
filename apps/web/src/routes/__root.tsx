import { Button } from "@sketchi/ui/components/button";
import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router";

import { SITE_DESCRIPTION, siteSocialMeta } from "../lib/site-meta";
import appStyles from "../styles/app.css?url";

// Site-wide fallback copy. Each page overrides title/description (and adds its
// own og:url + canonical) via `pageMeta`; these values also cover the 404 page.
const FALLBACK_TITLE = "Sketchi";

export const Route = createRootRoute({
	head: () => ({
		meta: [
			{ charSet: "utf-8" },
			{
				name: "viewport",
				content: "width=device-width, initial-scale=1",
			},
			{ name: "description", content: SITE_DESCRIPTION },
			{ name: "theme-color", content: "#f6f1e7" },
			{ title: FALLBACK_TITLE },
			// Page-agnostic OpenGraph/Twitter tags (image, card, type, site name).
			...siteSocialMeta(),
		],
		links: [
			{ rel: "icon", href: "/icon.svg", type: "image/svg+xml" },
			{ rel: "preconnect", href: "https://fonts.googleapis.com" },
			{
				rel: "preconnect",
				href: "https://fonts.gstatic.com",
				crossOrigin: "anonymous",
			},
			{
				rel: "stylesheet",
				href: "https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400..700&family=IBM+Plex+Mono:wght@400;500;600&display=swap",
			},
			{ rel: "stylesheet", href: appStyles },
		],
	}),
	component: RootComponent,
	notFoundComponent: NotFoundComponent,
});

function RootComponent() {
	return (
		<html lang="en">
			<head>
				<HeadContent />
			</head>
			<body>
				<Outlet />
				<Scripts />
			</body>
		</html>
	);
}

function NotFoundComponent() {
	return (
		<main className="sketchi-not-found">
			<h1>This page isn&rsquo;t on the board.</h1>
			<Button asChild size="xl" variant="brand">
				<a href="/">Back to Sketchi</a>
			</Button>
		</main>
	);
}
