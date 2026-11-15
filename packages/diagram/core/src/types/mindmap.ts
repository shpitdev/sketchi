// Maintained fixture literals/factories are trusted: invalid fixture data is a startup defect, not user input.
import { Array, MutableHashMap, Option, Order, Result, Schema } from "effect";

import {
	DiagramEdge,
	DiagramNode,
	DiagramValidationError,
	IntermediateDiagram,
	validateIntermediateDiagram,
} from "../intermediate.js";

export const mindmapDiagramType = "mindmap" as const;

export const MindmapNodeMetadata = Schema.Struct({
	depth: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
	siblingIndex: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
}).annotate({ identifier: "MindmapNodeMetadata" });

export interface MindmapNodeMetadata extends Schema.Schema.Type<typeof MindmapNodeMetadata> {}

export const MindmapNode = Schema.Struct({
	...DiagramNode.fields,
	kind: Schema.Literals(["root", "topic"]),
	metadata: MindmapNodeMetadata,
}).annotate({ identifier: "MindmapNode" });

export interface MindmapNode extends Schema.Schema.Type<typeof MindmapNode> {}

export const MindmapEdgeMetadata = Schema.Struct({
	depth: Schema.Int.check(Schema.isGreaterThan(0)),
	siblingIndex: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
}).annotate({ identifier: "MindmapEdgeMetadata" });

export interface MindmapEdgeMetadata extends Schema.Schema.Type<typeof MindmapEdgeMetadata> {}

export const MindmapEdge = Schema.Struct({
	...DiagramEdge.fields,
	metadata: MindmapEdgeMetadata,
}).annotate({ identifier: "MindmapEdge" });

export interface MindmapEdge extends Schema.Schema.Type<typeof MindmapEdge> {}

export const MindmapDiagram = Schema.Struct({
	...IntermediateDiagram.fields,
	type: Schema.Literal(mindmapDiagramType),
	nodes: Schema.Array(MindmapNode).pipe(Schema.mutable).check(Schema.isMinLength(2)),
	edges: Schema.Array(MindmapEdge).pipe(Schema.mutable).check(Schema.isMinLength(1)),
}).annotate({ identifier: "MindmapDiagram" });

export interface MindmapDiagram extends Schema.Schema.Type<typeof MindmapDiagram> {}

export function validateMindmapDiagram(
	diagram: MindmapDiagram,
): Result.Result<MindmapDiagram, DiagramValidationError> {
	return Result.gen(function* () {
		yield* validateIntermediateDiagram(diagram);
		const roots = Array.filter(diagram.nodes, (node) => node.kind === "root");
		if (roots.length !== 1) {
			return yield* Result.fail(
				DiagramValidationError.make({
					message: `Mindmap must contain exactly one root topic; found ${roots.length}.`,
				}),
			);
		}
		const root = Array.head(roots);
		if (Option.isNone(root) || root.value.metadata.depth !== 0) {
			return yield* Result.fail(
				DiagramValidationError.make({ message: "Mindmap root topic must have depth 0." }),
			);
		}
		const incoming = MutableHashMap.empty<string, number>();
		const nodeById = MutableHashMap.fromIterable(
			Array.map(diagram.nodes, (node) => [node.id, node] as const),
		);
		const childrenByParent = MutableHashMap.empty<string, number[]>();
		for (const edge of diagram.edges) {
			MutableHashMap.set(
				incoming,
				edge.target,
				Option.getOrElse(MutableHashMap.get(incoming, edge.target), () => 0) + 1,
			);
			const source = MutableHashMap.get(nodeById, edge.source);
			const target = MutableHashMap.get(nodeById, edge.target);
			if (
				Option.isNone(source) ||
				Option.isNone(target) ||
				target.value.metadata.depth !== source.value.metadata.depth + 1
			) {
				return yield* Result.fail(
					DiagramValidationError.make({
						message: `Mindmap edge "${edge.id}" must connect a topic to its immediate child.`,
					}),
				);
			}
			if (
				edge.metadata.depth !== target.value.metadata.depth ||
				edge.metadata.siblingIndex !== target.value.metadata.siblingIndex
			) {
				return yield* Result.fail(
					DiagramValidationError.make({
						message: `Mindmap edge "${edge.id}" metadata must match its child topic.`,
					}),
				);
			}
			MutableHashMap.set(
				childrenByParent,
				edge.source,
				Array.append(
					Option.getOrElse(MutableHashMap.get(childrenByParent, edge.source), () => []),
					target.value.metadata.siblingIndex,
				),
			);
		}
		for (const node of diagram.nodes) {
			const count = Option.getOrElse(MutableHashMap.get(incoming, node.id), () => 0);
			if (node.id === root.value.id ? count !== 0 : count !== 1) {
				return yield* Result.fail(
					DiagramValidationError.make({
						message: `Mindmap topic "${node.id}" must have ${node.id === root.value.id ? "no parent" : "exactly one parent"}.`,
					}),
				);
			}
		}
		for (const [parentId, siblingIndexes] of childrenByParent) {
			const actual = Array.sort(siblingIndexes, Order.Number);
			if (Array.some(actual, (value, index) => value !== index)) {
				return yield* Result.fail(
					DiagramValidationError.make({
						message: `Mindmap children of "${parentId}" must use contiguous sibling ordering from 0.`,
					}),
				);
			}
		}
		return diagram;
	});
}

export function parseMindmapDiagram(
	input: unknown,
): Result.Result<MindmapDiagram, Schema.SchemaError | DiagramValidationError> {
	return Result.flatMap(
		Schema.decodeUnknownResult(MindmapDiagram, { errors: "all" })(input),
		validateMindmapDiagram,
	);
}

/** A topic and its ordered children, as authors nest them. */
export interface MindmapTopicTree {
	readonly label: string;
	readonly children?: readonly MindmapTopicTree[] | undefined;
}

/**
 * The canonical mindmap of a nested topic tree. Each topic's id is its path
 * from the root (`topic-0-1` is the root's second child) and the branch into it
 * is `branch-0-1`; depth and sibling order come from the nesting.
 */
export function mindmapDiagramFromTree(tree: {
	readonly id: string;
	readonly title: string;
	readonly root: MindmapTopicTree;
	readonly direction?: "LR" | "RL";
	readonly style?: { readonly accentColor: string; readonly backgroundColor: string };
}): Result.Result<MindmapDiagram, Schema.SchemaError | DiagramValidationError> {
	const nodes: Record<string, unknown>[] = [];
	const edges: Record<string, unknown>[] = [];
	const visit = (
		topic: MindmapTopicTree,
		path: Array.NonEmptyReadonlyArray<number>,
		parentId: Option.Option<string>,
	) => {
		const suffix = Array.join(Array.map(path, String), "-");
		const depth = path.length - 1;
		const metadata = { depth, siblingIndex: Array.lastNonEmpty(path) };
		nodes.push({
			id: `topic-${suffix}`,
			label: topic.label,
			kind: depth === 0 ? "root" : "topic",
			metadata,
		});
		if (Option.isSome(parentId))
			edges.push({
				id: `branch-${suffix}`,
				source: parentId.value,
				target: `topic-${suffix}`,
				metadata,
			});
		Array.forEach(
			Option.getOrElse(Option.fromNullishOr(topic.children), () => []),
			(child, index) => visit(child, Array.append(path, index), Option.some(`topic-${suffix}`)),
		);
	};
	visit(tree.root, [0], Option.none());
	return parseMindmapDiagram({
		id: tree.id,
		title: tree.title,
		type: mindmapDiagramType,
		nodes,
		edges,
		layout: { direction: tree.direction ?? "LR", edgeRouting: "curved" },
		...(tree.style ? { style: { ...tree.style } } : {}),
	});
}

export const mindmapFixture = parseMindmapDiagram({
	id: "public-mindmap-capability",
	title: "Public mindmap generation",
	type: mindmapDiagramType,
	nodes: [
		{
			id: "topic-0",
			label: "Public mindmaps",
			kind: "root",
			metadata: { depth: 0, siblingIndex: 0 },
		},
		{
			id: "topic-0-0",
			label: "Semantic input",
			kind: "topic",
			metadata: { depth: 1, siblingIndex: 0 },
		},
		{
			id: "topic-0-0-0",
			label: "Nested topics",
			kind: "topic",
			metadata: { depth: 2, siblingIndex: 0 },
		},
		{
			id: "topic-0-0-1",
			label: "Stable ordering",
			kind: "topic",
			metadata: { depth: 2, siblingIndex: 1 },
		},
		{
			id: "topic-0-1",
			label: "Artifact output",
			kind: "topic",
			metadata: { depth: 1, siblingIndex: 1 },
		},
		{
			id: "topic-0-1-0",
			label: "Scene",
			kind: "topic",
			metadata: { depth: 2, siblingIndex: 0 },
		},
		{
			id: "topic-0-1-1",
			label: "Excalidraw",
			kind: "topic",
			metadata: { depth: 2, siblingIndex: 1 },
		},
	],
	edges: [
		{
			id: "branch-0-0",
			source: "topic-0",
			target: "topic-0-0",
			metadata: { depth: 1, siblingIndex: 0 },
		},
		{
			id: "branch-0-0-0",
			source: "topic-0-0",
			target: "topic-0-0-0",
			metadata: { depth: 2, siblingIndex: 0 },
		},
		{
			id: "branch-0-0-1",
			source: "topic-0-0",
			target: "topic-0-0-1",
			metadata: { depth: 2, siblingIndex: 1 },
		},
		{
			id: "branch-0-1",
			source: "topic-0",
			target: "topic-0-1",
			metadata: { depth: 1, siblingIndex: 1 },
		},
		{
			id: "branch-0-1-0",
			source: "topic-0-1",
			target: "topic-0-1-0",
			metadata: { depth: 2, siblingIndex: 0 },
		},
		{
			id: "branch-0-1-1",
			source: "topic-0-1",
			target: "topic-0-1-1",
			metadata: { depth: 2, siblingIndex: 1 },
		},
	],
	layout: { direction: "LR", edgeRouting: "curved" },
}).pipe(Result.getOrThrow);
