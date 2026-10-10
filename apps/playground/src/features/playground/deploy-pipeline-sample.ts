import { flowchartDiagramFromSpec, type FlowchartSpec } from "@sketchi/diagram-agent";
import {
	canvasBoundTextBox,
	canvasNodeIconBand,
	compileCanvasSpec,
	embedCanvasIcons,
	SKETCHI_DIAGRAM_STYLE,
	type CanvasIconAsset,
	type CanvasShapeElement,
} from "@sketchi/diagram-core";
import { type ArrowSceneElement, renderIntermediateDiagram } from "@sketchi/diagram-renderer";
import { normalizeNodeLogoSvg } from "@sketchi/icon-catalog";
import cloudflareSvg from "@sketchi/icon-catalog/svg/cloud-vendors/cloudflare.svg?raw";
import dockerSvg from "@sketchi/icon-catalog/svg/devtools-ci/docker.svg?raw";
import githubSvg from "@sketchi/icon-catalog/svg/devtools-ci/github.svg?raw";

export const DEPLOY_PIPELINE_SPEC = {
	title: "Deploy pipeline",
	layout: { direction: "LR" },
	style: { ...SKETCHI_DIAGRAM_STYLE },
	nodes: [
		{
			id: "push",
			label: "GitHub push",
			kind: "start",
			icon: { slug: "github" },
		},
		{
			id: "build",
			label: "Docker build",
			kind: "process",
			icon: { slug: "docker" },
		},
		{ id: "tests", label: "Run tests", kind: "process" },
		{
			id: "deploy",
			label: "Cloudflare ship",
			kind: "end",
			icon: { slug: "cloudflare" },
		},
	],
	edges: [
		{ source: "push", target: "build" },
		{ source: "build", target: "tests" },
		{ source: "tests", target: "deploy", label: "pass" },
	],
} satisfies FlowchartSpec;

/** The sample's catalog marks, bundled so the empty state paints offline. */
const SAMPLE_LOGOS: ReadonlyMap<string, CanvasIconAsset> = new Map([
	["cloudflare", { name: "Cloudflare", svg: normalizeNodeLogoSvg(cloudflareSvg) }],
	["docker", { name: "Docker", svg: normalizeNodeLogoSvg(dockerSvg) }],
	["github", { name: "GitHub", svg: normalizeNodeLogoSvg(githubSvg) }],
]);

const generatedDeployPipelineScene = embedCanvasIcons(
	renderIntermediateDiagram(flowchartDiagramFromSpec(DEPLOY_PIPELINE_SPEC)),
	(slug) => SAMPLE_LOGOS.get(slug),
).scene;

const SAMPLE_HORIZONTAL_SCALE = 0.5;
const SAMPLE_LABEL_MAX_WIDTH = 90;
const SAMPLE_TEXT_HORIZONTAL_PADDING = 24;
const SAMPLE_DEPLOY_NODE_MIN_WIDTH = SAMPLE_LABEL_MAX_WIDTH + SAMPLE_TEXT_HORIZONTAL_PADDING;
const SAMPLE_LABEL_LINES: Readonly<Record<string, string>> = {
	"Cloudflare ship": "Cloudflare\nship",
	"Docker build": "Docker\nbuild",
	"GitHub push": "GitHub\npush",
	"Run tests": "Run\ntests",
};

const SAMPLE_LABEL_FONT_SIZE = 15;

/**
 * Grow a compacted logo node until Excalidraw's bound-text box holds the
 * sample's two-line label beneath the logo: rightward, so the gap (and edge
 * label) before it survives, and vertically around its center. Arrow endpoints
 * are re-synchronized to the resized nodes afterwards.
 */
function fitLogoBand(node: CanvasShapeElement, label: string | undefined): CanvasShapeElement {
	if (!node.icon || !label) return node;
	const lines = label.split("\n");
	const textWidth = Math.max(...lines.map((line) => line.length)) * SAMPLE_LABEL_FONT_SIZE * 0.62;
	const textHeight = Math.ceil(lines.length * SAMPLE_LABEL_FONT_SIZE * 1.35);
	const needed = textHeight + canvasNodeIconBand(node.icon);
	let { height, width } = node;
	while (canvasBoundTextBox({ ...node, width }).width < textWidth) width += 1;
	while (canvasBoundTextBox({ ...node, height, width }).height < needed) {
		height += 1;
	}
	return {
		...node,
		height,
		width,
		y: node.y - (height - node.height) / 2,
	};
}

function compactArrowPoints(points: ArrowSceneElement["points"]): ArrowSceneElement["points"] {
	const [first, ...rest] = points;

	return [
		{ ...first, x: first.x * SAMPLE_HORIZONTAL_SCALE },
		...rest.map((point) => ({
			...point,
			x: point.x * SAMPLE_HORIZONTAL_SCALE,
		})),
	];
}

// DiagramPreview fits the full renderer scene into this fixed-size sample card.
// Compact its horizontal coordinates and preserve readable text sizes so both
// node and edge labels survive fit-to-content without substituting hand-built
// diagram markup.
export const DEPLOY_PIPELINE_SCENE = compileCanvasSpec({
	...generatedDeployPipelineScene,
	width: generatedDeployPipelineScene.width * SAMPLE_HORIZONTAL_SCALE,
	elements: generatedDeployPipelineScene.elements.map((element) => {
		if (element.type === "arrow") {
			return {
				...element,
				points: compactArrowPoints(element.points),
			};
		}

		if (element.type === "node") {
			const scaledWidth = element.width * SAMPLE_HORIZONTAL_SCALE;

			return fitLogoBand(
				{
					...element,
					width:
						element.nodeId === "deploy"
							? Math.max(scaledWidth, SAMPLE_DEPLOY_NODE_MIN_WIDTH)
							: scaledWidth,
					x: element.x * SAMPLE_HORIZONTAL_SCALE,
				},
				SAMPLE_LABEL_LINES[element.label.replaceAll("\n", " ")],
			);
		}

		if (element.type !== "text") {
			return element;
		}

		return {
			...element,
			fontSize: SAMPLE_LABEL_FONT_SIZE,
			maxWidth: SAMPLE_LABEL_MAX_WIDTH,
			text: SAMPLE_LABEL_LINES[element.text] ?? element.text,
			x: element.x * SAMPLE_HORIZONTAL_SCALE,
		};
	}),
});
