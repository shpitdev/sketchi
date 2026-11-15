import {
	DiagramStyle,
	SKETCHI_DIAGRAM_STYLE,
	DIAGRAM_ICON_SLUG_MAX_LENGTH,
	DIAGRAM_ICON_SLUG_PATTERN,
} from "@sketchi/drawing";
import {
	Array,
	Effect,
	MutableHashMap,
	MutableHashSet,
	Option,
	Record,
	Result,
	Schema,
} from "effect";

import { DIAGRAM_TYPES, GRAPH_DIAGRAM_TYPES } from "./types.js";

function withDefault<S extends Schema.Top>(schema: S, value: S["Encoded"]) {
	return schema.pipe(Schema.withDecodingDefault(Effect.succeed(value)));
}

const NonEmptyString = Schema.NonEmptyString;
const Metadata = Schema.Record(Schema.String, Schema.Unknown);

/**
 * Server/runtime mirror of the canonical CSS tokens in editor/theme.css.
 * intermediate.test.ts fails if these values drift from that source of truth.
 */
export const DiagramTypeSchema = Schema.Literals(DIAGRAM_TYPES);
/** Sequence diagrams have their own contract; only graph families use nodes and edges. */
export const GraphDiagramTypeSchema = Schema.Literals(GRAPH_DIAGRAM_TYPES);
export const LayoutDirectionSchema = Schema.Literals(["TB", "BT", "LR", "RL"]);
export const EdgeRoutingSchema = Schema.Literals(["straight", "orthogonal", "curved"]);

export type DiagramType = typeof DiagramTypeSchema.Type;
export type GraphDiagramType = typeof GraphDiagramTypeSchema.Type;
export type LayoutDirection = typeof LayoutDirectionSchema.Type;
export type EdgeRouting = typeof EdgeRoutingSchema.Type;

/**
 * A reference to a Sketchi icon-catalog mark drawn inside a node. Every diagram
 * family shares this shape; resolving the slug against the catalog happens at
 * the build boundary, so this contract checks only the slug format.
 */
export const DiagramIconRef = Schema.Struct({
	slug: NonEmptyString.check(
		Schema.isPattern(DIAGRAM_ICON_SLUG_PATTERN),
		Schema.isMaxLength(DIAGRAM_ICON_SLUG_MAX_LENGTH),
	),
}).annotate({ identifier: "DiagramIconRef" });

export interface DiagramIconRef extends Schema.Schema.Type<typeof DiagramIconRef> {}

/**
 * What a group stands for in an architecture: a provider's cloud or an
 * on-premises data center, a corporate, on-premises or hybrid network, a
 * region, an availability zone, a VPC and its subnets, or a cluster and its
 * namespaces. Each draws its own way.
 */
export const DIAGRAM_ZONE_KINDS = [
	"cloud",
	"datacenter",
	"network",
	"region",
	"zone",
	"vpc",
	"subnet",
	"cluster",
	"namespace",
] as const;
export const DiagramZoneKindSchema = Schema.Literals(DIAGRAM_ZONE_KINDS);
export type DiagramZoneKind = typeof DiagramZoneKindSchema.Type;

/**
 * A labeled region that holds nodes together, such as a team, a phase, or a
 * zone of an architecture. Nodes join one by setting `group` to its id, and a
 * group sits inside another by setting `parent` to that group's id. A group
 * with a parent or a kind draws as a zone: an outline styled by its kind, with
 * its label in a header strip inside it. Other groups draw as frames.
 */
export const DiagramGroup = Schema.Struct({
	id: NonEmptyString,
	label: NonEmptyString,
	/** The id of the declared group this group sits inside. */
	parent: Schema.optional(NonEmptyString),
	kind: Schema.optional(DiagramZoneKindSchema),
	/** A catalog mark drawn before the group's label, such as its platform's logo. */
	icon: Schema.optional(DiagramIconRef),
}).annotate({ identifier: "DiagramGroup" });

export interface DiagramGroup extends Schema.Schema.Type<typeof DiagramGroup> {}

/**
 * A swimlane: a full-length band for one actor, such as a customer, a team or
 * a system, drawn in declared order. Nodes join one by setting `lane` to its
 * id; a diagram with lanes puts every node in one, and declares no groups.
 */
export const DiagramLane = Schema.Struct({
	id: NonEmptyString,
	label: NonEmptyString,
}).annotate({ identifier: "DiagramLane" });

export interface DiagramLane extends Schema.Schema.Type<typeof DiagramLane> {}

/**
 * Shapes an infrastructure node draws as in place of its kind's: a database
 * cylinder, a queue lying on its side, a document with a wavy foot, or object
 * storage as a bucket.
 */
export const DIAGRAM_NODE_SHAPES = ["database", "queue", "document", "storage"] as const;
export const DiagramNodeShapeSchema = Schema.Literals(DIAGRAM_NODE_SHAPES);
export type DiagramNodeShape = typeof DiagramNodeShapeSchema.Type;

/**
 * Colors a node may take, each drawn as its stroke over a pale tint of it, so the label
 * stays readable.
 */
export const DIAGRAM_NODE_COLORS = {
	red: { stroke: "#dc2626", fill: "#fee2e2" },
	orange: { stroke: "#ea580c", fill: "#ffedd5" },
	yellow: { stroke: "#ca8a04", fill: "#fef9c3" },
	green: { stroke: "#16a34a", fill: "#dcfce7" },
	blue: { stroke: "#2563eb", fill: "#dbeafe" },
	purple: { stroke: "#7c3aed", fill: "#ede9fe" },
	gray: { stroke: "#6b7280", fill: "#f3f4f6" },
} as const;
export const DIAGRAM_NODE_COLOR_NAMES = Record.keys(DIAGRAM_NODE_COLORS);
export const DiagramNodeColorSchema = Schema.Literals(DIAGRAM_NODE_COLOR_NAMES);
export type DiagramNodeColor = typeof DiagramNodeColorSchema.Type;

export const DiagramNode = Schema.Struct({
	id: NonEmptyString,
	label: NonEmptyString,
	/** The id of the declared group this node belongs to. */
	group: Schema.optional(NonEmptyString),
	/** The id of the declared lane this node sits in. */
	lane: Schema.optional(NonEmptyString),
	kind: Schema.optional(NonEmptyString),
	shape: Schema.optional(DiagramNodeShapeSchema),
	icon: Schema.optional(DiagramIconRef),
	/** A palette color the node draws in, its stroke over a pale tint. */
	color: Schema.optional(DiagramNodeColorSchema),
	metadata: withDefault(Metadata, {}),
}).annotate({ identifier: "DiagramNode" });

export interface DiagramNode extends Schema.Schema.Type<typeof DiagramNode> {}

/**
 * A node of a laid-out graph. Its description draws as a smaller, muted
 * subtitle under its label, inside the node.
 */
export const GraphNode = Schema.Struct({
	...DiagramNode.fields,
	description: Schema.optional(NonEmptyString),
}).annotate({ identifier: "GraphNode" });

export interface GraphNode extends Schema.Schema.Type<typeof GraphNode> {}

export const DiagramEdge = Schema.Struct({
	id: NonEmptyString,
	source: NonEmptyString,
	target: NonEmptyString,
	label: Schema.optional(NonEmptyString),
	metadata: withDefault(Metadata, {}),
}).annotate({ identifier: "DiagramEdge" });

export interface DiagramEdge extends Schema.Schema.Type<typeof DiagramEdge> {}

export const DiagramLayout = Schema.Struct({
	direction: withDefault(LayoutDirectionSchema, "LR"),
	edgeRouting: withDefault(EdgeRoutingSchema, "orthogonal"),
}).annotate({ identifier: "DiagramLayout" });

export interface DiagramLayout extends Schema.Schema.Type<typeof DiagramLayout> {}

export const IntermediateDiagram = Schema.Struct({
	id: NonEmptyString,
	title: NonEmptyString,
	type: withDefault(GraphDiagramTypeSchema, "flowchart"),
	nodes: Schema.Array(GraphNode).pipe(Schema.mutable).check(Schema.isMinLength(1)),
	edges: withDefault(Schema.Array(DiagramEdge).pipe(Schema.mutable), []),
	groups: Schema.optional(Schema.Array(DiagramGroup).pipe(Schema.mutable)),
	lanes: Schema.optional(Schema.Array(DiagramLane).pipe(Schema.mutable)),
	layout: withDefault(DiagramLayout, {
		direction: "LR",
		edgeRouting: "orthogonal",
	}),
	style: withDefault(DiagramStyle, SKETCHI_DIAGRAM_STYLE),
	metadata: withDefault(Metadata, {}),
}).annotate({ identifier: "IntermediateDiagram" });

export interface IntermediateDiagram extends Schema.Schema.Type<typeof IntermediateDiagram> {}

export class DiagramValidationError extends Schema.TaggedError<
	DiagramValidationError,
	{ readonly brand: unique symbol }
>()("DiagramValidationError", { message: Schema.String }) {}

const findDuplicate = (values: Iterable<string>): Option.Option<string> => {
	const seen = MutableHashSet.empty<string>();
	for (const value of values) {
		if (MutableHashSet.has(seen, value)) return Option.some(value);
		MutableHashSet.add(seen, value);
	}
	return Option.none();
};

export function validateIntermediateDiagram(
	diagram: IntermediateDiagram,
): Result.Result<IntermediateDiagram, DiagramValidationError> {
	return Result.gen(function* () {
		const duplicateNodeId = findDuplicate(Array.map(diagram.nodes, (node) => node.id));
		if (Option.isSome(duplicateNodeId) && duplicateNodeId.value) {
			return yield* Result.fail(
				DiagramValidationError.make({
					message: `Duplicate node id "${duplicateNodeId.value}" is not allowed.`,
				}),
			);
		}
		const duplicateEdgeId = findDuplicate(Array.map(diagram.edges, (edge) => edge.id));
		if (Option.isSome(duplicateEdgeId) && duplicateEdgeId.value) {
			return yield* Result.fail(
				DiagramValidationError.make({
					message: `Duplicate edge id "${duplicateEdgeId.value}" is not allowed.`,
				}),
			);
		}
		const groups = Option.getOrElse(Option.fromNullishOr(diagram.groups), () => []);
		const duplicateGroupId = findDuplicate(Array.map(groups, (group) => group.id));
		if (Option.isSome(duplicateGroupId) && duplicateGroupId.value) {
			return yield* Result.fail(
				DiagramValidationError.make({
					message: `Duplicate group id "${duplicateGroupId.value}" is not allowed.`,
				}),
			);
		}
		const groupIds = MutableHashSet.fromIterable(Array.map(groups, (group) => group.id));
		const parentOf = MutableHashMap.fromIterable(
			Array.getSomes(
				Array.map(groups, (group) =>
					Option.map(Option.fromUndefinedOr(group.parent), (parent) => [group.id, parent] as const),
				),
			),
		);
		for (const [groupId, parent] of parentOf) {
			if (!MutableHashSet.has(groupIds, parent)) {
				return yield* Result.fail(
					DiagramValidationError.make({
						message: `Group "${groupId}" references missing parent group "${parent}".`,
					}),
				);
			}
			const seen = MutableHashSet.make(groupId);
			let ancestor = MutableHashMap.get(parentOf, groupId);
			while (Option.isSome(ancestor)) {
				if (MutableHashSet.has(seen, ancestor.value)) {
					return yield* Result.fail(
						DiagramValidationError.make({ message: `Group "${groupId}" is nested inside itself.` }),
					);
				}
				MutableHashSet.add(seen, ancestor.value);
				ancestor = MutableHashMap.get(parentOf, ancestor.value);
			}
		}
		for (const node of diagram.nodes) {
			const group = Option.fromUndefinedOr(node.group);
			if (Option.isSome(group) && !MutableHashSet.has(groupIds, group.value)) {
				return yield* Result.fail(
					DiagramValidationError.make({
						message: `Node "${node.id}" references missing group "${group.value}".`,
					}),
				);
			}
		}
		const lanes = Option.getOrElse(Option.fromNullishOr(diagram.lanes), () => []);
		const duplicateLaneId = findDuplicate(Array.map(lanes, (lane) => lane.id));
		if (Option.isSome(duplicateLaneId) && duplicateLaneId.value) {
			return yield* Result.fail(
				DiagramValidationError.make({
					message: `Duplicate lane id "${duplicateLaneId.value}" is not allowed.`,
				}),
			);
		}
		if (lanes.length > 0 && groups.length > 0) {
			return yield* Result.fail(
				DiagramValidationError.make({
					message: "A diagram with lanes cannot also declare groups.",
				}),
			);
		}
		const laneIds = MutableHashSet.fromIterable(Array.map(lanes, (lane) => lane.id));
		for (const node of diagram.nodes) {
			const lane = Option.fromUndefinedOr(node.lane);
			if (Option.isSome(lane) && !MutableHashSet.has(laneIds, lane.value)) {
				return yield* Result.fail(
					DiagramValidationError.make({
						message: `Node "${node.id}" references missing lane "${lane.value}".`,
					}),
				);
			}
			if (Option.isNone(lane) && MutableHashSet.size(laneIds) > 0) {
				return yield* Result.fail(
					DiagramValidationError.make({ message: `Node "${node.id}" has no lane.` }),
				);
			}
		}
		const nodeIds = MutableHashSet.fromIterable(Array.map(diagram.nodes, (node) => node.id));
		for (const edge of diagram.edges) {
			if (!MutableHashSet.has(nodeIds, edge.source)) {
				return yield* Result.fail(
					DiagramValidationError.make({
						message: `Edge "${edge.id}" references missing source node "${edge.source}".`,
					}),
				);
			}
			if (!MutableHashSet.has(nodeIds, edge.target)) {
				return yield* Result.fail(
					DiagramValidationError.make({
						message: `Edge "${edge.id}" references missing target node "${edge.target}".`,
					}),
				);
			}
			if (edge.source === edge.target) {
				return yield* Result.fail(
					DiagramValidationError.make({
						message: `Edge "${edge.id}" cannot connect node "${edge.source}" to itself.`,
					}),
				);
			}
		}
		return diagram;
	});
}

export function parseIntermediateDiagram(
	input: unknown,
): Result.Result<IntermediateDiagram, Schema.SchemaError | DiagramValidationError> {
	return Result.flatMap(
		Schema.decodeUnknownResult(IntermediateDiagram, { errors: "all" })(input),
		validateIntermediateDiagram,
	);
}
