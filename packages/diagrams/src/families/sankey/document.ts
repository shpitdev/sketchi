// Maintained fixture literals/factories are trusted: invalid fixture data is a startup defect, not user input.
import { Effect, Schema, Array as Arr, Option, Result, Graph, String as Str } from "effect";
import { cleanToolString, slug } from "../../clean-text.js";

import { DiagramStyle, SKETCHI_DIAGRAM_STYLE } from "@sketchi/drawing";

export const sankeyDiagramType = "sankey" as const;

/** Larger flows stop reading as one diagram; split them by stage or fold small flows together. */
export const SANKEY_MAX_NODES = 40;
export const SANKEY_MAX_LINKS = 100;
/** Stages past this many columns read too wide. */
export const SANKEY_MAX_COLUMNS = 8;
export const SANKEY_MAX_LABEL_LENGTH = 48;
export const SANKEY_MAX_LINK_LABEL_LENGTH = 40;
export const SANKEY_MAX_ISSUES = 20;

const HexColor = Schema.String.check(Schema.isPattern(/^#[0-9a-fA-F]{6}$/u));

/** One stage of a flow, drawn as a bar as tall as the larger of its in and out totals. */
export const SankeyNode = Schema.Struct({
	id: Schema.NonEmptyString,
	label: Schema.NonEmptyString,
	/** Colors the bar and every flow leaving it; a stable palette color when omitted. */
	color: Schema.optionalKey(HexColor),
}).annotate({ identifier: "SankeyNode" });

export interface SankeyNode extends Schema.Schema.Type<typeof SankeyNode> {}

/** A flow of `value` from one node to another, drawn as a band as wide as its value. */
export const SankeyLink = Schema.Struct({
	source: Schema.NonEmptyString,
	target: Schema.NonEmptyString,
	value: Schema.Finite,
	/** Drawn with the flow's value, such as what the flow carries. */
	label: Schema.optionalKey(Schema.NonEmptyString),
}).annotate({ identifier: "SankeyLink" });

export interface SankeyLink extends Schema.Schema.Type<typeof SankeyLink> {}

/**
 * A Sankey diagram: nodes and the weighted flows between them, running one
 * way from sources to sinks. The renderer owns every coordinate, column and
 * band width.
 */
export const SankeyDocument = Schema.Struct({
	id: Schema.optionalKey(Schema.NonEmptyString),
	title: Schema.NonEmptyString,
	nodes: Schema.Array(SankeyNode).pipe(Schema.mutable, Schema.check(Schema.isMinLength(2))),
	links: Schema.Array(SankeyLink).pipe(Schema.mutable, Schema.check(Schema.isMinLength(1))),
	/** Value unit, formatted as charts format it: "$" → $12, "$M" → $12M, "%" → 12%, "GWh" → 12 GWh. */
	unit: Schema.optionalKey(Schema.NonEmptyString),
	style: DiagramStyle.pipe(
		Schema.withDecodingDefaultKey(Effect.succeed({ ...SKETCHI_DIAGRAM_STYLE })),
	),
});
export interface SankeyDocument extends Schema.Schema.Type<typeof SankeyDocument> {}

export const SankeyDiagram = SankeyDocument.mapFields((fields) => ({
	...fields,
	id: Schema.NonEmptyString,
	type: Schema.Literal(sankeyDiagramType),
})).annotate({ identifier: "SankeyDiagram" });

export interface SankeyDiagram extends Schema.Schema.Type<typeof SankeyDiagram> {}

export const SankeyValidationIssueCodeSchema = Schema.Literals([
	"sankey_too_large",
	"invalid_sankey_node_id",
	"duplicate_sankey_node_id",
	"sankey_text_too_long",
	"unknown_sankey_node",
	"sankey_self_link",
	"duplicate_sankey_link",
	"invalid_sankey_value",
	"sankey_cycle",
	"unlinked_sankey_node",
	"blank_sankey_label",
]);
export type SankeyValidationIssueCode = typeof SankeyValidationIssueCodeSchema.Type;

export const SankeyValidationIssue = Schema.Struct({
	code: SankeyValidationIssueCodeSchema,
	/** Dotted path into the diagram, for example `links.[3].target`. */
	path: Schema.NonEmptyString,
	message: Schema.NonEmptyString,
	hint: Schema.NonEmptyString,
}).annotate({ identifier: "SankeyValidationIssue" });

export interface SankeyValidationIssue extends Schema.Schema.Type<typeof SankeyValidationIssue> {}

/** Ids on one cycle of links, in flow order, or undefined when the flows run one way. */
export function sankeyCycle(
	links: readonly Pick<SankeyLink, "source" | "target">[],
): string[] | undefined {
	const graph = Graph.directed<string, undefined>((mutable) => {
		const indices = new Map<string, Graph.NodeIndex>();
		const node = (id: string) => {
			const known = indices.get(id);
			if (known !== undefined) return known;
			const index = Graph.addNode(mutable, id);
			indices.set(id, index);
			return index;
		};
		for (const link of links) {
			// Self-links have their own actionable validation issue.
			if (link.source !== link.target)
				Graph.addEdge(mutable, node(link.source), node(link.target), undefined);
		}
	});
	return Option.getOrUndefined(
		Option.map(Graph.findCycle(graph), (cycle) =>
			Arr.map(cycle.path, (index) => Option.getOrThrow(Graph.getNode(graph, index))),
		),
	);
}

/**
 * Each node's column: the longest run of links from any source (a node with
 * no inflow) to it. A sink (a node nothing flows out of) fed by several nodes,
 * such as a shared drop-off or an outcome, aligns with the last column; a sink
 * fed by one node stays beside it. Assumes the links run one way.
 */
export function sankeyColumns(
	diagram: Pick<SankeyDiagram, "nodes" | "links">,
): ReadonlyMap<string, number> {
	const incoming = new Map<string, string[]>();
	for (const link of diagram.links)
		if (link.source !== link.target)
			incoming.set(link.target, [...(incoming.get(link.target) ?? []), link.source]);
	const columns = new Map<string, number>();
	const visiting = new Set<string>();
	const column = (id: string): number => {
		const known = columns.get(id);
		if (known !== undefined) return known;
		// A cycle has no column; validation reports it.
		if (visiting.has(id)) return 0;
		visiting.add(id);
		const value = Math.max(-1, ...Arr.map(incoming.get(id) ?? [], column)) + 1;
		visiting.delete(id);
		columns.set(id, value);
		return value;
	};
	for (const node of diagram.nodes) column(node.id);
	const last = Math.max(0, ...columns.values());
	const feeds = new Set(Arr.map(diagram.links, (link) => link.source));
	for (const node of diagram.nodes)
		if (!feeds.has(node.id) && new Set(incoming.get(node.id)).size > 1) columns.set(node.id, last);
	return columns;
}

/** Fraction digits a value carries, read from its shortest round-trip form. */
function decimalsOf(value: number): number {
	const [mantissa, exponent = "0"] = Str.split(Math.abs(value).toString(), "e");
	return Math.max(0, (Str.split(mantissa, ".")[1]?.length ?? 0) - Number(exponent));
}

/**
 * A sum of authored values without floating-point noise: rounded to the finest
 * precision among them, never coarser, so 0.1 + 0.2 reads 0.3 while 1e-13 and
 * 0.1234567890123 keep every digit. Precisions past toFixed's reach (finer than
 * 1e-100) keep 15 significant digits.
 */
export function sankeySum(values: readonly number[]): number {
	const decimals = Math.max(0, ...Arr.map(values, decimalsOf));
	const total = Arr.reduce(values, 0, (sum, value) => sum + value);
	return decimals <= 100 ? Number(total.toFixed(decimals)) : Number(total.toPrecision(15));
}

export interface SankeyNodeTotals {
	readonly inflow: number;
	readonly outflow: number;
	/** The larger of the two, which the node's bar and label show. */
	readonly total: number;
}

/** Each node's inflow, outflow and the total it shows. */
export function sankeyNodeTotals(
	diagram: Pick<SankeyDiagram, "nodes" | "links">,
): ReadonlyMap<string, SankeyNodeTotals> {
	const inflows = new Map<string, number[]>();
	const outflows = new Map<string, number[]>();
	for (const link of diagram.links) {
		inflows.set(link.target, [...(inflows.get(link.target) ?? []), link.value]);
		outflows.set(link.source, [...(outflows.get(link.source) ?? []), link.value]);
	}
	return new Map(
		Arr.map(diagram.nodes, (node) => {
			const inflow = sankeySum(inflows.get(node.id) ?? []);
			const outflow = sankeySum(outflows.get(node.id) ?? []);
			return [node.id, { inflow, outflow, total: Math.max(inflow, outflow) }];
		}),
	);
}

export function getSankeyValidationIssues(diagram: SankeyDiagram): SankeyValidationIssue[] {
	const issues: SankeyValidationIssue[] = [];
	const push = (code: SankeyValidationIssueCode, path: string, message: string, hint: string) =>
		issues.push({ code, path, message, hint });
	const { nodes, links } = diagram;
	if (nodes.length > SANKEY_MAX_NODES)
		push(
			"sankey_too_large",
			"nodes",
			`A Sankey diagram holds at most ${SANKEY_MAX_NODES} nodes; this one has ${nodes.length}.`,
			'Fold the smallest nodes of a stage into one "Other" node, or split the flow into several diagrams.',
		);
	if (links.length > SANKEY_MAX_LINKS)
		push(
			"sankey_too_large",
			"links",
			`A Sankey diagram holds at most ${SANKEY_MAX_LINKS} links; this one has ${links.length}.`,
			'Fold the smallest flows into an "Other" node, or split the flow into several diagrams.',
		);
	const ids = new Set<string>();
	Arr.forEach(nodes, (node, index) => {
		const path = `nodes.[${index}]`;
		if (Str.includes(":")(node.id))
			push(
				"invalid_sankey_node_id",
				`${path}.id`,
				`Node id "${node.id}" contains a colon.`,
				"Use a short id without colons, such as compute or paid-search.",
			);
		if (ids.has(node.id))
			push(
				"duplicate_sankey_node_id",
				`${path}.id`,
				`Node id "${node.id}" is used more than once.`,
				"Give each node a unique id; list a stage once and send every flow through it.",
			);
		ids.add(node.id);
		if (Str.trim(node.label) === "")
			push(
				"blank_sankey_label",
				`${path}.label`,
				`Node "${node.id}" has a blank label.`,
				"Give the node the name the source states.",
			);
		if (Str.trim(node.label).length > SANKEY_MAX_LABEL_LENGTH)
			push(
				"sankey_text_too_long",
				`${path}.label`,
				`The label of node "${node.id}" is longer than ${SANKEY_MAX_LABEL_LENGTH} characters.`,
				`Shorten the label to at most ${SANKEY_MAX_LABEL_LENGTH} characters.`,
			);
	});
	const linked = new Set<string>();
	const pairs = new Map<string, number>();
	Arr.forEach(links, (link, index) => {
		const path = `links.[${index}]`;
		for (const end of ["source", "target"] as const) {
			linked.add(link[end]);
			if (!ids.has(link[end]))
				push(
					"unknown_sankey_node",
					`${path}.${end}`,
					`Link ${index + 1} names unknown ${end} "${link[end]}".`,
					"Use the id of a node in nodes, or add the node.",
				);
		}
		if (link.source === link.target)
			push(
				"sankey_self_link",
				path,
				`Link ${index + 1} flows from "${link.source}" into itself.`,
				"A flow runs from one node to another; drop it, or send it to a node of the next stage.",
			);
		if (!(link.value > 0))
			push(
				"invalid_sankey_value",
				`${path}.value`,
				`Link "${link.source}" → "${link.target}" has value ${link.value}; flows must be positive.`,
				link.value < 0
					? "Swap source and target to reverse the flow, and give its size as a positive value."
					: "Drop a flow of zero, or give its stated value.",
			);
		const pair = `${link.source}\u0000${link.target}`;
		const first = pairs.get(pair);
		if (first !== undefined)
			push(
				"duplicate_sankey_link",
				path,
				`Links ${first + 1} and ${index + 1} both flow from "${link.source}" to "${link.target}".`,
				"Merge them into one link whose value is their sum.",
			);
		else pairs.set(pair, index);
		if (link.label !== undefined && Str.trim(link.label) === "")
			push(
				"blank_sankey_label",
				`${path}.label`,
				`Link ${index + 1} has a blank label.`,
				"Give the label the source states, or omit label.",
			);
		if (link.label !== undefined && Str.trim(link.label).length > SANKEY_MAX_LINK_LABEL_LENGTH)
			push(
				"sankey_text_too_long",
				`${path}.label`,
				`The label of link ${index + 1} is longer than ${SANKEY_MAX_LINK_LABEL_LENGTH} characters.`,
				`Shorten the label to at most ${SANKEY_MAX_LINK_LABEL_LENGTH} characters.`,
			);
	});
	Arr.forEach(nodes, (node, index) => {
		if (!linked.has(node.id))
			push(
				"unlinked_sankey_node",
				`nodes.[${index}]`,
				`Node "${node.id}" has no flow in or out.`,
				"Link it to the stage it feeds or draws from, or remove it.",
			);
	});
	const cycle = sankeyCycle(links);
	if (cycle) {
		const source = cycle[cycle.length - 2],
			target = cycle[cycle.length - 1];
		const back = Option.getOrElse(
			Arr.findFirstIndex(links, (link) => link.source === source && link.target === target),
			() => -1,
		);
		push(
			"sankey_cycle",
			`links.[${back}]`,
			`Flows run in a cycle: ${Arr.join(cycle, " → ")}.`,
			`A Sankey diagram flows one way. Drop the flow from "${source}" back to "${target}", or send it to a separate node such as "${target} (returning)".`,
		);
	} else if (issues.length === 0) {
		const deepest = Math.max(...sankeyColumns(diagram).values()) + 1;
		if (deepest > SANKEY_MAX_COLUMNS)
			push(
				"sankey_too_large",
				"links",
				`The flow runs through ${deepest} stages; a Sankey diagram draws at most ${SANKEY_MAX_COLUMNS} columns.`,
				"Merge consecutive stages, or split the flow into several diagrams.",
			);
	}
	return Arr.take(issues, SANKEY_MAX_ISSUES);
}

export class SankeyValidationError extends Schema.TaggedError<
	SankeyValidationError,
	{ readonly brand: unique symbol }
>()("SankeyValidationError", {
	message: Schema.String,
	issues: Schema.Array(SankeyValidationIssue),
}) {
	static fromIssues(issues: readonly SankeyValidationIssue[]): SankeyValidationError {
		return SankeyValidationError.make({
			issues,
			message: Option.match(Arr.head(issues), {
				onNone: () => "Sankey diagram failed semantic validation.",
				onSome: (issue) => issue.message,
			}),
		});
	}
}

export function validateSankeyDiagram(
	diagram: SankeyDiagram,
): Result.Result<SankeyDiagram, SankeyValidationError> {
	const issues = getSankeyValidationIssues(diagram);
	return issues.length > 0
		? Result.fail(SankeyValidationError.fromIssues(issues))
		: Result.succeed(diagram);
}

export function parseSankeyDiagram(
	input: unknown,
): Result.Result<SankeyDiagram, Schema.SchemaError | SankeyValidationError> {
	return Result.flatMap(
		Schema.decodeUnknownResult(SankeyDiagram, { errors: "all" })(input),
		validateSankeyDiagram,
	);
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Arr.isArray(value);

/** The first of `keys` a record sets, removed from `rest`. */
function take(rest: Record<string, unknown>, keys: readonly string[]): unknown {
	let found: unknown;
	for (const key of keys) {
		if (found === undefined && rest[key] !== undefined) found = rest[key];
		delete rest[key];
	}
	return found;
}

const SOURCE_KEYS = ["source", "from", "src"];
const TARGET_KEYS = ["target", "to", "dst", "destination"];
const VALUE_KEYS = ["value", "amount", "weight", "count", "size", "flow"];
const LABEL_KEYS = ["label", "name", "title"];

/** "1,200" and " 42 " read as numbers; anything else stays as written for the decoder to report. */
function numeric(value: unknown): unknown {
	if (typeof value !== "string") return value;
	const parsed = Number(Str.replace(/,/gu, "")(Str.trim(value)));
	return Str.trim(value) !== "" && Number.isFinite(parsed) ? parsed : value;
}

/**
 * Read the ways people write a Sankey into the canonical shape: `flows` or
 * `edges` for links, `from`/`to` for source and target, `amount`, `weight` or
 * `count` for value, nodes written as bare names or with `name` for label,
 * links that name nodes by label, and links alone with no node list (each name
 * becomes a node).
 */
export function resolveSankeyShorthand(input: unknown): unknown {
	if (!isRecord(input)) return input;
	const { flows, edges, connections, ...diagram } = input;
	const listedLinks =
		diagram["links"] !== undefined
			? diagram["links"]
			: flows !== undefined
				? flows
				: edges !== undefined
					? edges
					: connections;
	const listedNodes = diagram["nodes"];
	const nodes: unknown[] = [];
	// An end names a node by its exact id first; only then by label or either in
	// another case, so a label that spells another node's id never captures it.
	const exactIds = new Set<string>();
	const aliases = new Map<string, string>();
	const register = (id: string, label: string) => {
		exactIds.add(id);
		for (const key of [label, Str.toLowerCase(id), Str.toLowerCase(label)])
			if (!aliases.has(key)) aliases.set(key, id);
	};
	const usedIds = new Set<string>();
	const freshId = (label: string) => {
		const base = slug(label, { unicode: true, maxLength: Infinity }) || "node";
		let id = base;
		for (let suffix = 2; usedIds.has(id); suffix += 1) id = `${base}-${suffix}`;
		usedIds.add(id);
		return id;
	};
	const resolvedNodes = Arr.isArray(listedNodes)
		? Arr.map(listedNodes, (node) => {
				if (typeof node === "string") {
					const id = freshId(node);
					register(id, node);
					return { id, label: node };
				}
				if (!isRecord(node)) return node;
				const rest: Record<string, unknown> = { ...node };
				const label = take(rest, LABEL_KEYS);
				const id = typeof rest["id"] === "string" && rest["id"] !== "" ? rest["id"] : undefined;
				const resolvedLabel = label ?? id;
				const resolvedId =
					id ?? (typeof resolvedLabel === "string" ? freshId(resolvedLabel) : undefined);
				if (typeof resolvedId === "string") {
					usedIds.add(resolvedId);
					register(resolvedId, typeof resolvedLabel === "string" ? resolvedLabel : resolvedId);
				}
				if (rest["color"] === null || rest["color"] === "") delete rest["color"];
				return {
					...rest,
					...(resolvedId === undefined ? {} : { id: resolvedId }),
					...(resolvedLabel === undefined ? {} : { label: resolvedLabel }),
				};
			})
		: listedNodes;
	if (Arr.isArray(resolvedNodes)) nodes.push(...resolvedNodes);
	const endpoint = (value: unknown): unknown => {
		// An end written as a node ({ id } or { label }) reads as that name; anything
		// else stays as written for the decoder to report.
		if (isRecord(value)) {
			const name = Option.getOrUndefined(
				Arr.findFirst(
					[value["id"], value["label"], value["name"]],
					(entry) => typeof entry === "string" && entry !== "",
				),
			);
			if (name === undefined) return value;
			value = name;
		}
		if (typeof value !== "string" || value === "") return value;
		const known = exactIds.has(value)
			? value
			: (aliases.get(value) ?? aliases.get(Str.toLowerCase(value)));
		if (known !== undefined) return known;
		// Listed nodes are the whole set, so validation names an unknown end; without
		// a list, every name a link gives becomes a node of its own. A malformed list
		// (null, an object, a name) is never replaced: the decoder rejects it.
		if (listedNodes !== undefined) return value;
		const id = freshId(value);
		usedIds.add(id);
		register(id, value);
		nodes.push({ id, label: value });
		return id;
	};
	const links = Arr.isArray(listedLinks)
		? Arr.map(listedLinks, (link) => {
				if (!isRecord(link)) return link;
				const rest: Record<string, unknown> = { ...link };
				const source = endpoint(take(rest, SOURCE_KEYS));
				const target = endpoint(take(rest, TARGET_KEYS));
				const value = numeric(take(rest, VALUE_KEYS));
				const label = take(rest, LABEL_KEYS);
				return {
					...rest,
					...(source === undefined ? {} : { source }),
					...(target === undefined ? {} : { target }),
					...(value === undefined ? {} : { value }),
					...(label === undefined || label === "" ? {} : { label }),
				};
			})
		: listedLinks;
	return {
		...diagram,
		...(listedNodes === undefined
			? nodes.length === 0
				? {}
				: { nodes }
			: { nodes: Arr.isArray(listedNodes) ? nodes : listedNodes }),
		...(listedLinks === undefined ? {} : { links }),
	};
}

export const sankeyFixture = parseSankeyDiagram({
	id: "cloud-budget",
	title: "Cloud budget",
	type: sankeyDiagramType,
	unit: "$k",
	nodes: [
		{ id: "engineering", label: "Engineering" },
		{ id: "data", label: "Data" },
		{ id: "marketing", label: "Marketing" },
		{ id: "compute", label: "Compute" },
		{ id: "storage", label: "Storage" },
		{ id: "databases", label: "Databases" },
		{ id: "networking", label: "Networking" },
	],
	links: [
		{ source: "engineering", target: "compute", value: 180 },
		{ source: "engineering", target: "databases", value: 60 },
		{ source: "engineering", target: "storage", value: 40 },
		{ source: "engineering", target: "networking", value: 25 },
		{ source: "data", target: "storage", value: 85 },
		{ source: "data", target: "compute", value: 70 },
		{ source: "data", target: "databases", value: 30 },
		{ source: "marketing", target: "compute", value: 12 },
		{ source: "marketing", target: "storage", value: 8 },
	],
}).pipe(Result.getOrThrow);

export function normalizeSankey(spec: SankeyDocument): SankeyDiagram {
	const title = cleanToolString(spec.title);
	const optional = (key: string, value: string | undefined) =>
		value && cleanToolString(value) ? { [key]: cleanToolString(value) } : {};
	return {
		id:
			(spec.id === undefined ? undefined : cleanToolString(spec.id) || undefined) ??
			(slug(title) || "sketchi-sankey"),
		title,
		type: sankeyDiagramType,
		nodes: Arr.map(spec.nodes, (node) => ({
			id: cleanToolString(node.id),
			label: cleanToolString(node.label),
			...(node.color ? { color: node.color } : {}),
		})),
		links: Arr.map(spec.links, (link) => ({
			source: cleanToolString(link.source),
			target: cleanToolString(link.target),
			value: link.value,
			...optional("label", link.label),
		})),
		...optional("unit", spec.unit),
		style: { ...SKETCHI_DIAGRAM_STYLE },
	};
}

/** Counts and domain nouns shown by generation consumers. */
export function counts(diagram: SankeyDiagram) {
	return {
		nodeCount: diagram.nodes.length,
		nodeNoun: "nodes",
		edgeCount: diagram.links.length,
		edgeNoun: "flows",
	};
}
