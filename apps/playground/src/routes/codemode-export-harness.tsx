import { loadExcalidraw } from "@sketchi/diagram-ui";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";

import {
	exportExcalidrawPngBase64,
	type PngExportOptions,
} from "@/features/artifacts/excalidraw-png-export";

export const Route = createFileRoute("/codemode-export-harness")({
	component: CodeModeExportHarnessRoute,
});

declare global {
	var sketchiExportError: string | undefined;
	var sketchiExportPng:
		| ((scene: unknown, options: PngExportOptions) => Promise<string>)
		| undefined;
	var sketchiExportReady: boolean | undefined;
}

function CodeModeExportHarnessRoute() {
	// oxlint-disable-next-line sketchi/no-react-effects -- installs the window export bridge that Browser Rendering polls; it is the page's external-system boundary
	useEffect(() => {
		let active = true;
		globalThis.sketchiExportError = undefined;
		globalThis.sketchiExportReady = false;

		// Browser Rendering exports from this origin; fonts must not come from a CDN.
		void loadExcalidraw()
			.then(({ exportToBlob }) => {
				if (!active) {
					return;
				}

				globalThis.sketchiExportPng = (scene, options) =>
					exportExcalidrawPngBase64(exportToBlob, scene, options);
				globalThis.sketchiExportReady = true;
			})
			.catch((error: unknown) => {
				globalThis.sketchiExportError =
					error instanceof Error ? error.message : "Sketchi export harness failed to load.";
			});

		return () => {
			active = false;
		};
	}, []);

	return <main aria-hidden="true" hidden />;
}
