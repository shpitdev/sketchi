import "@tanstack/react-start/server-only";

import type { CommunityIconDatabase } from "@sketchi/community-icons";
import type { CodeModeObjectBucket } from "@sketchi/diagram-agent";
import type { CloudflareAiGatewayProvider, WorkersAiRunner } from "@sketchi/diagram-generation";
import type { TelemetryPipeline } from "@sketchi/observability";

import type { CodeModePngRendererNamespace } from "../codemode/browser-renderer.server";
import type { PlaygroundAssetsBinding } from "../codemode/icon-catalog.server";

export interface StudioEnv {
	/** Workers AI: the AI Gateway for generation, and `run` for Jev's family narrowing. */
	AI?: CloudflareAiGatewayProvider & Partial<WorkersAiRunner>;
	ASSETS?: PlaygroundAssetsBinding;
	CODEMODE_PNG_RENDERER?: CodeModePngRendererNamespace;
	/** D1: the community icons the icons app publishes, which diagrams draw by slug. */
	COMMUNITY_ICONS?: CommunityIconDatabase;
	LOADER?: unknown;
	SKETCHI_ARTIFACTS?: CodeModeObjectBucket;
	SKETCHI_AI_GATEWAY_ID?: string;
	SKETCHI_AI_GENERATE_MODEL?: string;
	SKETCHI_AI_MODEL?: string;
	SKETCHI_RENDER_ASSET_ORIGIN?: string;
	TELEMETRY_SPANS?: TelemetryPipeline;
}
