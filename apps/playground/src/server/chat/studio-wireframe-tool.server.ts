import "@tanstack/react-start/server-only";
import {
	BuildWireframeResultSchema,
	BuildWireframeToolInputSchema,
	type BuildWireframeResult,
	type BuildWireframeToolInput,
} from "@sketchi/diagram-agent";
import type { Effect } from "effect";
import { toPlaygroundStandardSchema } from "../schema/effect-standard-schema.server";
import { makeStudioBuildToolExecutor, type StudioBuildTurn } from "./studio-build-tool.server";

export const STUDIO_BUILD_WIREFRAME_TOOL_NAME = "build_wireframe" as const;
export const STUDIO_BUILD_WIREFRAME_TOOL_DESCRIPTION =
	'Build and persist a native low-fidelity wireframe: each screen a frame the size of its device, its header across the top, footer along the bottom and sidebars down their sides, and every component laid out and grouped. Give each screen a name, device ("desktop", "tablet" or "mobile") and children: containers (header, footer, sidebar, main, section, card, modal, row, column, grid with columns: n) hold children; widgets are heading, text, link, badge and button (text), input, textarea, select, search, checkbox, radio and toggle (label, placeholder or value), tabs, nav, breadcrumbs and list (items), and avatar, icon, image, chart, table (columns) and divider placeholders. Mark state: variant "primary", checked, active. The host lays out every screen. Repair structured issues, up to three total attempts.';
export const StudioBuildWireframeInputSchema = toPlaygroundStandardSchema(
	BuildWireframeToolInputSchema,
);
export const StudioBuildWireframeOutputSchema = toPlaygroundStandardSchema(
	BuildWireframeResultSchema,
);
export function makeStudioWireframeToolExecutor<E, R>(
	build: (input: unknown) => Effect.Effect<BuildWireframeResult, E, R>,
	options: { readonly turn?: StudioBuildTurn } = {},
) {
	return makeStudioBuildToolExecutor<BuildWireframeToolInput, BuildWireframeResult, E, R>({
		build,
		rejected: (issue) => ({ ok: false, status: "quality_failed", issues: [issue] }),
		ground: (input) => ({ input, issues: [] }),
		operation: "buildWireframe",
		...options,
	});
}
