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

export const GeneratedMindmapLayout = Schema.Struct({
	direction: Schema.Literals(["LR", "RL"]),
	edgeRouting: Schema.Literal("curved"),
}).annotate({ identifier: "GeneratedMindmapLayout" });

export interface GeneratedMindmapLayout extends Schema.Schema.Type<typeof GeneratedMindmapLayout> {}

export const GeneratedMindmapTree = Schema.Struct({
	id: Schema.NonEmptyString,
	layout: GeneratedMindmapLayout,
	root: Schema.Struct({
		children: Schema.Array(GeneratedMindmapTopicReference).check(Schema.isMinLength(1)),
		label: Schema.NonEmptyString,
	}),
	title: Schema.NonEmptyString,
	type: Schema.Literal("mindmap"),
}).annotate({ identifier: "GeneratedMindmapTree" });

export interface GeneratedMindmapTree extends Schema.Schema.Type<typeof GeneratedMindmapTree> {}

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
