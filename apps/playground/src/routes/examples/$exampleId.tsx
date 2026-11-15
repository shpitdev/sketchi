import { type CanvasSpec } from "@sketchi/drawing";
import { convertSceneToExcalidraw } from "@sketchi/drawing/excalidraw";
import { Result } from "effect";
import { flowchartDiagramFromSpec } from "@sketchi/diagrams/families/flowchart/document";
import { type FlowchartDocument } from "@sketchi/diagrams/families/flowchart/document";
import { mindmapFixture } from "@sketchi/diagrams/families/mindmap/fixtures";
import { renderFlowchartDiagram } from "@sketchi/diagrams/families/flowchart/render";
import { renderMindmap } from "@sketchi/diagrams/families/mindmap/index";

import { DrawingEditor } from "@sketchi/editor";
import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";

import { StudioHeader } from "@/components/studio-header";

export const Route = createFileRoute("/examples/$exampleId")({
	component: ExampleRoute,
});

interface CuratedExample {
	blurb: string;
	scene?: CanvasSpec;
	spec?: FlowchartDocument;
	title: string;
}

/**
 * Curated, read-only diagrams that the docs link to. They're authored as real
 * canonical FlowchartDocument values and rendered from the same normalized core
 * diagram used by buildFlowchart, so "how it works" stays contract-accurate
 * without persisting a new artifact for every page view.
 */
const EXAMPLES: Record<string, CuratedExample> = {
	"public-mindmap": {
		title: "Public mindmap generation",
		blurb: "Generated from a semantic nested topic hierarchy — pan and zoom to inspect it.",
		// This curated fixture is maintained in source; a render failure is a fixture defect.
		scene: renderMindmap(mindmapFixture),
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

function useCuratedScene(example: CuratedExample | undefined): CanvasSpec | null {
	return useMemo(() => {
		if (!example) {
			return null;
		}
		try {
			return (
				example.scene ??
				(example.spec
					? Result.getOrElse(
							renderFlowchartDiagram(flowchartDiagramFromSpec(example.spec)),
							() => null,
						)
					: null)
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
					<DrawingEditor
						title={example.title}
						revision={JSON.stringify(scene)}
						scene={convertSceneToExcalidraw(scene)}
						viewModeEnabled={true}
						zenModeEnabled={true}
					/>
				) : (
					<p className="artifact-view__message artifact-view__message--error">
						That example doesn&rsquo;t exist.
					</p>
				)}
			</section>
		</main>
	);
}
