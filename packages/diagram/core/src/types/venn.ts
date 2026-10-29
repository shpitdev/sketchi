import { Effect, Schema } from "effect";

import { DiagramStyle, DiagramValidationError, SKETCHI_DIAGRAM_STYLE } from "../intermediate.js";

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
export const VENN_COLOR_NAMES = Object.keys(VENN_COLORS) as VennColorName[];
const VENN_DEFAULT_COLORS: readonly VennColorName[] = ["blue", "orange", "green"];
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/u;

/** One set: a circle with its label outside it. */
export class VennSet extends Schema.Class<VennSet>("VennSet")({
	id: Schema.NonEmptyString,
	label: Schema.NonEmptyString,
	/** A palette name (blue, orange, green, yellow, pink, violet, red, gray) or a #rrggbb hex. */
	color: Schema.optionalKey(Schema.NonEmptyString),
}) {}
export const VennSetSchema = VennSet;

/**
 * One region: the items in every listed set and in no other. `["a"]` is only
 * in a, `["a", "b"]` in a and b but not c. A region holds items or a count.
 */
export class VennRegion extends Schema.Class<VennRegion>("VennRegion")({
	sets: Schema.Array(Schema.NonEmptyString).pipe(
		Schema.mutable,
		Schema.check(Schema.isMinLength(1)),
	),
	/** A name for the overlap itself, drawn above its items. */
	label: Schema.optionalKey(Schema.NonEmptyString),
	items: Schema.optionalKey(Schema.Array(Schema.NonEmptyString).pipe(Schema.mutable)),
	count: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
}) {}
export const VennRegionSchema = VennRegion;

/**
 * The canonical Venn diagram: two or three sets and what sits in each of
 * their regions. The renderer owns every position and size. Every surface
 * that accepts, generates, renders or evaluates a Venn diagram uses this shape.
 */
export class VennDiagram extends Schema.Class<VennDiagram>("VennDiagram")({
	id: Schema.NonEmptyString,
	title: Schema.NonEmptyString,
	type: Schema.Literal(vennDiagramType),
	sets: Schema.Array(VennSet).pipe(Schema.mutable, Schema.check(Schema.isMinLength(1))),
	regions: Schema.Array(VennRegion).pipe(
		Schema.mutable,
		Schema.withDecodingDefault(Effect.succeed([])),
	),
	style: DiagramStyle.pipe(
		Schema.withDecodingDefault(Effect.succeed({ ...SKETCHI_DIAGRAM_STYLE })),
	),
}) {}
export const VennDiagramSchema = VennDiagram;

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

export class VennValidationIssue extends Schema.Class<VennValidationIssue>("VennValidationIssue")({
	code: VennValidationIssueCodeSchema,
	/** Dotted path into the diagram, for example `regions.[2].sets`. */
	path: Schema.NonEmptyString,
	message: Schema.NonEmptyString,
	hint: Schema.NonEmptyString,
}) {}

const sameText = (text: string) => text.trim().toLowerCase();
/** A palette name, read from the palette's own keys so inherited ones ("constructor") never match. */
const isPaletteName = (color: string): color is VennColorName => Object.hasOwn(VENN_COLORS, color);

/** A set's color as hex: its own, or the next default in order. */
export function vennSetColor(set: Pick<VennSet, "color">, index: number): string {
	const color = set.color?.trim();
	if (color && HEX_COLOR.test(color)) return color.toLowerCase();
	const key = color?.toLowerCase();
	const named = key && isPaletteName(key) ? VENN_COLORS[key] : undefined;
	return named ?? VENN_COLORS[VENN_DEFAULT_COLORS[index] ?? "violet"];
}

/** A region's sets in set order, so `["b", "a"]` and `["a", "b"]` are one region. */
export function vennRegionKey(
	diagram: Pick<VennDiagram, "sets">,
	region: Pick<VennRegion, "sets">,
): number[] {
	const order = new Map(diagram.sets.map((set, index) => [set.id, index]));
	return [...new Set(region.sets.flatMap((id) => order.get(id) ?? []))].sort((a, b) => a - b);
}

export function getVennValidationIssues(diagram: VennDiagram): VennValidationIssue[] {
	const issues: VennValidationIssue[] = [];
	const push = (code: VennValidationIssueCode, path: string, message: string, hint: string) =>
		issues.push(new VennValidationIssue({ code, path, message, hint }));
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
	sets.forEach((set, index) => {
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
		if (set.label.trim().length > VENN_MAX_LABEL_LENGTH)
			push(
				"venn_text_too_long",
				`${path}.label`,
				`The label of set "${set.id}" is longer than ${VENN_MAX_LABEL_LENGTH} characters.`,
				`Shorten the label to at most ${VENN_MAX_LABEL_LENGTH} characters.`,
			);
		const color = set.color?.trim();
		if (color !== undefined && !HEX_COLOR.test(color) && !isPaletteName(color.toLowerCase()))
			push(
				"invalid_venn_color",
				`${path}.color`,
				`Set "${set.id}" has an unknown color "${set.color}".`,
				`Use one of ${VENN_COLOR_NAMES.join(", ")} or a #rrggbb hex, or omit color.`,
			);
	});
	const seenRegions = new Map<string, number>();
	let total = 0;
	regions.forEach((region, index) => {
		const path = `regions.[${index}]`;
		const unknown = region.sets.filter((id) => !ids.has(id));
		for (const id of unknown)
			push(
				"unknown_venn_set",
				`${path}.sets`,
				`Region ${index + 1} names set "${id}", which is not in sets.`,
				`Key each region by set ids: ${sets.map((set) => set.id).join(", ")}.`,
			);
		if (new Set(region.sets).size !== region.sets.length)
			push(
				"invalid_venn_region",
				`${path}.sets`,
				`Region ${index + 1} lists a set more than once.`,
				"List each set of a region once.",
			);
		if (unknown.length === 0) {
			const key = vennRegionKey(diagram, region).join("+");
			const first = seenRegions.get(key);
			if (first !== undefined)
				push(
					"duplicate_venn_region",
					`${path}.sets`,
					`Regions ${first + 1} and ${index + 1} are the same overlap (${region.sets.join(" & ")}).`,
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
		items.forEach((item, itemIndex) => {
			if (item.trim().length > VENN_MAX_ITEM_LENGTH)
				push(
					"venn_text_too_long",
					`${path}.items.[${itemIndex}]`,
					`Item "${item.slice(0, 24)}…" is longer than ${VENN_MAX_ITEM_LENGTH} characters.`,
					`Shorten each item to a phrase of at most ${VENN_MAX_ITEM_LENGTH} characters.`,
				);
		});
		if (region.label !== undefined && region.label.trim().length > VENN_MAX_LABEL_LENGTH)
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
	return issues.slice(0, VENN_MAX_ISSUES);
}

export class VennValidationError extends DiagramValidationError {
	constructor(readonly issues: readonly VennValidationIssue[]) {
		super(issues[0]?.message ?? "Venn diagram failed semantic validation.");
		this.name = "VennValidationError";
	}
}

export function validateVennDiagram(diagram: VennDiagram): VennDiagram {
	const issues = getVennValidationIssues(diagram);
	if (issues.length > 0) throw new VennValidationError(issues);
	return diagram;
}

export function parseVennDiagram(input: unknown): VennDiagram {
	return validateVennDiagram(Schema.decodeUnknownSync(VennDiagram, { errors: "all" })(input));
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Read the ways people write a Venn diagram into the canonical shape: a set
 * without an id takes its label, regions may name sets by label, a lone set
 * name stands for a list of one, and `members` reads as `items`. A set may
 * instead list its whole membership as `items`: each item then sits in the
 * region of exactly the sets that list it.
 */
export function resolveVennShorthand(input: unknown): unknown {
	if (!isRecord(input) || !Array.isArray(input["sets"])) return input;
	const memberships = new Map<string, { text: string; sets: unknown[] }>();
	const sets = input["sets"].map((set) => {
		if (typeof set === "string") return { id: set, label: set };
		if (!isRecord(set)) return set;
		const { items, members, name, ...rest } = set;
		const label = rest["label"] ?? name;
		const id = rest["id"] ?? label;
		const listed = items ?? members;
		if (Array.isArray(listed))
			for (const item of listed) {
				if (typeof item !== "string" || item.trim() === "") continue;
				const key = sameText(item);
				const entry = memberships.get(key) ?? { text: item.trim(), sets: [] };
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
		sets.flatMap((set) =>
			isRecord(set) && typeof set["label"] === "string"
				? [[sameText(set["label"]), set["id"]]]
				: [],
		),
	);
	const byId = new Set(sets.flatMap((set) => (isRecord(set) ? [set["id"]] : [])));
	const setRef = (ref: unknown) =>
		typeof ref === "string" && !byId.has(ref) ? (byLabel.get(sameText(ref)) ?? ref) : ref;
	const stated = input["regions"];
	// A lone region object reads as a list of one; any other non-list is left for the schema to reject.
	if (stated !== undefined && !Array.isArray(stated) && !isRecord(stated))
		return { ...input, sets };
	const listed = Array.isArray(stated) ? stated : isRecord(stated) ? [stated] : [];
	const regions: unknown[] = listed.map((region) => {
		if (!isRecord(region)) return region;
		const { members, in: within, ...rest } = region;
		const raw = rest["sets"] ?? within;
		const refs = typeof raw === "string" ? [raw] : raw;
		return {
			...rest,
			...(refs === undefined ? {} : { sets: Array.isArray(refs) ? refs.map(setRef) : refs }),
			...(rest["items"] === undefined && members !== undefined ? { items: members } : {}),
		};
	});
	// Whole memberships add each item to the region of exactly the sets listing it.
	const derived = new Map<string, { sets: unknown[]; items: string[] }>();
	for (const { text, sets: within } of memberships.values()) {
		const key = within.map(String).sort().join("\u0000");
		const region = derived.get(key) ?? { sets: within, items: [] };
		region.items.push(text);
		derived.set(key, region);
	}
	for (const { sets: within, items } of derived.values()) {
		const same = regions.find(
			(region) =>
				isRecord(region) &&
				Array.isArray(region["sets"]) &&
				region["sets"].length === within.length &&
				within.every((id) => (region["sets"] as unknown[]).includes(id)),
		);
		if (isRecord(same) && same["count"] === undefined) {
			const existing = Array.isArray(same["items"]) ? (same["items"] as unknown[]) : [];
			const known = new Set(
				existing.map((item) => (typeof item === "string" ? sameText(item) : item)),
			);
			same["items"] = [...existing, ...items.filter((item) => !known.has(sameText(item)))];
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
});
