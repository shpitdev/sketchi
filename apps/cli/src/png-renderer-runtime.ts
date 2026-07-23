import { ExcalidrawFileSchema } from "@sketchi/diagram-agent";
import { Resvg, initWasm, type ResvgRenderOptions } from "@resvg/resvg-wasm";
import * as Linkedom from "linkedom";

import type { PngRenderInput } from "./png-renderer.js";
import {
  PNG_EXPORT_PADDING,
  PNG_EXPORT_SCALE,
  renderLimitFailure,
  renderedSvgLimitFailure,
} from "./render-limits.js";

declare const __SKETCHI_EXCALIFONT_BASE64__: ReadonlyArray<string>;
declare const __SKETCHI_RESVG_WASM_BASE64__: string;

const TITLE_FONT_SIZE = 24;
const TITLE_HEIGHT = 64;
const TITLE_HORIZONTAL_PADDING = 20;
const TITLE_VERTICAL_PADDING = 16;
const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

const EXCALIFONT_UNICODE_RANGES = [
  "U+20-7e,U+a0-a3,U+a5-a6,U+a8-ab,U+ad-b1,U+b4,U+b6-b8,U+ba-ff,U+131,U+152-153,U+2bc,U+2c6,U+2da,U+2dc,U+304,U+308,U+2013-2014,U+2018-201a,U+201c-201e,U+2020,U+2022,U+2024-2026,U+2030,U+2039-203a,U+20ac,U+2122,U+2212",
  "U+100-130,U+132-137,U+139-149,U+14c-151,U+154-17e,U+192,U+1fc-1ff,U+218-21b,U+237,U+1e80-1e85,U+1ef2-1ef3,U+2113",
  "U+400-45f,U+490-491,U+2116",
  "U+37e,U+384-38a,U+38c,U+38e-393,U+395-3a1,U+3a3-3a8,U+3aa-3cf,U+3d7",
  "U+2c7,U+2d8-2d9,U+2db,U+2dd,U+302,U+306-307,U+30a-30c,U+326-328,U+212e,U+2211,U+fb01-fb02",
  "U+462-463,U+472-475,U+4d8-4d9,U+4e2-4e3,U+4e6-4e9,U+4ee-4ef",
  "U+300-301,U+303",
].flatMap((descriptor) =>
  descriptor.split(",").map((range) => {
    const [start = "", explicitEnd] = range.slice(2).split("-");
    const end = explicitEnd ?? start;
    return [Number.parseInt(start, 16), Number.parseInt(end, 16)] as const;
  }),
);

function installHeadlessDom(): void {
  const { document: headlessDocument, window: headlessWindow } =
    Linkedom.parseHTML("<!doctype html><html><body></body></html>");

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
    onabort:
      | ((this: FileReader, event: ProgressEvent<FileReader>) => unknown)
      | null = null;
    onerror:
      | ((this: FileReader, event: ProgressEvent<FileReader>) => unknown)
      | null = null;
    onload:
      | ((this: FileReader, event: ProgressEvent<FileReader>) => unknown)
      | null = null;
    onloadend:
      | ((this: FileReader, event: ProgressEvent<FileReader>) => unknown)
      | null = null;
    onloadstart:
      | ((this: FileReader, event: ProgressEvent<FileReader>) => unknown)
      | null = null;
    onprogress:
      | ((this: FileReader, event: ProgressEvent<FileReader>) => unknown)
      | null = null;
    readyState = 0;
    result: string | ArrayBuffer | null = null;

    abort(): void {}

    readAsArrayBuffer(blob: Blob): void {
      this.read(blob, () => blob.arrayBuffer());
    }

    readAsBinaryString(blob: Blob): void {
      this.read(blob, async () =>
        Buffer.from(await blob.arrayBuffer()).toString("binary"),
      );
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
          const event = new Event(
            "load",
          ) as unknown as ProgressEvent<FileReader>;
          this.dispatchEvent(event);
          this.onload?.call(this as unknown as FileReader, event);
          this.onloadend?.call(this as unknown as FileReader, event);
          this.dispatchEvent(new Event("loadend"));
        },
        (cause: unknown) => {
          this.error = new DOMException(String(cause));
          this.readyState = 2;
          const event = new Event(
            "error",
          ) as unknown as ProgressEvent<FileReader>;
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
        throw new Error(
          "Headless PNG export must not replace stored text dimensions.",
        );
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

function decodeEmbeddedResource(value: string): Uint8Array<ArrayBuffer> {
  const source = Buffer.from(value, "base64");
  const decoded = new Uint8Array(source.byteLength);
  decoded.set(source);
  return decoded;
}

function unsupportedGlyph(text: string): string | undefined {
  for (const glyph of text) {
    const codePoint = glyph.codePointAt(0);
    if (
      codePoint !== undefined &&
      codePoint !== 0x09 &&
      codePoint !== 0x0a &&
      codePoint !== 0x0d &&
      !EXCALIFONT_UNICODE_RANGES.some(
        ([start, end]) => codePoint >= start && codePoint <= end,
      )
    ) {
      return `U+${codePoint.toString(16).toUpperCase().padStart(4, "0")}`;
    }
  }
  return undefined;
}

const fontBuffers = __SKETCHI_EXCALIFONT_BASE64__.map(decodeEmbeddedResource);
const fontOptions: ResvgRenderOptions = {
  font: {
    defaultFontFamily: "Excalifont",
    fontBuffers,
  },
  shapeRendering: 2,
  textRendering: 2,
};

function measureTitleWidth(title: string): number {
  const measurementWidth = Math.max(1, [...title].length * TITLE_FONT_SIZE * 2);
  const measurement = document.createElementNS(SVG_NAMESPACE, "svg");
  measurement.setAttribute("xmlns", SVG_NAMESPACE);
  measurement.setAttribute("width", String(measurementWidth));
  measurement.setAttribute("height", String(TITLE_HEIGHT));
  const text = document.createElementNS(SVG_NAMESPACE, "text");
  text.setAttribute("x", String(measurementWidth / 2));
  text.setAttribute("y", String(TITLE_FONT_SIZE + TITLE_VERTICAL_PADDING));
  text.setAttribute("font-family", "Excalifont");
  text.setAttribute("font-size", String(TITLE_FONT_SIZE));
  text.setAttribute("font-weight", "normal");
  text.setAttribute("text-anchor", "middle");
  text.textContent = title;
  measurement.appendChild(text);

  const rasterizer = new Resvg(measurement.outerHTML, fontOptions);
  try {
    const bounds = rasterizer.getBBox();
    if (!bounds) throw new Error("Unable to measure the title bounds.");
    try {
      return bounds.width;
    } finally {
      bounds.free();
    }
  } finally {
    rasterizer.free();
  }
}

function addTitle(
  svg: SVGSVGElement,
  title: string,
  backgroundColor: string,
): void {
  const viewBox = svg.getAttribute("viewBox")?.trim().split(/\s+/u).map(Number);
  if (!viewBox || viewBox.length !== 4 || viewBox.some(Number.isNaN)) {
    throw new Error("Excalidraw returned an SVG without a valid viewBox.");
  }
  const [minX, minY, width, height] = viewBox as [
    number,
    number,
    number,
    number,
  ];
  const centerX = minX + width / 2;
  const titleWidth = measureTitleWidth(title);
  const canvasWidth = Math.max(
    width,
    titleWidth + TITLE_HORIZONTAL_PADDING * 2,
  );
  const canvasMinX = centerX - canvasWidth / 2;
  svg.setAttribute(
    "viewBox",
    `${canvasMinX} ${minY - TITLE_HEIGHT} ${canvasWidth} ${height + TITLE_HEIGHT}`,
  );
  svg.setAttribute("width", String(canvasWidth * PNG_EXPORT_SCALE));
  svg.setAttribute(
    "height",
    String((height + TITLE_HEIGHT) * PNG_EXPORT_SCALE),
  );

  const background = svg.ownerDocument.createElementNS(SVG_NAMESPACE, "rect");
  background.setAttribute("x", String(canvasMinX));
  background.setAttribute("y", String(minY - TITLE_HEIGHT));
  background.setAttribute("width", String(canvasWidth));
  background.setAttribute("height", String(height + TITLE_HEIGHT));
  background.setAttribute("fill", backgroundColor);

  const text = svg.ownerDocument.createElementNS(SVG_NAMESPACE, "text");
  text.setAttribute("x", String(centerX));
  text.setAttribute("y", String(minY - TITLE_HEIGHT + TITLE_VERTICAL_PADDING));
  text.setAttribute("fill", "#1b1b1f");
  text.setAttribute("font-family", "Excalifont");
  text.setAttribute("font-size", String(TITLE_FONT_SIZE));
  text.setAttribute("font-weight", "normal");
  text.setAttribute("text-anchor", "middle");
  const span = svg.ownerDocument.createElementNS(SVG_NAMESPACE, "tspan");
  span.setAttribute("x", String(centerX));
  span.setAttribute("dy", "1em");
  span.textContent = title;
  text.appendChild(span);

  const firstGraphic = [...svg.children].find(
    (child) => child.tagName.toLowerCase() !== "defs",
  );
  svg.insertBefore(background, firstGraphic ?? null);
  svg.appendChild(text);
}

let resvgInitialization: Promise<void> | undefined;
function initializeResvg(): Promise<void> {
  resvgInitialization ??= initWasm(
    WebAssembly.compile(decodeEmbeddedResource(__SKETCHI_RESVG_WASM_BASE64__)),
  );
  return resvgInitialization;
}

let excalidrawModule:
  | Promise<typeof import("@excalidraw/excalidraw")>
  | undefined;
function loadExcalidraw() {
  if (!excalidrawModule) {
    installHeadlessDom();
    excalidrawModule = import("@excalidraw/excalidraw");
  }
  return excalidrawModule;
}

export async function renderPngBytes(
  input: PngRenderInput,
): Promise<Uint8Array> {
  const decodedExcalidraw = ExcalidrawFileSchema.safeParse(input.excalidraw);
  if (!decodedExcalidraw.success) {
    throw new Error("Stored Excalidraw data failed schema validation.");
  }
  const sizeFailure = renderLimitFailure(
    decodedExcalidraw.data.elements,
    input.scene ? TITLE_HEIGHT : 0,
  );
  if (sizeFailure) throw new Error(sizeFailure);
  const textValues = [
    ...(input.scene ? [input.scene.title] : []),
    ...decodedExcalidraw.data.elements.flatMap((element) =>
      "text" in element && typeof element["text"] === "string"
        ? [element["text"]]
        : [],
    ),
  ];
  for (const text of textValues) {
    const unsupported = unsupportedGlyph(text);
    if (unsupported) {
      throw new Error(
        `The bundled Excalifont does not support glyph ${unsupported}.`,
      );
    }
  }

  const [{ exportToSvg, loadFromBlob, MIME_TYPES }] = await Promise.all([
    loadExcalidraw(),
    initializeResvg(),
  ]);
  const restored = await loadFromBlob(
    new Blob([JSON.stringify(decodedExcalidraw.data)], {
      type: MIME_TYPES.excalidraw,
    }),
    null,
    null,
  );
  const svg = await exportToSvg({
    elements: restored.elements,
    appState: {
      ...restored.appState,
      exportBackground: true,
      exportEmbedScene: false,
      exportScale: PNG_EXPORT_SCALE,
      viewBackgroundColor:
        input.scene?.backgroundColor ??
        decodedExcalidraw.data.appState["viewBackgroundColor"] ??
        "#ffffff",
    },
    files: restored.files,
    exportPadding: PNG_EXPORT_PADDING,
    skipInliningFonts: true,
  });
  if (input.scene) {
    addTitle(svg, input.scene.title, input.scene.backgroundColor);
  }
  const svgWidth = Number.parseFloat(svg.getAttribute("width") ?? "");
  const svgHeight = Number.parseFloat(svg.getAttribute("height") ?? "");
  const svgFailure = renderedSvgLimitFailure(svgWidth, svgHeight);
  if (svgFailure) throw new Error(svgFailure);
  const rasterizer = new Resvg(svg.outerHTML, fontOptions);
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

export async function normalizeExcalidrawArtifact(
  input: unknown,
): Promise<unknown> {
  if (typeof input !== "object" || input === null) {
    throw new Error("Share payload is not an Excalidraw artifact.");
  }
  const candidate = {
    ...input,
    files: "files" in input ? input.files : {},
  };
  const inputAppState =
    "appState" in input &&
    typeof input.appState === "object" &&
    input.appState !== null
      ? input.appState
      : {};
  const { loadFromBlob, MIME_TYPES } = await loadExcalidraw();
  const restored = await loadFromBlob(
    new Blob([JSON.stringify(candidate)], { type: MIME_TYPES.excalidraw }),
    null,
    null,
  );
  return {
    type: "excalidraw",
    version: 2,
    source: "https://sketchi.app",
    elements: restored.elements,
    appState: {
      gridSize: restored.appState.gridSize,
      gridStep: restored.appState.gridStep,
      gridModeEnabled: restored.appState.gridModeEnabled,
      viewBackgroundColor: restored.appState.viewBackgroundColor,
      lockedMultiSelections:
        "lockedMultiSelections" in inputAppState
          ? inputAppState.lockedMultiSelections
          : {},
    },
    files: {},
  };
}
