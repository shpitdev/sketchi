import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router";

import { pageMeta, SITE_DESCRIPTION, SITE_IMAGE, SITE_TITLE } from "../lib/site-meta.js";
import appStyles from "../styles/app.css?url";

export const Route = createRootRoute({
	head: () => ({
		meta: [
			{ charSet: "utf-8" },
			{
				name: "viewport",
				content: "width=device-width, initial-scale=1",
			},
			{ name: "theme-color", content: "#f6f1e7" },
			{ property: "og:type", content: "website" },
			{ property: "og:site_name", content: "Sketchi" },
			...pageMeta({
				title: SITE_TITLE,
				description: SITE_DESCRIPTION,
				path: "/",
				image: SITE_IMAGE,
			}),
		],
		links: [
			{ rel: "icon", href: "/icon.svg", type: "image/svg+xml" },
			// Excalifont's Latin subset letters the drawn marks, such as a wordmark's
			// name; preload it so they never paint through a fallback first.
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
		<main className="sketchi-icons-not-found">
			<h1>Not found</h1>
			<a href="/">Browse icons</a>
		</main>
	);
}
