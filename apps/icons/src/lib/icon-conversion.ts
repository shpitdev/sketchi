import {
  convertSvgToExcalidraw,
  parseSvg,
  serializeExcalidrawLibrary,
  type NativeFillStyle,
  type NativeRoughness,
  type SvgDiagnostic,
  type SvgToExcalidrawResult,
} from "@sketchi/svg-excalidraw";

export type IconColorMode = "monochrome" | "preserve";

export interface IconConversionControls {
  readonly color: string;
  readonly colorMode: IconColorMode;
  readonly fillStyle: NativeFillStyle;
  readonly roughness: NativeRoughness;
}

export const DEFAULT_ICON_CONVERSION_CONTROLS: IconConversionControls = {
  color: "#1e1e1e",
  colorMode: "preserve",
  fillStyle: "solid",
  roughness: 1,
};

export type IconConversionResult =
  | {
      readonly diagnostics: readonly SvgDiagnostic[];
      readonly kind: "parse-error";
    }
  | {
      readonly conversion: SvgToExcalidrawResult;
      readonly kind: "converted";
      readonly status: "blocked" | "supported" | "warned";
    };

export function convertIconSvg(
  source: string,
  sourceName: string,
  controls: IconConversionControls,
): IconConversionResult {
  const parsed = parseSvg(source, { sourceName });
  if (!parsed.ok) {
    return { diagnostics: parsed.diagnostics, kind: "parse-error" };
  }
  const conversion = convertSvgToExcalidraw(parsed.document, {
    colorProfile:
      controls.colorMode === "monochrome"
        ? { color: controls.color, kind: "monochrome" }
        : { kind: "preserve" },
    fillStyle: controls.fillStyle,
    roughness: controls.roughness,
  });
  return {
    conversion,
    kind: "converted",
    status: conversion.ok
      ? conversion.diagnostics.some(
          (diagnostic) => diagnostic.severity === "warning",
        )
        ? "warned"
        : "supported"
      : "blocked",
  };
}

export function iconLibraryJson(
  conversion: Extract<SvgToExcalidrawResult, { readonly ok: true }>,
  name: string,
): string {
  return serializeExcalidrawLibrary([
    {
      elements: conversion.elements,
      id: `svg:${conversion.sourceHash}`,
      name,
    },
  ]);
}

export function downloadTextFile(
  contents: string,
  fileName: string,
  mimeType: string,
): void {
  const url = URL.createObjectURL(new Blob([contents], { type: mimeType }));
  const anchor = document.createElement("a");
  anchor.download = fileName;
  anchor.href = url;
  anchor.click();
  URL.revokeObjectURL(url);
}
