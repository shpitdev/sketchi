import type {
  DiagramType,
  IntermediateFormat,
  IntermediateNode,
} from "./diagram-intermediate";
import type { DiagramTemplate } from "./templates";
import { FlowchartTemplate, getTemplateForType } from "./templates";

function applyNodeDefaults(
  node: IntermediateNode,
  template: DiagramTemplate
): IntermediateNode {
  const kind = node.kind?.toLowerCase();
  const mappedShape =
    kind && template.kindToShapeMap[kind]
      ? template.kindToShapeMap[kind]
      : undefined;

  const existingMetadata = node.metadata ?? {};
  return {
    ...node,
    metadata: {
      ...existingMetadata,
      shape: (existingMetadata.shape as string) ?? mappedShape,
      width: (existingMetadata.width as number) ?? template.nodeDefaults.width,
      height:
        (existingMetadata.height as number) ?? template.nodeDefaults.height,
    },
  };
}

export function applyTemplateDefaults(
  intermediate: IntermediateFormat,
  template?: DiagramTemplate
): IntermediateFormat {
  const resolvedTemplate =
    template ??
    getTemplateForType(intermediate.graphOptions?.diagramType) ??
    FlowchartTemplate;

  const existingLayout = intermediate.graphOptions?.layout ?? {};
  const existingStyle = intermediate.graphOptions?.style ?? {};

  return {
    ...intermediate,
    nodes: intermediate.nodes.map((node) =>
      applyNodeDefaults(node, resolvedTemplate)
    ),
    graphOptions: {
      ...intermediate.graphOptions,
      diagramType:
        intermediate.graphOptions?.diagramType ??
        (resolvedTemplate.diagramType as DiagramType),
      layout: {
        direction:
          existingLayout.direction ?? resolvedTemplate.layout.direction,
        nodesep: existingLayout.nodesep ?? resolvedTemplate.layout.nodesep,
        ranksep: existingLayout.ranksep ?? resolvedTemplate.layout.ranksep,
        edgeRouting:
          existingLayout.edgeRouting ?? resolvedTemplate.layout.edgeRouting,
      },
      style: {
        shapeFill:
          existingStyle.shapeFill ?? resolvedTemplate.nodeDefaults.fill,
        shapeStroke:
          existingStyle.shapeStroke ?? resolvedTemplate.nodeDefaults.stroke,
        arrowStroke:
          existingStyle.arrowStroke ?? resolvedTemplate.edgeDefaults.stroke,
      },
    },
  };
}
