/**
 * The diagram on the home page: real Sketchi output, committed as the scene
 * Sketchi returned (public/media/home-diagram.excalidraw) and as Excalidraw's
 * SVG export of it (public/media/home-diagram.svg, written by
 * scripts/home-diagram.ts).
 */
export const HOME_DIAGRAM = {
	/** The request that produced the scene, word for word. */
	prompt:
		"A Next.js app on Vercel and a GitHub webhook call a Cloudflare Workers API, which reads Postgres and caches in Redis.",
	/** The title Sketchi gave it; Excalidraw names saved files after it. */
	title: "Next.js and GitHub API flow",
	scene: "/media/home-diagram.excalidraw",
	image: "/media/home-diagram.svg",
	alt: "A hand-drawn architecture diagram: a Next.js app hosted on Vercel and a GitHub webhook both call a Cloudflare Workers API, which reads PostgreSQL and caches in Redis. Each box carries its product's logo.",
	/** Excalidraw's export size at scale 1, padding included. */
	width: 514,
	height: 705,
	/** Space the export leaves around the drawing, in scene units. */
	padding: 16,
	/**
	 * The scene point at the export's top-left corner. The editor opens with
	 * this point at the canvas corner, at the zoom the image is drawn at, so
	 * the drawing does not move when the canvas replaces the image.
	 */
	origin: { x: 32, y: 32 },
} as const;
