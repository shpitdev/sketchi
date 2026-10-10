import "@tanstack/react-start/server-only";

import type { CodeModeObjectBucket } from "@sketchi/diagram-agent";
import type { CloudflareAiGatewayProvider } from "@sketchi/diagram-generation";

import type { CloudflareBrowserRunBinding } from "../codemode/browser-renderer.server";
import type { PlaygroundAssetsBinding } from "../codemode/icon-catalog.server";

export interface StudioEnv {
	AI?: CloudflareAiGatewayProvider;
	ASSETS?: PlaygroundAssetsBinding;
	BROWSER?: CloudflareBrowserRunBinding;
	CODEMODE_USAGE_EVENTS?: CodeModeUsagePipelineBinding;
	CODEMODE_USAGE_ISSUES?: CodeModeUsagePipelineBinding;
	LOADER?: unknown;
	SKETCHI_ARTIFACTS?: CodeModeObjectBucket;
	SKETCHI_AI_GATEWAY_ID?: string;
	SKETCHI_AI_MODEL?: string;
	SKETCHI_RENDER_ASSET_ORIGIN?: string;
}

export interface CodeModeUsagePipelineBinding {
	send(records: readonly unknown[]): Promise<void>;
}
