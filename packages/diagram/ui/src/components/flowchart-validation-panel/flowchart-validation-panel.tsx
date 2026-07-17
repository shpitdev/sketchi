export interface FlowchartValidationPanelProps {
  edgeCount: number;
  intermediateMessage: string;
  nodeCount: number;
  realSceneIssueCount: number;
  realSceneMessage: string;
}

export function FlowchartValidationPanel({
  edgeCount,
  intermediateMessage,
  nodeCount,
  realSceneIssueCount,
  realSceneMessage
}: FlowchartValidationPanelProps) {
  const realSceneStatus =
    realSceneIssueCount === 0 ? "Real scene valid" : "Real scene issues";

  return (
    <section className="sketchi-flowchart-validation-panel">
      <div>
        <span>{nodeCount} nodes</span>
        <span>{edgeCount} edges</span>
      </div>
      <div>
        <span>{intermediateMessage}</span>
        <span>{realSceneStatus}</span>
        <span>{realSceneMessage}</span>
      </div>
    </section>
  );
}
