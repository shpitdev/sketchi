import type { IntermediateDiagram } from "@sketchi/diagram-core";
import {
  renderIntermediateDiagram,
  type SceneElement,
} from "@sketchi/diagram-renderer";

function boundsFor(elements: SceneElement[]) {
  const minX = Math.min(...elements.map((element) => element.x), 0);
  const minY = Math.min(...elements.map((element) => element.y), 0);
  const maxX = Math.max(
    ...elements.map((element) => element.x + element.width),
    1
  );
  const maxY = Math.max(
    ...elements.map((element) => element.y + element.height),
    1
  );

  return {
    height: maxY - minY + 80,
    minX: minX - 40,
    minY: minY - 40,
    width: maxX - minX + 80,
  };
}

export interface DiagramPreviewProps {
  diagram: IntermediateDiagram;
}

export function DiagramPreview({ diagram }: DiagramPreviewProps) {
  const scene = renderIntermediateDiagram(diagram);
  const bounds = boundsFor(scene.elements);
  const shapes = scene.elements.filter(
    (element) => element.type === "rectangle"
  );
  const labels = scene.elements.filter((element) => element.type === "text");
  const arrows = scene.elements.filter((element) => element.type === "arrow");

  return (
    <svg
      aria-label="Diagram preview"
      className="sketchi-diagram-preview"
      role="img"
      viewBox={`${bounds.minX} ${bounds.minY} ${bounds.width} ${bounds.height}`}
    >
      <defs>
        <marker
          id="sketchi-arrow"
          markerHeight="8"
          markerWidth="8"
          orient="auto"
          refX="6"
          refY="3"
        >
          <path d="M0,0 L0,6 L7,3 z" fill="#334155" />
        </marker>
      </defs>

      {arrows.map((arrow) => (
        <line
          key={arrow.id}
          markerEnd="url(#sketchi-arrow)"
          stroke={arrow.strokeColor}
          strokeLinecap="round"
          strokeWidth="2"
          x1={arrow.points[0]?.x ?? arrow.x}
          x2={arrow.points[1]?.x ?? arrow.x + arrow.width}
          y1={arrow.points[0]?.y ?? arrow.y}
          y2={arrow.points[1]?.y ?? arrow.y + arrow.height}
        />
      ))}

      {shapes.map((shape) => (
        <rect
          fill={shape.backgroundColor}
          height={shape.height}
          key={shape.id}
          rx="8"
          stroke={shape.strokeColor}
          strokeWidth="2"
          width={shape.width}
          x={shape.x}
          y={shape.y}
        />
      ))}

      {labels.map((label) => (
        <text
          dominantBaseline="middle"
          fill={label.strokeColor}
          fontFamily="Inter, ui-sans-serif, system-ui, sans-serif"
          fontSize={label.fontSize}
          key={label.id}
          textAnchor="middle"
          x={label.x + label.width / 2}
          y={label.y + label.height / 2}
        >
          {label.text}
        </text>
      ))}
    </svg>
  );
}
