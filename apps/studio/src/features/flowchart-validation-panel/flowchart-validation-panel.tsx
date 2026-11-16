export interface FlowchartValidationPanelProps {
	edgeCount: number;
	/** Plural noun for edgeCount; sequence diagrams count messages. */
	edgeNoun?: string;
	intermediateMessage: string;
	nodeCount: number;
	/** Plural noun for nodeCount; sequence diagrams count participants. */
	nodeNoun?: string;
	realSceneIssueCount: number;
	realSceneMessage: string;
}

export function FlowchartValidationPanel({
	edgeCount,
	edgeNoun = "edges",
	intermediateMessage,
	nodeCount,
	nodeNoun = "nodes",
	realSceneIssueCount,
	realSceneMessage,
}: FlowchartValidationPanelProps) {
	const realSceneStatus = realSceneIssueCount === 0 ? "Real scene valid" : "Real scene issues";

	return (
		<section className="sketchi-flowchart-validation-panel">
			<div>
				<span>
					{nodeCount} {nodeNoun}
				</span>
				<span>
					{edgeCount} {edgeNoun}
				</span>
			</div>
			<div>
				<span>{intermediateMessage}</span>
				<span>{realSceneStatus}</span>
				<span>{realSceneMessage}</span>
			</div>
		</section>
	);
}
