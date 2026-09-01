import {
  type MindmapDiagram,
  SKETCHI_DIAGRAM_STYLE,
  parseMindmapDiagram,
} from "@sketchi/diagram-core";
import { Schema } from "effect";

export interface GeneratedMindmapTopic {
  readonly children: readonly GeneratedMindmapTopic[];
  readonly label: string;
}

const GeneratedMindmapTopicReference: Schema.Codec<GeneratedMindmapTopic> =
  Schema.suspend(() => GeneratedMindmapTopicSchema).annotate({
    identifier: "GeneratedMindmapTopic",
  });

export const GeneratedMindmapTopicSchema: Schema.Codec<GeneratedMindmapTopic> =
  Schema.Struct({
    children: Schema.Array(GeneratedMindmapTopicReference),
    label: Schema.NonEmptyString,
  });

export class GeneratedMindmapLayout extends Schema.Class<GeneratedMindmapLayout>(
  "GeneratedMindmapLayout",
)({
  direction: Schema.Literals(["LR", "RL"]),
  edgeRouting: Schema.Literal("curved"),
}) {}

export class GeneratedMindmapTree extends Schema.Class<GeneratedMindmapTree>(
  "GeneratedMindmapTree",
)({
  id: Schema.NonEmptyString,
  layout: GeneratedMindmapLayout,
  root: Schema.Struct({
    children: Schema.Array(GeneratedMindmapTopicReference).check(
      Schema.isMinLength(1),
    ),
    label: Schema.NonEmptyString,
  }),
  title: Schema.NonEmptyString,
  type: Schema.Literal("mindmap"),
}) {}

/** Derive graph identity and parentage from the model's nested hierarchy. */
export function generatedMindmapTreeToDiagram(
  tree: GeneratedMindmapTree,
): MindmapDiagram {
  const nodes: Array<Record<string, unknown>> = [];
  const edges: Array<Record<string, unknown>> = [];

  const visit = (
    topic: GeneratedMindmapTopic,
    path: readonly number[],
    depth: number,
    siblingIndex: number,
    parentId?: string,
  ): void => {
    const suffix = path.join("-");
    const id = `topic-${suffix}`;
    nodes.push({
      id,
      kind: depth === 0 ? "root" : "topic",
      label: topic.label,
      metadata: { depth, siblingIndex },
    });
    if (parentId) {
      edges.push({
        id: `branch-${suffix}`,
        metadata: { depth, siblingIndex },
        source: parentId,
        target: id,
      });
    }
    topic.children.forEach((child, index) =>
      visit(child, [...path, index], depth + 1, index, id),
    );
  };

  visit(tree.root, [0], 0, 0);
  return parseMindmapDiagram({
    edges,
    id: tree.id,
    layout: tree.layout,
    nodes,
    style: { ...SKETCHI_DIAGRAM_STYLE },
    title: tree.title,
    type: tree.type,
  });
}
