import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { Meta, StoryObj } from "@storybook/react-vite";

import { flowchartFixture, parseFlowchartDiagram } from "@sketchi/diagram-core";
import { convertSceneToExcalidraw } from "@sketchi/diagram-excalidraw";
import { renderIntermediateDiagram } from "@sketchi/diagram-renderer";

import { ExcalidrawSceneCanvas } from "./excalidraw-scene-canvas";
import { nodeLogoScene, participantLogoScene } from "./node-logo-scene.fixtures";

const scene = convertSceneToExcalidraw(renderIntermediateDiagram(flowchartFixture));

const meta = {
	title: "Diagram UI/Components/ExcalidrawSceneCanvas",
	component: ExcalidrawSceneCanvas,
	args: {
		scene,
		title: "Sketchi onboarding decision flow",
	},
} satisfies Meta<typeof ExcalidrawSceneCanvas>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

const wideFlowchartScene = convertSceneToExcalidraw(
	renderIntermediateDiagram(
		parseFlowchartDiagram({
			id: "wide-left-to-right-flow",
			title: "Wide left-to-right flow",
			type: "flowchart",
			nodes: [
				{ id: "brief", label: "Brief received", kind: "start" },
				{ id: "structure", label: "Structure diagram", kind: "process" },
				{ id: "review", label: "Review details", kind: "process" },
				{ id: "share", label: "Share diagram", kind: "end" },
			],
			edges: [
				{ id: "brief-structure", source: "brief", target: "structure" },
				{ id: "structure-review", source: "structure", target: "review" },
				{ id: "review-share", source: "review", target: "share" },
			],
			layout: { direction: "LR", edgeRouting: "orthogonal" },
		}),
	),
);

export const WideLeftToRight: Story = {
	args: {
		scene: wideFlowchartScene,
		title: "Wide left-to-right Sketchi flowchart",
		viewModeEnabled: true,
		zenModeEnabled: true,
	},
	tags: ["test"],
};

export const EditableEmbed: Story = {
	args: {
		scene: wideFlowchartScene,
		title: "Editable wide Sketchi flowchart",
		viewModeEnabled: false,
		zenModeEnabled: false,
	},
	tags: ["test"],
};

/** Real GitHub, Docker, Vitest, and Cloudflare marks inside their nodes. */
export const NodeLogos: Story = {
	args: {
		scene: convertSceneToExcalidraw(nodeLogoScene("TB")),
		title: "Deploy pipeline with node logos",
		viewModeEnabled: true,
		zenModeEnabled: true,
	},
	tags: ["test"],
};

export const EditableNodeLogosLeftToRight: Story = {
	args: {
		scene: convertSceneToExcalidraw(nodeLogoScene("LR")),
		title: "Editable left-to-right deploy pipeline with node logos",
		viewModeEnabled: false,
		zenModeEnabled: false,
	},
	tags: ["test"],
};

/** GitHub, Cloudflare, and Docker marks in sequence participant headers. */
export const SequenceParticipantLogos: Story = {
	args: {
		scene: convertSceneToExcalidraw(participantLogoScene()),
		title: "Deploy webhook sequence with participant logos",
		viewModeEnabled: true,
		zenModeEnabled: true,
	},
	tags: ["test"],
};

const nativeElement = {
	angle: 0,
	backgroundColor: "#fffdf8",
	boundElements: null,
	endArrowhead: null,
	endBinding: null,
	fillStyle: "hachure",
	frameId: null,
	groupIds: ["svg:chromatic-native"],
	height: 180,
	id: "svg-native-chromatic-element",
	index: "a0",
	isDeleted: false,
	lastCommittedPoint: null,
	link: null,
	locked: false,
	opacity: 100,
	points: [
		[0, 0],
		[240, 0],
		[240, 180],
		[0, 180],
		[0, 0],
	],
	roughness: 2,
	roundness: null,
	seed: 911,
	startArrowhead: null,
	startBinding: null,
	strokeColor: "#8f707f",
	strokeStyle: "solid",
	strokeWidth: 2,
	type: "line",
	updated: 1,
	version: 1,
	versionNonce: 912,
	width: 240,
	x: 120,
	y: 90,
} as unknown as ExcalidrawElement;

export const NativeEditableElement: Story = {
	args: {
		scene: {
			appState: { viewBackgroundColor: "#fffdf8" },
			elements: [nativeElement],
		},
		title: "Native SVG conversion element",
		viewModeEnabled: false,
		zenModeEnabled: false,
	},
	tags: ["test"],
};
