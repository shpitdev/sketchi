export interface PipelineStage {
  name: string;
  pkg: string;
}

export interface PipelineFlowProps {
  stages?: readonly PipelineStage[];
}

const defaultStages: readonly PipelineStage[] = [
  { name: "Prompt", pkg: "diagram-generation" },
  { name: "Typed IR", pkg: "diagram-core" },
  { name: "Validate", pkg: "diagram-core" },
  { name: "Render", pkg: "diagram-renderer" },
  { name: "Canvas artifact", pkg: "diagram-excalidraw" },
];

export function PipelineFlow({ stages = defaultStages }: PipelineFlowProps) {
  return (
    <ol aria-label="Diagram generation pipeline" className="pipeline-flow">
      {stages.map((stage, index) => (
        <li className="pipeline-flow__stage" key={stage.name}>
          <span className="pipeline-flow__index">
            {String(index + 1).padStart(2, "0")}
          </span>
          <h3 className="pipeline-flow__name">{stage.name}</h3>
          <span className="pipeline-flow__pkg">{stage.pkg}</span>
        </li>
      ))}
    </ol>
  );
}
