import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";

export const Route = createFileRoute("/codemode-export-harness")({
  component: CodeModeExportHarnessRoute,
});

interface PngExportOptions {
  backgroundColor: string;
  padding: number;
  scale: number;
}

interface ExcalidrawExportScene {
  appState?: Record<string, unknown>;
  elements?: unknown[];
}

declare global {
  var EXCALIDRAW_ASSET_PATH: string | undefined;
  var sketchiExportError: string | undefined;
  var sketchiExportPng:
    | ((scene: unknown, options: PngExportOptions) => Promise<string>)
    | undefined;
  var sketchiExportReady: boolean | undefined;
}

function CodeModeExportHarnessRoute() {
  useEffect(() => {
    let active = true;
    globalThis.EXCALIDRAW_ASSET_PATH = "/";
    globalThis.sketchiExportError = undefined;
    globalThis.sketchiExportReady = false;

    void import("@excalidraw/excalidraw")
      .then(({ exportToBlob }) => {
        if (!active) {
          return;
        }

        globalThis.sketchiExportPng = async (
          scene: unknown,
          options: PngExportOptions,
        ): Promise<string> => {
          const exportScene = isExportScene(scene) ? scene : {};
          const appState = exportScene.appState ?? {};
          const backgroundColor =
            options.backgroundColor ??
            (typeof appState.viewBackgroundColor === "string"
              ? appState.viewBackgroundColor
              : "#ffffff");

          const blob = await exportToBlob({
            elements: Array.isArray(exportScene.elements)
              ? exportScene.elements
              : [],
            appState: {
              ...appState,
              exportBackground: true,
              exportScale: options.scale,
              viewBackgroundColor: backgroundColor,
            },
            exportPadding: options.padding,
            files: null,
            mimeType: "image/png",
          });

          const buffer = await blob.arrayBuffer();
          const bytes = new Uint8Array(buffer);
          let binary = "";
          for (let index = 0; index < bytes.byteLength; index += 1) {
            binary += String.fromCharCode(bytes[index] ?? 0);
          }

          return btoa(binary);
        };
        globalThis.sketchiExportReady = true;
      })
      .catch((error: unknown) => {
        globalThis.sketchiExportError =
          error instanceof Error
            ? error.message
            : "Sketchi export harness failed to load.";
      });

    return () => {
      active = false;
    };
  }, []);

  return <main aria-hidden="true" hidden />;
}

function isExportScene(value: unknown): value is ExcalidrawExportScene {
  return Boolean(value) && typeof value === "object";
}
