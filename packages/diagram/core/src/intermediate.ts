import { Effect, Schema } from "effect";

import { DIAGRAM_ICON_SLUG_MAX_LENGTH, DIAGRAM_ICON_SLUG_PATTERN } from "./icon.js";
import { DIAGRAM_TYPES, GRAPH_DIAGRAM_TYPES } from "./types.js";

const NonEmptyString = Schema.NonEmptyString;
const Metadata = Schema.Record(Schema.String, Schema.Unknown);

/**
 * Server/runtime mirror of the canonical CSS tokens in diagram-ui/theme.css.
 * intermediate.test.ts fails if these values drift from that source of truth.
 */
export const SKETCHI_DIAGRAM_PALETTE = Object.freeze({
	paper: "#f6f1e7",
	card: "#fffdf8",
	ink: "#1a1712",
	accent: "#8f707f",
});

export const SKETCHI_DIAGRAM_STYLE = Object.freeze({
	accentColor: SKETCHI_DIAGRAM_PALETTE.accent,
	backgroundColor: SKETCHI_DIAGRAM_PALETTE.card,
});

function withDefault<S extends Schema.Top>(schema: S, value: S["Encoded"]) {
	return schema.pipe(Schema.withDecodingDefault(Effect.succeed(value)));
}

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
export class DiagramIconRef extends Schema.Class<DiagramIconRef>("DiagramIconRef")({
	slug: NonEmptyString.check(
		Schema.isPattern(DIAGRAM_ICON_SLUG_PATTERN),
		Schema.isMaxLength(DIAGRAM_ICON_SLUG_MAX_LENGTH),
	),
}) {}
export const DiagramIconRefSchema = DiagramIconRef;

/**
 * What a group stands for in an architecture: a provider's cloud or an
 * on-premises data center, a region, an availability or network zone, a VPC
 * and its subnets, or a cluster and its namespaces. Each draws its own way.
 */
export const DIAGRAM_ZONE_KINDS = [
	"cloud",
	"datacenter",
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
export class DiagramGroup extends Schema.Class<DiagramGroup>("DiagramGroup")({
	id: NonEmptyString,
	label: NonEmptyString,
	/** The id of the declared group this group sits inside. */
	parent: Schema.optional(NonEmptyString),
	kind: Schema.optional(DiagramZoneKindSchema),
}) {}
export const DiagramGroupSchema = DiagramGroup;

/**
 * A swimlane: a full-length band for one actor, such as a customer, a team or
 * a system, drawn in declared order. Nodes join one by setting `lane` to its
 * id; a diagram with lanes puts every node in one, and declares no groups.
 */
export class DiagramLane extends Schema.Class<DiagramLane>("DiagramLane")({
	id: NonEmptyString,
	label: NonEmptyString,
}) {}
export const DiagramLaneSchema = DiagramLane;

/**
 * Shapes an infrastructure node draws as in place of its kind's: a database
 * cylinder, a queue lying on its side, a document with a wavy foot, or object
 * storage as a bucket.
 */
export const DIAGRAM_NODE_SHAPES = ["database", "queue", "document", "storage"] as const;
export const DiagramNodeShapeSchema = Schema.Literals(DIAGRAM_NODE_SHAPES);
export type DiagramNodeShape = typeof DiagramNodeShapeSchema.Type;

export class DiagramNode extends Schema.Class<DiagramNode>("DiagramNode")({
	id: NonEmptyString,
	label: NonEmptyString,
	/** The id of the declared group this node belongs to. */
	group: Schema.optional(NonEmptyString),
	/** The id of the declared lane this node sits in. */
	lane: Schema.optional(NonEmptyString),
	kind: Schema.optional(NonEmptyString),
	shape: Schema.optional(DiagramNodeShapeSchema),
	icon: Schema.optional(DiagramIconRef),
	metadata: withDefault(Metadata, {}),
}) {}
export const DiagramNodeSchema = DiagramNode;

/**
 * A node of a laid-out graph. Its description draws as a smaller, muted
 * subtitle under its label, inside the node.
 */
export class GraphNode extends DiagramNode.extend<GraphNode>("GraphNode")({
	description: Schema.optional(NonEmptyString),
}) {}
export const GraphNodeSchema = GraphNode;

export class DiagramEdge extends Schema.Class<DiagramEdge>("DiagramEdge")({
	id: NonEmptyString,
	source: NonEmptyString,
	target: NonEmptyString,
	label: Schema.optional(NonEmptyString),
	metadata: withDefault(Metadata, {}),
}) {}
export const DiagramEdgeSchema = DiagramEdge;

const HexColor = Schema.String.check(Schema.isPattern(/^#[0-9a-fA-F]{6}$/));

export class DiagramStyle extends Schema.Class<DiagramStyle>("DiagramStyle")({
	accentColor: withDefault(HexColor, SKETCHI_DIAGRAM_STYLE.accentColor),
	backgroundColor: withDefault(HexColor, SKETCHI_DIAGRAM_STYLE.backgroundColor),
}) {}
export const DiagramStyleSchema = DiagramStyle;

export class DiagramLayout extends Schema.Class<DiagramLayout>("DiagramLayout")({
	direction: withDefault(LayoutDirectionSchema, "LR"),
	edgeRouting: withDefault(EdgeRoutingSchema, "orthogonal"),
}) {}
export const DiagramLayoutSchema = DiagramLayout;

export class IntermediateDiagram extends Schema.Class<IntermediateDiagram>("IntermediateDiagram")({
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
}) {}
export const IntermediateDiagramSchema = IntermediateDiagram;

export class DiagramValidationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "DiagramValidationError";
	}
}

const findDuplicate = (values: readonly string[]) => {
	const seen = new Set<string>();

	for (const value of values) {
		if (seen.has(value)) {
			return value;
		}

		seen.add(value);
	}

	return undefined;
};

export function validateIntermediateDiagram(diagram: IntermediateDiagram): IntermediateDiagram {
	const duplicateNodeId = findDuplicate(diagram.nodes.map((node) => node.id));

	if (duplicateNodeId) {
		throw new DiagramValidationError(`Duplicate node id "${duplicateNodeId}" is not allowed.`);
	}

	const duplicateEdgeId = findDuplicate(diagram.edges.map((edge) => edge.id));

	if (duplicateEdgeId) {
		throw new DiagramValidationError(`Duplicate edge id "${duplicateEdgeId}" is not allowed.`);
	}

	const duplicateGroupId = findDuplicate((diagram.groups ?? []).map((group) => group.id));

	if (duplicateGroupId) {
		throw new DiagramValidationError(`Duplicate group id "${duplicateGroupId}" is not allowed.`);
	}

	const groupIds = new Set((diagram.groups ?? []).map((group) => group.id));
	const parentOf = new Map(
		(diagram.groups ?? []).flatMap((group) =>
			group.parent === undefined ? [] : [[group.id, group.parent] as const],
		),
	);

	for (const [groupId, parent] of parentOf) {
		if (!groupIds.has(parent)) {
			throw new DiagramValidationError(
				`Group "${groupId}" references missing parent group "${parent}".`,
			);
		}
		const seen = new Set([groupId]);
		for (let ancestor = parentOf.get(groupId); ancestor !== undefined;) {
			if (seen.has(ancestor)) {
				throw new DiagramValidationError(`Group "${groupId}" is nested inside itself.`);
			}
			seen.add(ancestor);
			ancestor = parentOf.get(ancestor);
		}
	}

	for (const node of diagram.nodes) {
		if (node.group !== undefined && !groupIds.has(node.group)) {
			throw new DiagramValidationError(
				`Node "${node.id}" references missing group "${node.group}".`,
			);
		}
	}

	const lanes = diagram.lanes ?? [];
	const duplicateLaneId = findDuplicate(lanes.map((lane) => lane.id));

	if (duplicateLaneId) {
		throw new DiagramValidationError(`Duplicate lane id "${duplicateLaneId}" is not allowed.`);
	}

	if (lanes.length > 0 && (diagram.groups ?? []).length > 0) {
		throw new DiagramValidationError("A diagram with lanes cannot also declare groups.");
	}

	const laneIds = new Set(lanes.map((lane) => lane.id));

	for (const node of diagram.nodes) {
		if (node.lane !== undefined && !laneIds.has(node.lane)) {
			throw new DiagramValidationError(`Node "${node.id}" references missing lane "${node.lane}".`);
		}

		if (node.lane === undefined && laneIds.size > 0) {
			throw new DiagramValidationError(`Node "${node.id}" has no lane.`);
		}
	}

	const nodeIds = new Set(diagram.nodes.map((node) => node.id));

	for (const edge of diagram.edges) {
		if (!nodeIds.has(edge.source)) {
			throw new DiagramValidationError(
				`Edge "${edge.id}" references missing source node "${edge.source}".`,
			);
		}

		if (!nodeIds.has(edge.target)) {
			throw new DiagramValidationError(
				`Edge "${edge.id}" references missing target node "${edge.target}".`,
			);
		}

		if (edge.source === edge.target) {
			throw new DiagramValidationError(
				`Edge "${edge.id}" cannot connect node "${edge.source}" to itself.`,
			);
		}
	}

	return diagram;
}

export function parseIntermediateDiagram(input: unknown): IntermediateDiagram {
	const diagram = Schema.decodeUnknownSync(IntermediateDiagram, {
		errors: "all",
	})(input);
	return validateIntermediateDiagram(diagram);
}
