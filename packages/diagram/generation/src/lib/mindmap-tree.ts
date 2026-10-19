import {
	type MindmapDiagram,
	mindmapDiagramFromTree,
	SKETCHI_DIAGRAM_STYLE,
} from "@sketchi/diagram-core";
import { Schema } from "effect";

export interface GeneratedMindmapTopic {
	readonly children: readonly GeneratedMindmapTopic[];
	readonly label: string;
}

const GeneratedMindmapTopicReference: Schema.Codec<GeneratedMindmapTopic> = Schema.suspend(
	() => GeneratedMindmapTopicSchema,
).annotate({
	identifier: "GeneratedMindmapTopic",
});

export const GeneratedMindmapTopicSchema: Schema.Codec<GeneratedMindmapTopic> = Schema.Struct({
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
		children: Schema.Array(GeneratedMindmapTopicReference).check(Schema.isMinLength(1)),
		label: Schema.NonEmptyString,
	}),
	title: Schema.NonEmptyString,
	type: Schema.Literal("mindmap"),
}) {}

/** Derive graph identity and parentage from the model's nested hierarchy. */
export function generatedMindmapTreeToDiagram(tree: GeneratedMindmapTree): MindmapDiagram {
	return mindmapDiagramFromTree({
		id: tree.id,
		title: tree.title,
		root: tree.root,
		direction: tree.layout.direction,
		style: SKETCHI_DIAGRAM_STYLE,
	});
}
