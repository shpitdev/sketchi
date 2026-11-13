/**
 * Writes public/media/home-diagram.svg, the diagram the home page shows
 * before a visitor edits it.
 *
 * home-diagram.excalidraw is real Sketchi output, unchanged. `sketchi generate`
 * drew it for the prompt in home-diagram-data.ts; scripts/diagrams/home-diagram.json
 * is the document it drew, so a new export keeps the drawing:
 *
 *   sketchi create --file apps/web/scripts/diagrams/home-diagram.json
 *   sketchi export latest --format excalidraw --dest apps/web/public/media/home-diagram.excalidraw
 *
 * The SVG is Excalidraw's own export of that scene, so it matches the canvas the
 * page loads in its place. Excalidraw subsets and inlines Excalifont into it,
 * which an SVG drawn by an <img> needs. Replace the scene, then run
 * `pnpm nx run web:home-diagram`.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";

import * as Linkedom from "linkedom";

import { HOME_DIAGRAM } from "../src/components/home-diagram/home-diagram-data.js";

const media = resolve(import.meta.dirname, "../public/media");
const require = createRequire(import.meta.url);
const excalidrawFonts = join(dirname(require.resolve("@excalidraw/excalidraw")), "fonts");

installHeadlessDom();
const { exportToSvg, restore } = await import("@excalidraw/excalidraw");

const file = JSON.parse(readFileSync(resolve(media, "home-diagram.excalidraw"), "utf8"));
const restored = restore(file, null, null);
const svg = await exportToSvg({
	elements: restored.elements,
	appState: {
		...restored.appState,
		exportBackground: false,
		exportEmbedScene: false,
		exportWithDarkMode: false,
	},
	files: restored.files,
	exportPadding: HOME_DIAGRAM.padding,
});
svg.setAttribute("role", "img");
const title = svg.ownerDocument.createElement("title");
title.textContent = HOME_DIAGRAM.alt;
svg.prepend(title);

// Excalidraw places each element at (x - origin.x, y - origin.y) in the export.
const [first] = restored.elements;
const [, left = "", top = ""] =
	/translate\(([-\d.]+) ([-\d.]+)\)/u.exec(
		svg.querySelector("g[transform]")?.getAttribute("transform") ?? "",
	) ?? [];
const exported = {
	width: Number(svg.getAttribute("width")),
	height: Number(svg.getAttribute("height")),
	origin: { x: (first?.x ?? 0) - Number(left), y: (first?.y ?? 0) - Number(top) },
};
const expected = {
	width: HOME_DIAGRAM.width,
	height: HOME_DIAGRAM.height,
	origin: HOME_DIAGRAM.origin,
};
if (JSON.stringify(exported) !== JSON.stringify(expected)) {
	throw new Error(
		`The export is ${JSON.stringify(exported)}; set HOME_DIAGRAM's width, height and origin to match.`,
	);
}
writeFileSync(resolve(media, "home-diagram.svg"), `${svg.outerHTML}\n`);

/**
 * The browser globals Excalidraw's export reads, from linkedom. Font files come
 * from the installed package instead of a CDN.
 */
function installHeadlessDom(): void {
	const { document, window } = Linkedom.parseHTML("<!doctype html><html><body></body></html>");
	const define = (target: object, property: string, value: unknown) =>
		Object.defineProperty(target, property, { configurable: true, value });

	define(globalThis, "window", window);
	define(globalThis, "document", document);
	define(globalThis, "navigator", window.navigator);
	define(window, "location", new URL("https://sketchi.app/"));
	define(window, "EXCALIDRAW_ASSET_PATH", "https://sketchi.app/");
	define(globalThis, "devicePixelRatio", 1);
	for (const [property, value] of Object.entries(Linkedom)) {
		if (!(property in globalThis)) define(globalThis, property, value);
	}
	define(
		globalThis,
		"ResizeObserver",
		class {
			disconnect() {}
			observe() {}
			unobserve() {}
		},
	);
	define(
		globalThis,
		"FontFace",
		class {
			constructor(
				readonly family: string,
				readonly source: unknown,
				readonly descriptors: FontFaceDescriptors = {},
			) {}
			get unicodeRange() {
				return this.descriptors.unicodeRange ?? "U+0-10FFFF";
			}
		},
	);
	// The export never draws on a canvas; Excalidraw only probes one at import.
	const context = new Proxy(
		{
			filter: "none",
			getLineDash: () => [],
			measureText: () => {
				throw new Error("The export must keep the scene's stored text sizes.");
			},
		},
		{ get: (target, property) => Reflect.get(target, property) ?? (() => undefined) },
	);
	define(Linkedom.HTMLCanvasElement.prototype, "getContext", () => context);
	define(window, "matchMedia", (media: string) => ({
		matches: false,
		media,
		addEventListener() {},
		removeEventListener() {},
		addListener() {},
		removeListener() {},
	}));

	const realFetch = globalThis.fetch;
	define(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = new URL(input instanceof Request ? input.url : String(input));
		if (url.origin === "https://sketchi.app" && url.pathname.startsWith("/fonts/")) {
			return new Response(
				readFileSync(join(excalidrawFonts, url.pathname.slice("/fonts/".length))),
				{
					headers: { "content-type": "font/woff2" },
				},
			);
		}
		return realFetch(input, init);
	});
}
