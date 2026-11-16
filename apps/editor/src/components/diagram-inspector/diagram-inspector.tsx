import { type CanonicalDiagram, familyForType } from "@sketchi/diagrams/family";
import { type ExcalidrawScene, validateExcalidrawScene } from "@sketchi/drawing/excalidraw";
import { useMemo, useState } from "react";

export interface DiagramInspectorProps {
	diagram: CanonicalDiagram;
	scene: ExcalidrawScene;
}

type InspectorTab = "document" | "overview" | "scene";

const tabs: readonly { id: InspectorTab; label: string }[] = [
	{ id: "overview", label: "Overview" },
	{ id: "document", label: "Document" },
	{ id: "scene", label: "Scene" },
];

export function DiagramInspector({ diagram, scene }: DiagramInspectorProps) {
	const [active, setActive] = useState<InspectorTab>("overview");
	const counts = familyForType(diagram.type).counts(diagram);
	const layout = "layout" in diagram ? diagram.layout : undefined;
	const direction = layout && "direction" in layout ? layout.direction : undefined;
	const edgeRouting =
		diagram.type === "mindmap"
			? "curved"
			: layout && "edgeRouting" in layout
				? layout.edgeRouting
				: undefined;

	const elementCounts = useMemo(() => {
		const counts = new Map<string, number>();
		for (const element of scene.elements) {
			counts.set(element.type, (counts.get(element.type) ?? 0) + 1);
		}
		return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
	}, [scene]);

	const validation = useMemo(() => validateExcalidrawScene(scene), [scene]);

	return (
		<section className="diagram-inspector" aria-label="Diagram inspector">
			<div className="diagram-inspector__tabs" role="tablist" aria-label="Inspect diagram">
				{tabs.map((tab) => (
					<button
						aria-selected={active === tab.id}
						className="diagram-inspector__tab"
						id={`inspector-tab-${tab.id}`}
						key={tab.id}
						onClick={() => setActive(tab.id)}
						role="tab"
						type="button"
					>
						{tab.label}
					</button>
				))}
			</div>

			<div className="diagram-inspector__panel" role="tabpanel">
				{active === "overview" ? (
					<dl className="diagram-inspector__defs">
						<div>
							<dt>Type</dt>
							<dd>{diagram.type}</dd>
						</div>
						{direction ? (
							<div>
								<dt>Direction</dt>
								<dd>{direction}</dd>
							</div>
						) : null}
						{edgeRouting ? (
							<div>
								<dt>Edge routing</dt>
								<dd>{edgeRouting}</dd>
							</div>
						) : null}
						<div>
							<dt>Nodes</dt>
							<dd>{counts.nodeCount}</dd>
						</div>
						<div>
							<dt>Edges</dt>
							<dd>{counts.edgeCount}</dd>
						</div>
						<div>
							<dt>Accent</dt>
							<dd className="diagram-inspector__swatch-row">
								<span
									className="diagram-inspector__swatch"
									style={{ background: diagram.style.accentColor }}
								/>
								{diagram.style.accentColor}
							</dd>
						</div>
					</dl>
				) : null}

				{active === "document" ? (
					<pre className="diagram-inspector__code">{JSON.stringify(diagram, null, 2)}</pre>
				) : null}

				{active === "scene" ? (
					<div className="diagram-inspector__scene">
						<p
							className={`diagram-inspector__validity ${
								validation.ok
									? "diagram-inspector__validity--ok"
									: "diagram-inspector__validity--warn"
							}`}
						>
							{validation.ok
								? "Scene validated · no issues"
								: `${validation.issues.length} validation issue${
										validation.issues.length === 1 ? "" : "s"
									}`}
						</p>
						<p className="diagram-inspector__scene-total">
							{scene.elements.length} Excalidraw elements
						</p>
						<dl className="diagram-inspector__defs">
							{elementCounts.map(([type, count]) => (
								<div key={type}>
									<dt>{type}</dt>
									<dd>{count}</dd>
								</div>
							))}
						</dl>
					</div>
				) : null}
			</div>
		</section>
	);
}
