import { Schema } from "effect";

import {
	DiagramEdge,
	DiagramNode,
	DiagramValidationError,
	IntermediateDiagram,
	validateIntermediateDiagram,
} from "../intermediate.js";

export const mindmapDiagramType = "mindmap" as const;

export class MindmapNodeMetadata extends Schema.Class<MindmapNodeMetadata>("MindmapNodeMetadata")({
	depth: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
	siblingIndex: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
}) {}

export class MindmapNode extends DiagramNode.extend<MindmapNode>("MindmapNode")({
	kind: Schema.Literals(["root", "topic"]),
	metadata: MindmapNodeMetadata,
}) {}
export const MindmapNodeSchema = MindmapNode;

export class MindmapEdgeMetadata extends Schema.Class<MindmapEdgeMetadata>("MindmapEdgeMetadata")({
	depth: Schema.Int.check(Schema.isGreaterThan(0)),
	siblingIndex: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
}) {}

export class MindmapEdge extends DiagramEdge.extend<MindmapEdge>("MindmapEdge")({
	metadata: MindmapEdgeMetadata,
}) {}
export const MindmapEdgeSchema = MindmapEdge;

export class MindmapDiagram extends IntermediateDiagram.extend<MindmapDiagram>("MindmapDiagram")({
	type: Schema.Literal(mindmapDiagramType),
	nodes: Schema.Array(MindmapNode).pipe(Schema.mutable).check(Schema.isMinLength(2)),
	edges: Schema.Array(MindmapEdge).pipe(Schema.mutable).check(Schema.isMinLength(1)),
}) {}
export const MindmapDiagramSchema = MindmapDiagram;

export function validateMindmapDiagram(diagram: MindmapDiagram): MindmapDiagram {
	validateIntermediateDiagram(diagram);
	const roots = diagram.nodes.filter((node) => node.kind === "root");
	if (roots.length !== 1) {
		throw new DiagramValidationError(
			`Mindmap must contain exactly one root topic; found ${roots.length}.`,
		);
	}

	const root = roots[0];
	if (!root || root.metadata.depth !== 0) {
		throw new DiagramValidationError("Mindmap root topic must have depth 0.");
	}

	const incoming = new Map<string, number>();
	const nodeById = new Map(diagram.nodes.map((node) => [node.id, node]));
	const childrenByParent = new Map<string, number[]>();
	for (const edge of diagram.edges) {
		incoming.set(edge.target, (incoming.get(edge.target) ?? 0) + 1);
		const sourceDepth = nodeById.get(edge.source)?.metadata.depth;
		const target = nodeById.get(edge.target);
		const targetDepth = target?.metadata.depth;
		if (sourceDepth === undefined || targetDepth !== sourceDepth + 1) {
			throw new DiagramValidationError(
				`Mindmap edge "${edge.id}" must connect a topic to its immediate child.`,
			);
		}
		if (
			!target ||
			edge.metadata.depth !== target.metadata.depth ||
			edge.metadata.siblingIndex !== target.metadata.siblingIndex
		) {
			throw new DiagramValidationError(
				`Mindmap edge "${edge.id}" metadata must match its child topic.`,
			);
		}
		childrenByParent.set(edge.source, [
			...(childrenByParent.get(edge.source) ?? []),
			target.metadata.siblingIndex,
		]);
	}

	for (const node of diagram.nodes) {
		const count = incoming.get(node.id) ?? 0;
		if (node.id === root.id ? count !== 0 : count !== 1) {
			throw new DiagramValidationError(
				`Mindmap topic "${node.id}" must have ${node.id === root.id ? "no parent" : "exactly one parent"}.`,
			);
		}
	}
	for (const [parentId, siblingIndexes] of childrenByParent) {
		const expected = siblingIndexes.map((_, index) => index);
		const actual = [...siblingIndexes].sort((left, right) => left - right);
		if (actual.some((value, index) => value !== expected[index])) {
			throw new DiagramValidationError(
				`Mindmap children of "${parentId}" must use contiguous sibling ordering from 0.`,
			);
		}
	}
	return diagram;
}

export function parseMindmapDiagram(input: unknown): MindmapDiagram {
	return validateMindmapDiagram(Schema.decodeUnknownSync(MindmapDiagram, { errors: "all" })(input));
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
}): MindmapDiagram {
	const nodes: Record<string, unknown>[] = [];
	const edges: Record<string, unknown>[] = [];
	const visit = (topic: MindmapTopicTree, path: readonly number[], parentId?: string) => {
		const suffix = path.join("-");
		const depth = path.length - 1;
		const metadata = { depth, siblingIndex: path.at(-1)! };
		nodes.push({
			id: `topic-${suffix}`,
			label: topic.label,
			kind: depth === 0 ? "root" : "topic",
			metadata,
		});
		if (parentId)
			edges.push({ id: `branch-${suffix}`, source: parentId, target: `topic-${suffix}`, metadata });
		topic.children?.forEach((child, index) => visit(child, [...path, index], `topic-${suffix}`));
	};
	visit(tree.root, [0]);
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
});
