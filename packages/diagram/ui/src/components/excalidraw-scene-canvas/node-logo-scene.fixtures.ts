import {
	deployPipelineLogoFlowchart,
	deployWebhookLogoSequence,
	requestFlowGroupLogoFlowchart,
	embedCanvasIcons,
	type CanvasIconAsset,
	type IconRecipe,
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
import openai from "@sketchi/icon-catalog/svg/ai-model-labs/openai.svg?raw";
import vercel from "@sketchi/icon-catalog/svg/cloud-hosting-paas/vercel.svg?raw";
import redis from "@sketchi/icon-catalog/svg/data-storage/redis.svg?raw";
import nextjs from "@sketchi/icon-catalog/svg/frontend-frameworks/nextjs.svg?raw";
import sentry from "@sketchi/icon-catalog/svg/observability-security/sentry.svg?raw";

const NODE_LOGOS: Readonly<Record<string, CanvasIconAsset>> = {
	cloudflare: { name: "Cloudflare", svg: normalizeNodeLogoSvg(cloudflare) },
	docker: { name: "Docker", svg: normalizeNodeLogoSvg(docker) },
	github: { name: "GitHub", svg: normalizeNodeLogoSvg(github) },
	nextjs: { name: "Next.js", svg: normalizeNodeLogoSvg(nextjs) },
	openai: { name: "OpenAI", svg: normalizeNodeLogoSvg(openai) },
	redis: { name: "Redis", svg: normalizeNodeLogoSvg(redis) },
	sentry: { name: "Sentry", svg: normalizeNodeLogoSvg(sentry) },
	vercel: { name: "Vercel", svg: normalizeNodeLogoSvg(vercel) },
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

/** A hand-drawn GitHub mark: the cat cut out of an ink disc, so it inverts with the theme. */
const GITHUB_RECIPE: IconRecipe = {
	parts: [
		{ kind: "ellipse", cx: 12, cy: 12, rx: 10.5, ry: 10.5, fill: "ink" },
		{
			kind: "stroke",
			smooth: true,
			closed: true,
			stroke: "paper",
			fill: "paper",
			points: [
				[12, 7.1],
				[14.6, 7.3],
				[15.9, 6.4],
				[17.5, 5.9],
				[17.9, 8.2],
				[18.7, 10.6],
				[18.3, 13.6],
				[16.4, 15.6],
				[14.8, 16.4],
				[14.8, 22],
				[9.6, 22],
				[9.4, 16.4],
				[7.6, 15.6],
				[5.7, 13.6],
				[5.3, 10.6],
				[6.1, 8.2],
				[6.5, 5.9],
				[8.1, 6.4],
				[9.4, 7.3],
			],
		},
	],
};

/**
 * The deploy-pipeline fixture with GitHub drawn by hand from a recipe beside
 * the embedded SVG marks of icons that have none.
 */
export function handDrawnLogoScene(): RenderedDiagramScene {
	return embedCanvasIcons(renderIntermediateDiagram(deployPipelineLogoFlowchart), (slug) => {
		const asset = nodeLogo(slug);
		return asset && slug === "github" ? { ...asset, recipe: GITHUB_RECIPE } : asset;
	}).scene;
}

/** The deploy-webhook sequence with real catalog marks in its participant headers. */
export function participantLogoScene(): RenderedDiagramScene {
	return embedCanvasIcons(renderSequenceDiagram(deployWebhookLogoSequence), nodeLogo).scene;
}

/**
 * The request-flow fixture: its Vercel group draws the Vercel logo before its
 * name, as a frame or, with a kind, as a zone.
 */
export function groupLogoScene(zoned = false): RenderedDiagramScene {
	const groups = requestFlowGroupLogoFlowchart.groups?.map((group) =>
		zoned ? { ...group, kind: "cloud" as const } : group,
	);
	return embedCanvasIcons(
		renderIntermediateDiagram({ ...requestFlowGroupLogoFlowchart, ...(groups ? { groups } : {}) }),
		nodeLogo,
	).scene;
}
