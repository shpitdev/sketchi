import {
	Record as Rec,
	String as Str,
	Order,
	Effect,
	Schema,
	Array as Arr,
	Option,
	Result,
} from "effect";
import { cleanToolString, slug } from "../../clean-text.js";
import { DiagramStyle, SKETCHI_DIAGRAM_STYLE } from "@sketchi/drawing";
export const vennDiagramType = "venn" as const;
/** Two or three overlapping sets; more stop reading as one symmetric diagram. */
export const VENN_MIN_SETS = 2;
export const VENN_MAX_SETS = 3;
/** A region lists at most this many items, and the diagram this many in all. */
export const VENN_MAX_REGION_ITEMS = 12;
export const VENN_MAX_ITEMS = 40;
export const VENN_MAX_ITEM_LENGTH = 60;
export const VENN_MAX_LABEL_LENGTH = 40;
export const VENN_MAX_ISSUES = 20;
/**
 * Named set colors, validated for color-vision deficiencies on the card
 * surface. Sets without a color take blue, orange and green in order.
 */
export const VENN_COLORS = Object.freeze({
	blue: "#2a78d6",
	orange: "#eb6834",
	green: "#1baf7a",
	yellow: "#eda100",
	pink: "#e87ba4",
	violet: "#6250d6",
	red: "#e34948",
	gray: "#7a7468",
});
export type VennColorName = keyof typeof VENN_COLORS;
export const VENN_COLOR_NAMES = Rec.keys(VENN_COLORS);
const VENN_DEFAULT_COLORS: readonly VennColorName[] = ["blue", "orange", "green"];
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/u;
/** One set: a circle with its label outside it. */
export const VennSet = Schema.Struct({
	id: Schema.NonEmptyString,
	label: Schema.NonEmptyString,
	/** A palette name (blue, orange, green, yellow, pink, violet, red, gray) or a #rrggbb hex. */
	color: Schema.optionalKey(Schema.NonEmptyString),
}).annotate({ identifier: "VennSet" });
export interface VennSet extends Schema.Schema.Type<typeof VennSet> {}
/**
 * One region: the items in every listed set and in no other. `["a"]` is only
 * in a, `["a", "b"]` in a and b but not c. A region holds items or a count.
 */
export const VennRegion = Schema.Struct({
	sets: Schema.Array(Schema.NonEmptyString).pipe(
		Schema.mutable,
		Schema.check(Schema.isMinLength(1)),
	),
	/** A name for the overlap itself, drawn above its items. */
	label: Schema.optionalKey(Schema.NonEmptyString),
	items: Schema.optionalKey(Schema.Array(Schema.NonEmptyString).pipe(Schema.mutable)),
	count: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
}).annotate({ identifier: "VennRegion" });
export interface VennRegion extends Schema.Schema.Type<typeof VennRegion> {}
/**
 * The canonical Venn diagram: two or three sets and what sits in each of
 * their regions. The renderer owns every position and size. Every surface
 * that accepts, generates, renders or evaluates a Venn diagram uses this shape.
 */
export const VennDocument = Schema.Struct({
	id: Schema.optionalKey(Schema.NonEmptyString),
	title: Schema.NonEmptyString,
	sets: Schema.Array(VennSet).pipe(Schema.mutable, Schema.check(Schema.isMinLength(1))),
	regions: Schema.Array(VennRegion).pipe(
		Schema.mutable,
		Schema.withDecodingDefaultKey(Effect.succeed([])),
	),
	style: DiagramStyle.pipe(Schema.withDecodingDefaultKey(Effect.succeed(SKETCHI_DIAGRAM_STYLE))),
});
export interface VennDocument extends Schema.Schema.Type<typeof VennDocument> {}
/** The dispatcher adds a tag and rendering needs a stable id; set and region fields have one owner. */
export const VennDiagram = Schema.Struct({
	...VennDocument.fields,
	id: Schema.NonEmptyString,
	type: Schema.Literal("venn"),
});
export interface VennDiagram extends Schema.Schema.Type<typeof VennDiagram> {}
export function normalizeVenn(document: VennDocument): VennDiagram {
	const title = cleanToolString(document.title);
	const optional = (key: string, value: string | undefined) =>
		value && cleanToolString(value) ? { [key]: cleanToolString(value) } : {};
	const id = document.id && cleanToolString(document.id);
	return {
		id: id || slug(title) || "sketchi-venn",
		title,
		sets: Arr.map(document.sets, (set) => ({
			id: cleanToolString(set.id),
			label: cleanToolString(set.label),
			...optional("color", set.color),
		})),
		regions: Arr.map(document.regions, (region) => ({
			sets: Arr.map(region.sets, cleanToolString),
			...optional("label", region.label),
			...(region.items === undefined ? {} : { items: Arr.map(region.items, cleanToolString) }),
			...(region.count === undefined ? {} : { count: region.count }),
		})),
		style: SKETCHI_DIAGRAM_STYLE,
		type: "venn",
	};
}
export const VennValidationIssueCodeSchema = Schema.Literals([
	"venn_set_count",
	"duplicate_venn_set",
	"invalid_venn_color",
	"unknown_venn_set",
	"duplicate_venn_region",
	"invalid_venn_region",
	"venn_text_too_long",
	"venn_too_large",
]);
export type VennValidationIssueCode = typeof VennValidationIssueCodeSchema.Type;
export const VennValidationIssue = Schema.Struct({
	code: VennValidationIssueCodeSchema,
	/** Dotted path into the diagram, for example `regions.[2].sets`. */
	path: Schema.NonEmptyString,
	message: Schema.NonEmptyString,
	hint: Schema.NonEmptyString,
}).annotate({ identifier: "VennValidationIssue" });
export interface VennValidationIssue extends Schema.Schema.Type<typeof VennValidationIssue> {}
const sameText = (text: string) => Str.toLowerCase(Str.trim(text));
/** A palette name, read from the palette's own keys so inherited ones ("constructor") never match. */
const isPaletteName = (color: string): color is VennColorName =>
	Arr.some(VENN_COLOR_NAMES, (name) => name === color);
/** A set's color as hex: its own, or the next default in order. */
export function vennSetColor(set: Pick<VennSet, "color">, index: number): string {
	const color = set.color === undefined ? undefined : Str.trim(set.color);
	if (color && HEX_COLOR.test(color)) return Str.toLowerCase(color);
	const key = color === undefined ? undefined : Str.toLowerCase(color);
	const named = key && isPaletteName(key) ? VENN_COLORS[key] : undefined;
	return named ?? VENN_COLORS[VENN_DEFAULT_COLORS[index] ?? "violet"];
}
/** A region's sets in set order, so `["b", "a"]` and `["a", "b"]` are one region. */
export function vennRegionKey(
	diagram: Pick<VennDiagram, "sets">,
	region: Pick<VennRegion, "sets">,
): number[] {
	const order = new Map(Arr.map(diagram.sets, (set, index) => [set.id, index]));
	return Arr.sort(
		Arr.dedupe(
			Arr.flatMap(region.sets, (id) => {
				const index = order.get(id);
				return index === undefined ? [] : [index];
			}),
		),
		Order.Number,
	);
}
export function getVennValidationIssues(diagram: VennDiagram): VennValidationIssue[] {
	const issues: VennValidationIssue[] = [];
	const push = (code: VennValidationIssueCode, path: string, message: string, hint: string) =>
		issues.push(VennValidationIssue.make({ code, path, message, hint }));
	const { sets, regions } = diagram;
	if (sets.length < VENN_MIN_SETS || sets.length > VENN_MAX_SETS)
		push(
			"venn_set_count",
			"sets",
			`A Venn diagram has ${VENN_MIN_SETS} or ${VENN_MAX_SETS} sets, not ${sets.length}.`,
			sets.length < VENN_MIN_SETS
				? "Add the set it overlaps with, or use a different diagram."
				: "Keep the three sets the request compares, or split them into several diagrams.",
		);
	const ids = new Set<string>();
	const labels = new Set<string>();
	Arr.forEach(sets, (set, index) => {
		const path = `sets.[${index}]`;
		if (ids.has(set.id))
			push(
				"duplicate_venn_set",
				`${path}.id`,
				`Set id "${set.id}" is used more than once.`,
				"Give every set a distinct id.",
			);
		ids.add(set.id);
		if (labels.has(sameText(set.label)))
			push(
				"duplicate_venn_set",
				`${path}.label`,
				`Set label "${set.label}" is used more than once.`,
				"Give every set a distinct label.",
			);
		labels.add(sameText(set.label));
		if (Str.trim(set.label).length > VENN_MAX_LABEL_LENGTH)
			push(
				"venn_text_too_long",
				`${path}.label`,
				`The label of set "${set.id}" is longer than ${VENN_MAX_LABEL_LENGTH} characters.`,
				`Shorten the label to at most ${VENN_MAX_LABEL_LENGTH} characters.`,
			);
		const color = set.color === undefined ? undefined : Str.trim(set.color);
		if (color !== undefined && !HEX_COLOR.test(color) && !isPaletteName(Str.toLowerCase(color)))
			push(
				"invalid_venn_color",
				`${path}.color`,
				`Set "${set.id}" has an unknown color "${set.color}".`,
				`Use one of ${Arr.join(VENN_COLOR_NAMES, ", ")} or a #rrggbb hex, or omit color.`,
			);
	});
	const seenRegions = new Map<string, number>();
	let total = 0;
	Arr.forEach(regions, (region, index) => {
		const path = `regions.[${index}]`;
		const unknown = Arr.filter(region.sets, (id) => !ids.has(id));
		for (const id of unknown)
			push(
				"unknown_venn_set",
				`${path}.sets`,
				`Region ${index + 1} names set "${id}", which is not in sets.`,
				`Key each region by set ids: ${Arr.join(
					Arr.map(sets, (set) => set.id),
					", ",
				)}.`,
			);
		if (new Set(region.sets).size !== region.sets.length)
			push(
				"invalid_venn_region",
				`${path}.sets`,
				`Region ${index + 1} lists a set more than once.`,
				"List each set of a region once.",
			);
		if (unknown.length === 0) {
			const key = Arr.join(Arr.map(vennRegionKey(diagram, region), String), "+");
			const first = seenRegions.get(key);
			if (first !== undefined)
				push(
					"duplicate_venn_region",
					`${path}.sets`,
					`Regions ${first + 1} and ${index + 1} are the same overlap (${Arr.join(region.sets, " & ")}).`,
					"Merge their items into one region.",
				);
			else seenRegions.set(key, index);
		}
		if (region.items !== undefined && region.count !== undefined)
			push(
				"invalid_venn_region",
				path,
				`Region ${index + 1} has both items and a count.`,
				"Give a region items or a count, not both.",
			);
		const items = region.items ?? [];
		total += items.length;
		if (items.length > VENN_MAX_REGION_ITEMS)
			push(
				"venn_too_large",
				`${path}.items`,
				`Region ${index + 1} lists ${items.length} items; a region holds at most ${VENN_MAX_REGION_ITEMS}.`,
				"Keep the items the request names, group similar ones, or give a count instead.",
			);
		Arr.forEach(items, (item, itemIndex) => {
			if (Str.trim(item).length > VENN_MAX_ITEM_LENGTH)
				push(
					"venn_text_too_long",
					`${path}.items.[${itemIndex}]`,
					`Item "${Str.slice(0, 24)(item)}…" is longer than ${VENN_MAX_ITEM_LENGTH} characters.`,
					`Shorten each item to a phrase of at most ${VENN_MAX_ITEM_LENGTH} characters.`,
				);
		});
		if (region.label !== undefined && Str.trim(region.label).length > VENN_MAX_LABEL_LENGTH)
			push(
				"venn_text_too_long",
				`${path}.label`,
				`The label of region ${index + 1} is longer than ${VENN_MAX_LABEL_LENGTH} characters.`,
				`Shorten the label to at most ${VENN_MAX_LABEL_LENGTH} characters.`,
			);
	});
	if (total > VENN_MAX_ITEMS)
		push(
			"venn_too_large",
			"regions",
			`The diagram lists ${total} items; a Venn diagram holds at most ${VENN_MAX_ITEMS}.`,
			"Keep the items the request names, or give regions counts instead.",
		);
	return Arr.take(issues, VENN_MAX_ISSUES);
}
export class VennValidationError extends Schema.TaggedError<
	VennValidationError,
	{
		readonly brand: unique symbol;
	}
>()("VennValidationError", { message: Schema.String, issues: Schema.Array(VennValidationIssue) }) {
	static fromIssues(issues: readonly VennValidationIssue[]): VennValidationError {
		return VennValidationError.make({
			issues,
			message: Option.match(Arr.head(issues), {
				onNone: () => "Venn diagram failed semantic validation.",
				onSome: (issue) => issue.message,
			}),
		});
	}
}
export function validateVennDiagram(
	diagram: VennDiagram,
): Result.Result<VennDiagram, VennValidationError> {
	const issues = getVennValidationIssues(diagram);
	return issues.length > 0
		? Result.fail(VennValidationError.fromIssues(issues))
		: Result.succeed(diagram);
}
export function parseVennDiagram(
	input: unknown,
): Result.Result<VennDiagram, Schema.SchemaError | VennValidationError> {
	return Result.flatMap(
		Schema.decodeUnknownResult(VennDiagram, { errors: "all" })(input),
		validateVennDiagram,
	);
}
const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Arr.isArray(value);
/**
 * Read the ways people write a Venn diagram into the canonical shape: a set
 * without an id takes its label, regions may name sets by label, a lone set
 * name stands for a list of one, and `members` reads as `items`. A set may
 * instead list its whole membership as `items`: each item then sits in the
 * region of exactly the sets that list it.
 */
export function resolveVennShorthand(input: unknown): unknown {
	if (!isRecord(input) || !Arr.isArray(input["sets"])) return input;
	const memberships = new Map<
		string,
		{
			text: string;
			sets: unknown[];
		}
	>();
	const sets = Arr.map(input["sets"], (set) => {
		if (typeof set === "string") return { id: set, label: set };
		if (!isRecord(set)) return set;
		const { items, members, name, ...rest } = set;
		const label = rest["label"] ?? name;
		const id = rest["id"] ?? label;
		const listed = items ?? members;
		if (Arr.isArray(listed))
			for (const item of listed) {
				if (typeof item !== "string" || Str.trim(item) === "") continue;
				const key = sameText(item);
				const entry = memberships.get(key) ?? { text: Str.trim(item), sets: [] };
				if (!entry.sets.includes(id)) entry.sets.push(id);
				memberships.set(key, entry);
			}
		return {
			...rest,
			...(id === undefined ? {} : { id }),
			...(label === undefined ? {} : { label }),
		};
	});
	const byLabel = new Map(
		Arr.flatMap(sets, (set) =>
			isRecord(set) && typeof set["label"] === "string"
				? [[sameText(set["label"]), set["id"]]]
				: [],
		),
	);
	const byId = new Set(Arr.flatMap(sets, (set) => (isRecord(set) ? [set["id"]] : [])));
	const setRef = (ref: unknown) =>
		typeof ref === "string" && !byId.has(ref) ? (byLabel.get(sameText(ref)) ?? ref) : ref;
	const stated = input["regions"];
	// A lone region object reads as a list of one; any other non-list is left for the schema to reject.
	if (stated !== undefined && !Arr.isArray(stated) && !isRecord(stated)) return { ...input, sets };
	const listed = Arr.isArray(stated) ? stated : isRecord(stated) ? [stated] : [];
	const regions: unknown[] = Arr.map(listed, (region) => {
		if (!isRecord(region)) return region;
		const { members, in: within, ...rest } = region;
		const raw = rest["sets"] ?? within;
		const refs = typeof raw === "string" ? [raw] : raw;
		return {
			...rest,
			...(refs === undefined ? {} : { sets: Arr.isArray(refs) ? Arr.map(refs, setRef) : refs }),
			...(rest["items"] === undefined && members !== undefined ? { items: members } : {}),
		};
	});
	// Whole memberships add each item to the region of exactly the sets listing it.
	const derived = new Map<
		string,
		{
			sets: unknown[];
			items: string[];
		}
	>();
	for (const { text, sets: within } of memberships.values()) {
		const key = Arr.join(Arr.map(within, String).sort(), "\u0000");
		const region = derived.get(key) ?? { sets: within, items: [] };
		region.items.push(text);
		derived.set(key, region);
	}
	for (const { sets: within, items } of derived.values()) {
		const same = Option.getOrUndefined(
			Arr.findFirst(
				regions,
				(region) =>
					isRecord(region) &&
					Arr.isArray(region["sets"]) &&
					region["sets"].length === within.length &&
					Arr.every(within, (id) => (region["sets"] as unknown[]).includes(id)),
			),
		);
		if (isRecord(same) && same["count"] === undefined) {
			const existing = Arr.isArray(same["items"]) ? same["items"] : [];
			const known = new Set(
				Arr.map(existing, (item) => (typeof item === "string" ? sameText(item) : item)),
			);
			same["items"] = [...existing, ...Arr.filter(items, (item) => !known.has(sameText(item)))];
		} else if (same === undefined) regions.push({ sets: within, items });
	}
	return {
		...input,
		sets,
		...(stated === undefined && regions.length === 0 ? {} : { regions }),
	};
}
export const vennFixture = parseVennDiagram({
	id: "product-team-skills",
	title: "Product team skills",
	type: vennDiagramType,
	sets: [
		{ id: "design", label: "Design" },
		{ id: "engineering", label: "Engineering" },
		{ id: "product", label: "Product" },
	],
	regions: [
		{ sets: ["design"], items: ["Visual design", "Prototyping"] },
		{ sets: ["engineering"], items: ["System design", "Code review"] },
		{ sets: ["product"], items: ["Roadmapping", "Pricing"] },
		{ sets: ["design", "engineering"], items: ["Design systems"] },
		{ sets: ["design", "product"], items: ["User research"] },
		{ sets: ["engineering", "product"], items: ["Technical specs"] },
		{ sets: ["design", "engineering", "product"], label: "Shared", items: ["Customer empathy"] },
	],
}).pipe(Result.getOrThrow);

/** Counts and domain nouns shown by generation consumers. */
export function counts(diagram: VennDiagram) {
	return {
		nodeCount: diagram.sets.length,
		nodeNoun: "sets",
		edgeCount: Arr.reduce(
			diagram.regions,
			0,
			(count, region) => count + (region.items?.length ?? 0),
		),
		edgeNoun: "items",
	};
}
