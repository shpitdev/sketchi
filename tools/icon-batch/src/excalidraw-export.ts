/**
 * Excalidraw's own SVG export in Node, rasterized by resvg: what the draw
 * service's harness page does with a browser canvas. The DOM it needs is the
 * CLI's headless PNG export setup (apps/cli/src/png-renderer-runtime.ts).
 */
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

import type { IconScene } from "@sketchi/icon-draw";
import { initWasm, Resvg, type ResvgRenderOptions } from "@resvg/resvg-wasm";
import * as Linkedom from "linkedom";

const require = createRequire(import.meta.url);

function installHeadlessDom(): void {
	const { document: headlessDocument, window: headlessWindow } = Linkedom.parseHTML(
		"<!doctype html><html><body></body></html>",
	);

	Object.defineProperty(globalThis, "window", {
		configurable: true,
		value: headlessWindow,
	});
	Object.defineProperty(globalThis, "document", {
		configurable: true,
		value: headlessDocument,
	});
	Object.defineProperty(globalThis, "navigator", {
		configurable: true,
		value: headlessWindow.navigator,
	});
	Object.defineProperty(headlessWindow, "location", {
		configurable: true,
		value: new URL("https://offline.sketchi.invalid/"),
	});
	Object.defineProperty(globalThis, "devicePixelRatio", {
		configurable: true,
		value: 1,
	});
	for (const [property, value] of Object.entries(Linkedom)) {
		if (property in globalThis) continue;
		Object.defineProperty(globalThis, property, { configurable: true, value });
	}

	class ResizeObserverStub implements ResizeObserver {
		disconnect(): void {}
		observe(): void {}
		unobserve(): void {}
	}

	class FontFaceStub {
		readonly display: FontDisplay;
		readonly family: string;
		readonly stretch: string;
		readonly style: string;
		readonly unicodeRange: string;
		readonly weight: string;

		constructor(
			family: string,
			_source: string | BufferSource,
			descriptors: FontFaceDescriptors = {},
		) {
			this.display = descriptors.display ?? "auto";
			this.family = family;
			this.stretch = descriptors.stretch ?? "normal";
			this.style = descriptors.style ?? "normal";
			this.unicodeRange = descriptors.unicodeRange ?? "U+0-10FFFF";
			this.weight = descriptors.weight ?? "normal";
		}
	}

	class FileReaderStub extends EventTarget {
		static readonly DONE = 2;
		static readonly EMPTY = 0;
		static readonly LOADING = 1;

		error: DOMException | null = null;
		onabort: ((this: FileReader, event: ProgressEvent<FileReader>) => unknown) | null = null;
		onerror: ((this: FileReader, event: ProgressEvent<FileReader>) => unknown) | null = null;
		onload: ((this: FileReader, event: ProgressEvent<FileReader>) => unknown) | null = null;
		onloadend: ((this: FileReader, event: ProgressEvent<FileReader>) => unknown) | null = null;
		onloadstart: ((this: FileReader, event: ProgressEvent<FileReader>) => unknown) | null = null;
		onprogress: ((this: FileReader, event: ProgressEvent<FileReader>) => unknown) | null = null;
		readyState = 0;
		result: string | ArrayBuffer | null = null;

		abort(): void {}

		readAsArrayBuffer(blob: Blob): void {
			this.read(blob, () => blob.arrayBuffer());
		}

		readAsBinaryString(blob: Blob): void {
			this.read(blob, async () => Buffer.from(await blob.arrayBuffer()).toString("binary"));
		}

		readAsDataURL(blob: Blob): void {
			this.read(blob, async () => {
				const base64 = Buffer.from(await blob.arrayBuffer()).toString("base64");
				return `data:${blob.type};base64,${base64}`;
			});
		}

		readAsText(blob: Blob): void {
			this.read(blob, () => blob.text());
		}

		private read(blob: Blob, load: () => Promise<string | ArrayBuffer>): void {
			this.readyState = 1;
			void load().then(
				(result) => {
					this.result = result;
					this.readyState = 2;
					const event = new Event("load") as unknown as ProgressEvent<FileReader>;
					this.dispatchEvent(event);
					this.onload?.call(this as unknown as FileReader, event);
					this.onloadend?.call(this as unknown as FileReader, event);
					this.dispatchEvent(new Event("loadend"));
				},
				(cause: unknown) => {
					this.error = new DOMException(String(cause));
					this.readyState = 2;
					const event = new Event("error") as unknown as ProgressEvent<FileReader>;
					this.dispatchEvent(event);
					this.onerror?.call(this as unknown as FileReader, event);
					this.onloadend?.call(this as unknown as FileReader, event);
					this.dispatchEvent(new Event("loadend"));
				},
			);
		}
	}

	Object.defineProperty(globalThis, "ResizeObserver", {
		configurable: true,
		value: ResizeObserverStub,
	});
	Object.defineProperty(globalThis, "FontFace", {
		configurable: true,
		value: FontFaceStub,
	});
	Object.defineProperty(globalThis, "FileReader", {
		configurable: true,
		value: FileReaderStub,
	});
	Object.defineProperty(headlessWindow, "matchMedia", {
		configurable: true,
		value: (query: string): MediaQueryList => ({
			matches: false,
			media: query,
			onchange: null,
			addEventListener: () => undefined,
			removeEventListener: () => undefined,
			addListener: () => undefined,
			removeListener: () => undefined,
			dispatchEvent: () => false,
		}),
	});

	const canvasContext = new Proxy(
		{
			canvas: headlessDocument.createElement("canvas"),
			filter: "none",
			getImageData: () => ({ data: new Uint8ClampedArray(4) }),
			getLineDash: () => [],
			measureText: () => {
				throw new Error("Headless PNG export must not replace stored text dimensions.");
			},
		},
		{
			get(target, property) {
				if (property in target) return Reflect.get(target, property);
				return () => undefined;
			},
		},
	);
	Object.defineProperty(Linkedom.HTMLCanvasElement.prototype, "getContext", {
		configurable: true,
		value: () => canvasContext,
	});
}

const excalifontDirectory = join(
	dirname(require.resolve("@excalidraw/excalidraw")),
	"fonts/Excalifont",
);

let fonts: ResvgRenderOptions | undefined;
/** resvg options that draw text in Excalifont, as Excalidraw does. */
export function excalifontOptions(): ResvgRenderOptions {
	fonts ??= {
		font: {
			defaultFontFamily: "Excalifont",
			fontBuffers: readdirSync(excalifontDirectory)
				.filter((file) => file.endsWith(".woff2"))
				.sort()
				.map((file) => new Uint8Array(readFileSync(join(excalifontDirectory, file)))),
		},
		shapeRendering: 2,
		textRendering: 2,
	};
	return fonts;
}

let resvg: Promise<void> | undefined;
/** Load resvg's WebAssembly once per process. */
export function initializeResvg(): Promise<void> {
	resvg ??= initWasm(readFileSync(require.resolve("@resvg/resvg-wasm/index_bg.wasm")));
	return resvg;
}

let excalidraw: Promise<typeof import("@excalidraw/excalidraw")> | undefined;
function loadExcalidraw() {
	if (!excalidraw) {
		installHeadlessDom();
		excalidraw = import("@excalidraw/excalidraw");
	}
	return excalidraw;
}

/** Rasterize SVG markup to PNG bytes at its own size. */
export function svgPng(svg: string): Uint8Array {
	const rasterizer = new Resvg(svg, excalifontOptions());
	try {
		const rendered = rasterizer.render();
		try {
			return Uint8Array.from(rendered.asPng());
		} finally {
			rendered.free();
		}
	} finally {
		rasterizer.free();
	}
}

/** An Excalidraw scene exported on white, as Excalidraw's PNG export frames it. */
export async function exportScenePng(
	scene: IconScene,
	options: { readonly padding: number; readonly scale: number; readonly backgroundColor: string },
): Promise<Uint8Array> {
	const [{ exportToSvg, restore }] = await Promise.all([loadExcalidraw(), initializeResvg()]);
	const restored = restore(
		{
			elements: scene.elements as never,
			appState: scene.appState as never,
			files: scene.files as never,
		},
		null,
		null,
	);
	const svg = await exportToSvg({
		elements: restored.elements,
		appState: {
			...restored.appState,
			exportBackground: true,
			exportEmbedScene: false,
			exportScale: options.scale,
			viewBackgroundColor: options.backgroundColor,
		},
		files: restored.files,
		exportPadding: options.padding,
		reuseImages: false,
		skipInliningFonts: true,
	});
	return svgPng(svg.outerHTML);
}
