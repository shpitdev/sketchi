import { flowchartDiagramFromSpec, type FlowchartSpec } from "@sketchi/diagram-agent";
import { mindmapFixture } from "@sketchi/diagram-core";
import {
	renderIntermediateDiagram,
	renderMindmapDiagram,
	type RenderedDiagramScene,
} from "@sketchi/diagram-renderer";
import { ArtifactCanvas } from "@sketchi/diagram-ui";
import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";

import { StudioHeader } from "@/components/studio-header";

export const Route = createFileRoute("/examples/$exampleId")({
	component: ExampleRoute,
});

interface CuratedExample {
	blurb: string;
	scene?: RenderedDiagramScene;
	spec?: FlowchartSpec;
	title: string;
}

/**
 * Curated, read-only diagrams that the docs link to. They're authored as real
 * canonical FlowchartSpec values and rendered from the same normalized core
 * diagram used by buildFlowchart, so "how it works" stays contract-accurate
 * without persisting a new artifact for every page view.
 */
const EXAMPLES: Record<string, CuratedExample> = {
	"public-mindmap": {
		title: "Public mindmap generation",
		blurb: "Generated from a semantic nested topic hierarchy — pan and zoom to inspect it.",
		scene: renderMindmapDiagram(mindmapFixture),
	},
	"how-it-works": {
		title: "How Sketchi works",
		blurb: "Read-only — pan and zoom, but nothing you change is saved.",
		spec: {
			title: "How Sketchi works",
			nodes: {
				describe: "You describe a diagram",
				where: "Where are you working?",
				playground: "Playground draws it",
				"playground-state": "Shareable link, no account",
				agent: "Your agent calls Sketchi",
				"agent-state": "Your machine keeps the file",
				result: "A real, editable diagram",
			},
			edges: [
				["describe", "where"],
				["where", "playground", "in the app"],
				["playground", "playground-state"],
				["where", "agent", "in your agent"],
				["agent", "agent-state"],
				["playground-state", "result"],
				["agent-state", "result"],
			],
		},
	},
};

function useCuratedScene(example: CuratedExample | undefined): RenderedDiagramScene | null {
	return useMemo(() => {
		if (!example) {
			return null;
		}
		try {
			return (
				example.scene ??
				(example.spec ? renderIntermediateDiagram(flowchartDiagramFromSpec(example.spec)) : null)
			);
		} catch {
			return null;
		}
	}, [example]);
}

function ExampleRoute() {
	const { exampleId } = Route.useParams();
	const example = EXAMPLES[exampleId];
	const scene = useCuratedScene(example);

	return (
		<main className="artifact-view">
			<StudioHeader className="studio-header--ruled">
				{example && scene ? <span className="studio__note">{example.blurb}</span> : null}
				<a className="studio-header__link" href="/">
					Playground
				</a>
			</StudioHeader>

			<section className="artifact-view__stage">
				{example && scene ? (
					<ArtifactCanvas mode="view" scene={scene} title={example.title} />
				) : (
					<p className="artifact-view__message artifact-view__message--error">
						That example doesn&rsquo;t exist.
					</p>
				)}
			</section>
		</main>
	);
}
