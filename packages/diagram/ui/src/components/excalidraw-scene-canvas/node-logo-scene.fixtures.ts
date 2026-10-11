import {
	deployPipelineLogoFlowchart,
	deployWebhookLogoSequence,
	embedCanvasIcons,
	type CanvasIconAsset,
	type LayoutDirection,
} from "@sketchi/diagram-core";
import {
	renderIntermediateDiagram,
	renderSequenceDiagram,
	type RenderedDiagramScene,
} from "@sketchi/diagram-renderer";
import { normalizeNodeLogoSvg } from "@sketchi/icon-catalog";
import cloudflare from "@sketchi/icon-catalog/svg/cloud-vendors/cloudflare.svg?raw";
import docker from "@sketchi/icon-catalog/svg/devtools-ci/docker.svg?raw";
import github from "@sketchi/icon-catalog/svg/devtools-ci/github.svg?raw";
import vitest from "@sketchi/icon-catalog/svg/devtools-ci/vitest.svg?raw";

const NODE_LOGOS: Readonly<Record<string, CanvasIconAsset>> = {
	cloudflare: { name: "Cloudflare", svg: normalizeNodeLogoSvg(cloudflare) },
	docker: { name: "Docker", svg: normalizeNodeLogoSvg(docker) },
	github: { name: "GitHub", svg: normalizeNodeLogoSvg(github) },
	vitest: { name: "Vitest", svg: normalizeNodeLogoSvg(vitest) },
};

function nodeLogo(slug: string): CanvasIconAsset | undefined {
	return Object.hasOwn(NODE_LOGOS, slug) ? NODE_LOGOS[slug] : undefined;
}

/** The deploy-pipeline fixture with real catalog marks embedded. */
export function nodeLogoScene(direction: LayoutDirection = "TB"): RenderedDiagramScene {
	return embedCanvasIcons(
		renderIntermediateDiagram({
			...deployPipelineLogoFlowchart,
			layout: { ...deployPipelineLogoFlowchart.layout, direction },
		}),
		nodeLogo,
	).scene;
}

/** The deploy-webhook sequence with real catalog marks in its participant headers. */
export function participantLogoScene(): RenderedDiagramScene {
	return embedCanvasIcons(renderSequenceDiagram(deployWebhookLogoSequence), nodeLogo).scene;
}
