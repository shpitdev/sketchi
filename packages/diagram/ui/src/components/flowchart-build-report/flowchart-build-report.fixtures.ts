import type {
	ArtifactBundle,
	BuildFlowchartResult,
	NormalizedFlowchartSpec,
	QualityReport,
} from "@sketchi/diagram-agent";

function artifact(diagramId: string): ArtifactBundle {
	return {
		artifactId: `artifact_${diagramId}`,
		diagramId,
		formats: [
			{
				format: "scene",
				mimeType: "application/vnd.sketchi.scene+json",
				sizeBytes: 4_096,
				url: `/api/v1/artifacts/artifact_${diagramId}?format=scene&raw=true`,
			},
			{
				format: "excalidraw",
				mimeType: "application/vnd.excalidraw+json",
				sizeBytes: 8_192,
				url: `/api/v1/artifacts/artifact_${diagramId}?format=excalidraw&raw=true`,
			},
		],
	};
}

function quality(nodeCount: number, edgeCount: number): QualityReport {
	return {
		accepted: true,
		checks: [],
		score: 10,
		summary: { edgeCount, nodeCount },
		threshold: 8,
	};
}

const decisionLoopSpec: NormalizedFlowchartSpec = {
	id: "release-review-loop",
	title: "Release review loop",
	direction: "TB",
	nodes: {
		start: "Open release",
		review: "Release ready?",
		publish: "Publish release",
		revise: "Revise release",
		done: "Release live",
	},
	edges: [
		["start", "review"],
		["review", "publish", "yes"],
		["review", "revise", "no"],
		["revise", "review"],
		["publish", "done"],
	],
};

export const acceptedFlowchartBuild = {
	ok: true,
	status: "accepted",
	buildId: "build_release",
	normalizedSpec: decisionLoopSpec,
	quality: quality(5, 5),
	artifact: artifact(decisionLoopSpec.id),
	issues: [],
} satisfies BuildFlowchartResult;

export const rejectedFlowchartBuild = {
	ok: false,
	status: "invalid_flowchart",
	buildId: "build_repair",
	normalizedSpec: {
		...decisionLoopSpec,
		edges: decisionLoopSpec.edges.map((edge) =>
			edge[0] === "review" && edge[1] === "revise" ? (["review", "revise"] as const) : edge,
		),
	},
	issues: [
		{
			code: "unlabeled_decision_branch",
			severity: "error",
			stage: "flowchart",
			ref: { kind: "edge", id: "review->revise", path: "spec.edges[2]" },
			message: 'Decision "review" has an unlabeled branch to "revise".',
			hint: 'Label every branch of a question, such as "yes" and "no".',
		},
	],
} satisfies BuildFlowchartResult;

const denseSpec: NormalizedFlowchartSpec = {
	id: "dense-intake",
	title: "Dense intake process",
	direction: "LR",
	nodes: Object.fromEntries(
		Array.from({ length: 24 }, (_, index) => [
			`step-${index + 1}`,
			index === 0 ? "Start intake" : index === 23 ? "Finish intake" : `Process intake ${index}`,
		]),
	),
	edges: Array.from(
		{ length: 23 },
		(_, index) => [`step-${index + 1}`, `step-${index + 2}`] as const,
	),
};

export const denseFlowchartBuild = {
	ok: true,
	status: "accepted",
	buildId: "build_dense",
	normalizedSpec: denseSpec,
	quality: quality(24, 23),
	artifact: artifact(denseSpec.id),
	issues: [],
} satisfies BuildFlowchartResult;

export const decisionLoopFlowchartBuild = acceptedFlowchartBuild;
