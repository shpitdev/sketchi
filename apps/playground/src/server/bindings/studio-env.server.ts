import "@tanstack/react-start/server-only";

import type { CommunityIconDatabase } from "@sketchi/community-icons";
import type { CodeModeObjectBucket } from "@sketchi/diagram-agent";
import type { CloudflareAiGatewayProvider, WorkersAiRunner } from "@sketchi/diagram-generation";
import type { TelemetryPipeline } from "@sketchi/observability";

import type { CodeModePngRendererNamespace } from "../codemode/browser-renderer.server";
import type { IconDrawBudgetNamespace } from "../icons/budget-object.server";
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
	/** The author model icon drawing uses when a request names none. */
	SKETCHI_ICON_AUTHOR_MODEL?: string;
	/** The model that judges a drawn icon; another family than the author's. */
	SKETCHI_ICON_JUDGE_MODEL?: string;
	/** Icon draws a day across every client; the bound on drawing spend. */
	SKETCHI_ICON_DAILY_DRAWS?: string;
	/** Workers rate limit on icon draws, keyed by client IP. */
	ICON_DRAW_RATE_LIMIT?: { limit(options: { key: string }): Promise<{ success: boolean }> };
	/** The daily icon-draw count. */
	ICON_DRAW_BUDGET?: IconDrawBudgetNamespace;
	SKETCHI_RENDER_ASSET_ORIGIN?: string;
	TELEMETRY_SPANS?: TelemetryPipeline;
}
