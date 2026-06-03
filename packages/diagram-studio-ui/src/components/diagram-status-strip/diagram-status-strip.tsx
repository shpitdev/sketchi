export type DiagramRenderStatus = "idle" | "validating" | "rendered" | "error";

export interface DiagramStatusStripProps {
  edgeCount: number;
  nodeCount: number;
  status: DiagramRenderStatus;
}

export function DiagramStatusStrip({
  edgeCount,
  nodeCount,
  status,
}: DiagramStatusStripProps) {
  return (
    <fieldset className="sketchi-diagram-status-strip">
      <legend className="sketchi-diagram-status-strip__legend">
        Diagram status
      </legend>
      <span
        className="sketchi-diagram-status-strip__status"
        data-status={status}
      >
        {status}
      </span>
      <span>{nodeCount} nodes</span>
      <span>{edgeCount} edges</span>
    </fieldset>
  );
}
