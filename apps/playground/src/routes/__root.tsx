import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router";

import "@sketchi/diagram-ui/styles.css";
import appStyles from "../styles/app.css?url";

const DESCRIPTION =
	"Describe a diagram in chat and Sketchi draws it in Excalidraw. Ask for changes, edit it by hand, then export a PNG or an Excalidraw file.";

const CARD = {
	url: "https://sketchi.app/media/sketchi-card.png",
	alt: "The Sketchi wordmark beside a hand-drawn architecture diagram Sketchi made: a Next.js app on Vercel and a GitHub webhook call an API on Cloudflare Workers, which reads Postgres and caches in Redis.",
} as const;

export const Route = createRootRoute({
	head: () => ({
		meta: [
			{ charSet: "utf-8" },
			{
				name: "viewport",
				content: "width=device-width, initial-scale=1",
			},
			{ name: "description", content: DESCRIPTION },
			{ name: "theme-color", content: "#f6f1e7" },
			{ title: "Sketchi Playground" },
			{ property: "og:type", content: "website" },
			{ property: "og:site_name", content: "Sketchi" },
			{ property: "og:title", content: "Sketchi Playground" },
			{ property: "og:description", content: DESCRIPTION },
			{ property: "og:url", content: "https://playground.sketchi.app/" },
			// sketchi.app's card (apps/web/src/lib/site-meta.ts), by absolute URL for crawlers.
			{ property: "og:image", content: CARD.url },
			{ property: "og:image:type", content: "image/png" },
			{ property: "og:image:width", content: "1200" },
			{ property: "og:image:height", content: "630" },
			{ property: "og:image:alt", content: CARD.alt },
			{ name: "twitter:card", content: "summary_large_image" },
			{ name: "twitter:title", content: "Sketchi Playground" },
			{ name: "twitter:description", content: DESCRIPTION },
			{ name: "twitter:image", content: CARD.url },
			{ name: "twitter:image:alt", content: CARD.alt },
		],
		links: [
			{ rel: "icon", href: "/icon.svg", type: "image/svg+xml" },
			// Excalifont's Latin subset is the face Excalidraw draws diagram text
			// in; preload it so a diagram paints in it without reflowing.
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
