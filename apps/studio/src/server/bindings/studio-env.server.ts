import "@tanstack/react-start/server-only";

import type { ClientLimitNamespace, CommunityEnv } from "@sketchi/community-icons";
import type { ArtifactObjectBucket } from "@sketchi/diagrams/build";
import type { CloudflareAiGatewayProvider } from "@sketchi/cloudflare/ai-gateway";
import type { WorkersAiRunner } from "@sketchi/diagrams/generate/jev-workers-ai";
import type { TelemetryPipeline } from "@sketchi/observability";

import type { CodeModePngRendererNamespace } from "../../features/render/browser-renderer.server";
import type { IconDrawBudgetNamespace } from "../icons/budget-object.server";
import type { PlaygroundAssetsBinding } from "../../features/build/icon-catalog.server";

export interface StudioEnv {
	/** Workers AI: the AI Gateway for generation, and `run` for Jev's family narrowing. */
	AI?: CloudflareAiGatewayProvider & Partial<WorkersAiRunner>;
	ASSETS?: PlaygroundAssetsBinding;
	CODEMODE_PNG_RENDERER?: CodeModePngRendererNamespace;
	STUDIO_MCP_SESSION?: import("@sketchi/cloudflare/mcp-session").McpSessionNamespace;
	/** D1: the community icons the icons app publishes, which diagrams draw by slug. */
	COMMUNITY_ICONS?: CommunityEnv["COMMUNITY_ICONS"];
	LOADER?: import("../../features/mcp/sandbox.server").SketchiWorkerLoader;
	SKETCHI_ARTIFACTS?: ArtifactObjectBucket;
	SKETCHI_AI_GATEWAY_ID?: string;
	SKETCHI_AI_GENERATE_MODEL?: string;
	SKETCHI_STUDIO_MODEL?: string;
	/** The author model icon drawing uses when a request names none. */
	SKETCHI_ICON_AUTHOR_MODEL?: string;
	/** The model that judges a drawn icon; another family than the author's. */
	SKETCHI_ICON_JUDGE_MODEL?: string;
	/** Icon draws a day across every client; the bound on drawing spend. */
	SKETCHI_ICON_DAILY_DRAWS?: string;
	/** One limit object per client address, counting its icon draw requests. */
	ICON_DRAW_CLIENT_LIMIT?: ClientLimitNamespace;
	/** The daily icon-draw count. */
	ICON_DRAW_BUDGET?: IconDrawBudgetNamespace;
	SKETCHI_RENDER_ASSET_ORIGIN?: string;
	TELEMETRY_SPANS?: TelemetryPipeline;
}
