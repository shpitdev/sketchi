import { createRequire, registerHooks } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

import type { ExcalidrawEditor } from "./edit-session.js";

/**
 * The module of Excalidraw 0.18.1's build that holds its editor: the scene,
 * restore, drag, resize and binding code a person's edits run through. Excalidraw
 * exports none of it from its package entry. The name is fixed by the exact
 * version this package pins.
 */
const EDITOR_MODULE = "dist/dev/chunk-4FTI6OG3.js";

const require = createRequire(import.meta.url);

let hooked = false;

/**
 * Excalidraw's build is written for bundlers: it imports packages' files without
 * their extension (`roughjs/bin/rough`) and JSON without an import attribute
 * (`open-color`). Plain Node refuses both, so a dependency's import that fails
 * to resolve is tried again with `.js`, and a dependency's JSON loads as JSON.
 * Nothing outside node_modules is touched.
 */
function hookBundlerImports() {
	if (hooked) return;
	hooked = true;
	const inDependency = (url: string | undefined) => url?.includes("/node_modules/") ?? false;
	registerHooks({
		resolve(specifier, context, nextResolve) {
			try {
				return nextResolve(specifier, context);
			} catch (error) {
				if (
					!inDependency(context.parentURL) ||
					!specifier.includes("/") ||
					specifier.endsWith(".js")
				)
					throw error;
				return nextResolve(`${specifier}.js`, context);
			}
		},
		load(url, context, nextLoad) {
			return url.endsWith(".json") && inDependency(url) && !context.importAttributes["type"]
				? nextLoad(url, {
						...context,
						importAttributes: { ...context.importAttributes, type: "json" },
					})
				: nextLoad(url, context);
		},
	});
}

/**
 * The browser globals Excalidraw reads as its module loads, from linkedom: it
 * measures nothing and paints nothing here, so a light DOM serves. A DOM
 * already present, as in a jsdom test, is left alone.
 */
function installHeadlessDom(parseHTML: typeof import("linkedom").parseHTML) {
	if (globalThis.document !== undefined) return;
	const { document, window } = parseHTML("<!doctype html><html><body></body></html>");
	Object.defineProperty(window, "location", {
		configurable: true,
		value: new URL("https://editability.sketchi.invalid/"),
	});
	for (const [name, value] of [
		["window", window],
		["document", document],
		["devicePixelRatio", 1],
	] as const) {
		Object.defineProperty(globalThis, name, { configurable: true, value, writable: true });
	}
}

/** The editor module's URL. The package entry resolves to dist/prod/index.js; the module sits beside it. */
const editorModule = () =>
	pathToFileURL(
		path.join(
			path.resolve(path.dirname(require.resolve("@excalidraw/excalidraw")), "../.."),
			EDITOR_MODULE,
		),
	).href;

/**
 * Runs `edit` with every timer it starts unref'd, so none holds the process
 * open. Excalidraw's Scene throttles an index check with a one-minute timer that
 * does nothing when it fires (lodash throttle, leading edge only): harmless in a
 * browser tab, a minute's wait at the end of a CLI run.
 */
export function withoutHeldTimers<T>(edit: () => T): T {
	const setTimeout = globalThis.setTimeout;
	globalThis.setTimeout = ((...args: Parameters<typeof setTimeout>) =>
		setTimeout(...args).unref()) as typeof globalThis.setTimeout;
	try {
		return edit();
	} finally {
		globalThis.setTimeout = setTimeout;
	}
}

let editor: Promise<ExcalidrawEditor> | undefined;

/** Excalidraw 0.18.1's editor, loaded once per process into plain Node. */
export function loadExcalidrawEditor(): Promise<ExcalidrawEditor> {
	editor ??= import("linkedom").then(({ parseHTML }) => {
		hookBundlerImports();
		installHeadlessDom(parseHTML);
		return import(editorModule()) as Promise<ExcalidrawEditor>;
	});
	return editor;
}
