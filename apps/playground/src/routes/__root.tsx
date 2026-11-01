import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router";

import "@sketchi/diagram-ui/styles.css";
import appStyles from "../styles/app.css?url";

export const Route = createRootRoute({
	head: () => ({
		meta: [
			{ charSet: "utf-8" },
			{
				name: "viewport",
				content: "width=device-width, initial-scale=1",
			},
			{ name: "description", content: "Describe a diagram in chat, then edit or export it." },
			{ name: "theme-color", content: "#f6f1e7" },
			{ title: "Sketchi Playground" },
			{ property: "og:type", content: "website" },
			{ property: "og:site_name", content: "Sketchi" },
			{ property: "og:title", content: "Sketchi Playground" },
			{
				property: "og:description",
				content: "Describe a diagram in chat, then edit or export it.",
			},
			// The site's card: served from sketchi.app because crawlers need an absolute URL.
			{ property: "og:image", content: "https://sketchi.app/media/sketchi-og-card.png" },
			{ property: "og:image:width", content: "1200" },
			{ property: "og:image:height", content: "630" },
			{ name: "twitter:card", content: "summary_large_image" },
			{ name: "twitter:title", content: "Sketchi Playground" },
			{
				name: "twitter:description",
				content: "Describe a diagram in chat, then edit or export it.",
			},
			{ name: "twitter:image", content: "https://sketchi.app/media/sketchi-og-card.png" },
		],
		links: [
			{ rel: "icon", href: "/icon.svg", type: "image/svg+xml" },
			// Excalifont's Latin subset backs the wordmark; preload it so the
			// lockup paints in the product's own hand instead of reflowing
			// through the sans fallback.
			{
				rel: "preload",
				as: "font",
				type: "font/woff2",
				href: "/fonts/Excalifont/Excalifont-Regular-a88b72a24fb54c9f94e3b5fdaa7481c9.woff2",
				crossOrigin: "anonymous",
			},
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
		<main className="studio-not-found">
			<h1>Playground route not found</h1>
		</main>
	);
}
