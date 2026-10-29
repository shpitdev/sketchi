import { Effect, Schema } from "effect";

import { DiagramStyle, DiagramValidationError, SKETCHI_DIAGRAM_STYLE } from "../intermediate.js";

export const wireframeDiagramType = "wireframe" as const;

/** Each device sets its screen's width and least height. */
export const WIREFRAME_DEVICES = ["desktop", "tablet", "mobile"] as const;
export type WireframeDevice = (typeof WIREFRAME_DEVICES)[number];

/** Components that hold other components. */
export const WIREFRAME_CONTAINER_TYPES = [
	"header",
	"footer",
	"sidebar",
	"main",
	"section",
	"card",
	"modal",
	"row",
	"column",
	"grid",
] as const;

/** Components drawn from their own fields; none holds children. */
export const WIREFRAME_WIDGET_TYPES = [
	"heading",
	"text",
	"link",
	"badge",
	"button",
	"input",
	"textarea",
	"select",
	"checkbox",
	"radio",
	"toggle",
	"search",
	"tabs",
	"nav",
	"breadcrumbs",
	"avatar",
	"icon",
	"image",
	"chart",
	"table",
	"list",
	"divider",
] as const;

export const WIREFRAME_COMPONENT_TYPES = [
	...WIREFRAME_CONTAINER_TYPES,
	...WIREFRAME_WIDGET_TYPES,
] as const;
export type WireframeContainerType = (typeof WIREFRAME_CONTAINER_TYPES)[number];
export type WireframeWidgetType = (typeof WIREFRAME_WIDGET_TYPES)[number];
export type WireframeComponentType = (typeof WIREFRAME_COMPONENT_TYPES)[number];

export const WIREFRAME_ALIGNMENTS = ["start", "center", "end", "between"] as const;
export type WireframeAlignment = (typeof WIREFRAME_ALIGNMENTS)[number];
export const WIREFRAME_CHART_KINDS = ["bar", "line", "pie"] as const;
export const WIREFRAME_IMAGE_ASPECTS = ["wide", "square", "tall"] as const;

/** More screens stop reading as one sheet; draw each flow on its own. */
export const WIREFRAME_MAX_SCREENS = 6;
export const WIREFRAME_MAX_COMPONENTS = 160;
/** Containers nested deeper than this leave no room for their content. */
export const WIREFRAME_MAX_DEPTH = 8;
/** Items of one list, tab bar, menu or trail. */
export const WIREFRAME_MAX_ITEMS = 12;
export const WIREFRAME_MAX_TABLE_COLUMNS = 8;
/** Placeholder rows of a table and lines of a paragraph or text area. */
export const WIREFRAME_MAX_ROWS = 8;
export const WIREFRAME_MAX_GRID_COLUMNS = 6;
export const WIREFRAME_MAX_LABEL_LENGTH = 60;
export const WIREFRAME_MAX_HEADING_LENGTH = 80;
export const WIREFRAME_MAX_TEXT_LENGTH = 280;
/** What one scene may draw; each component's share is bounded by wireframeElementEstimate. */
export const WIREFRAME_MAX_ELEMENTS = 560;
export const WIREFRAME_MAX_ISSUES = 20;

/**
 * One component of a screen. A container (header, footer, sidebar, main,
 * section, card, modal, row, column, grid) holds `children`; a widget draws
 * from its own fields. `text` is what a heading, paragraph, link, badge or
 * button says; `label` names a form control or the placeholder (avatar, icon,
 * image, chart) it depicts; `title` heads a container. No field takes a
 * coordinate or a size: the renderer places everything.
 */
export interface WireframeComponent {
	readonly type: WireframeComponentType;
	readonly text?: string;
	readonly label?: string;
	readonly title?: string;
	/** Hint text inside an empty input, text area, select or search bar. */
	readonly placeholder?: string;
	/** What an input, text area, select or search bar shows filled in. */
	readonly value?: string;
	/** Heading level: 1 is the page title. */
	readonly level?: number;
	/** Placeholder lines of a paragraph drawn without text. */
	readonly lines?: number;
	/** A primary button carries the screen's main action in the accent color. */
	readonly variant?: "primary" | "secondary";
	/** A checkbox, radio or toggle that is on. */
	readonly checked?: boolean;
	readonly disabled?: boolean;
	/** Tabs, nav items, breadcrumbs or list items, in order. */
	readonly items?: readonly string[];
	/** The selected tab or nav item: one of `items`. */
	readonly active?: string;
	/** A grid's column count, or a table's column headers. */
	readonly columns?: number | readonly string[];
	/** Placeholder rows of a table, or lines of a text area. */
	readonly rows?: number;
	/** What a chart placeholder sketches. */
	readonly kind?: (typeof WIREFRAME_CHART_KINDS)[number];
	/** An image placeholder's shape: wide (16:9, the default), square or tall (3:4). */
	readonly aspect?: (typeof WIREFRAME_IMAGE_ASPECTS)[number];
	/** The side of the screen a sidebar sits on. */
	readonly side?: "left" | "right";
	/**
	 * Where a container's children sit: across a row (start, center, end, or
	 * between, which spreads them to both ends) or within a column (start
	 * stretches fields to the full width; center and end keep them at their own).
	 */
	readonly align?: WireframeAlignment;
	readonly children?: readonly WireframeComponent[];
}

const WireframeComponentReference: Schema.Codec<WireframeComponent> = Schema.suspend(
	(): Schema.Codec<WireframeComponent> => WireframeComponentSchema,
);

export const WireframeComponentSchema: Schema.Codec<WireframeComponent> = Schema.Struct({
	type: Schema.Literals(WIREFRAME_COMPONENT_TYPES),
	text: Schema.optionalKey(Schema.NonEmptyString),
	label: Schema.optionalKey(Schema.NonEmptyString),
	title: Schema.optionalKey(Schema.NonEmptyString),
	placeholder: Schema.optionalKey(Schema.NonEmptyString),
	value: Schema.optionalKey(Schema.NonEmptyString),
	level: Schema.optionalKey(Schema.Int),
	lines: Schema.optionalKey(Schema.Int),
	variant: Schema.optionalKey(Schema.Literals(["primary", "secondary"])),
	checked: Schema.optionalKey(Schema.Boolean),
	disabled: Schema.optionalKey(Schema.Boolean),
	items: Schema.optionalKey(Schema.Array(Schema.NonEmptyString)),
	active: Schema.optionalKey(Schema.NonEmptyString),
	columns: Schema.optionalKey(Schema.Union([Schema.Int, Schema.Array(Schema.NonEmptyString)])),
	rows: Schema.optionalKey(Schema.Int),
	kind: Schema.optionalKey(Schema.Literals(WIREFRAME_CHART_KINDS)),
	aspect: Schema.optionalKey(Schema.Literals(WIREFRAME_IMAGE_ASPECTS)),
	side: Schema.optionalKey(Schema.Literals(["left", "right"])),
	align: Schema.optionalKey(Schema.Literals(WIREFRAME_ALIGNMENTS)),
	children: Schema.optionalKey(Schema.Array(WireframeComponentReference)),
});

/**
 * One screen, drawn as a frame the size of its device. Its header spans the
 * top, its footer the bottom, a sidebar one side between them, a modal floats
 * over the rest, and every other component stacks down the content area.
 */
export class WireframeScreen extends Schema.Class<WireframeScreen>("WireframeScreen")({
	id: Schema.NonEmptyString,
	name: Schema.NonEmptyString,
	device: Schema.Literals(WIREFRAME_DEVICES).pipe(
		Schema.withDecodingDefault(Effect.succeed("desktop" as const)),
	),
	/** Where the content area's children sit, as a column's align does. */
	align: Schema.optionalKey(Schema.Literals(WIREFRAME_ALIGNMENTS)),
	children: Schema.Array(WireframeComponentReference).pipe(Schema.mutable),
}) {}
export const WireframeScreenSchema = WireframeScreen;

/**
 * The canonical wireframe: low-fidelity screens, each a tree of components.
 * The renderer owns every coordinate. Every surface that accepts, generates,
 * renders or evaluates a wireframe uses this shape.
 */
export class WireframeDiagram extends Schema.Class<WireframeDiagram>("WireframeDiagram")({
	id: Schema.NonEmptyString,
	title: Schema.NonEmptyString,
	type: Schema.Literal(wireframeDiagramType),
	screens: Schema.Array(WireframeScreen).pipe(Schema.mutable, Schema.check(Schema.isMinLength(1))),
	style: DiagramStyle.pipe(
		Schema.withDecodingDefault(Effect.succeed({ ...SKETCHI_DIAGRAM_STYLE })),
	),
}) {}
export const WireframeDiagramSchema = WireframeDiagram;

export const WireframeValidationIssueCodeSchema = Schema.Literals([
	"wireframe_too_large",
	"invalid_screen_id",
	"duplicate_screen_id",
	"empty_wireframe_screen",
	"empty_wireframe_container",
	"missing_wireframe_text",
	"wireframe_text_too_long",
	"invalid_wireframe_option",
]);
export type WireframeValidationIssueCode = typeof WireframeValidationIssueCodeSchema.Type;

export class WireframeValidationIssue extends Schema.Class<WireframeValidationIssue>(
	"WireframeValidationIssue",
)({
	code: WireframeValidationIssueCodeSchema,
	/** Dotted path into the diagram, for example `screens.[0].children.[2].text`. */
	path: Schema.NonEmptyString,
	message: Schema.NonEmptyString,
	hint: Schema.NonEmptyString,
}) {}

const CONTAINERS: ReadonlySet<string> = new Set(WIREFRAME_CONTAINER_TYPES);

export function isWireframeContainer(component: Pick<WireframeComponent, "type">): boolean {
	return CONTAINERS.has(component.type);
}

/** Widgets whose words are `text`. */
const TEXT_TYPES: ReadonlySet<string> = new Set(["heading", "text", "link", "badge", "button"]);
/** Widgets named by `label`. */
const LABEL_TYPES: ReadonlySet<string> = new Set([
	"input",
	"textarea",
	"select",
	"checkbox",
	"radio",
	"toggle",
	"avatar",
	"icon",
	"image",
	"chart",
]);
const ITEM_TYPES: ReadonlySet<string> = new Set(["tabs", "nav", "breadcrumbs", "list"]);
const PLACEHOLDER_TYPES: ReadonlySet<string> = new Set(["input", "textarea", "select", "search"]);
const CHECKED_TYPES: ReadonlySet<string> = new Set(["checkbox", "radio", "toggle"]);
const DISABLED_TYPES: ReadonlySet<string> = new Set([
	"button",
	"input",
	"textarea",
	"select",
	"checkbox",
	"radio",
	"toggle",
	"search",
	"link",
]);

/** Which components each optional field applies to. */
const OPTION_TYPES: Readonly<Record<string, ReadonlySet<string>>> = {
	text: TEXT_TYPES,
	label: LABEL_TYPES,
	title: CONTAINERS,
	placeholder: PLACEHOLDER_TYPES,
	value: PLACEHOLDER_TYPES,
	level: new Set(["heading"]),
	lines: new Set(["text"]),
	variant: new Set(["button"]),
	checked: CHECKED_TYPES,
	disabled: DISABLED_TYPES,
	items: ITEM_TYPES,
	active: new Set(["tabs", "nav"]),
	columns: new Set(["grid", "table"]),
	rows: new Set(["table", "textarea"]),
	kind: new Set(["chart"]),
	aspect: new Set(["image"]),
	side: new Set(["sidebar"]),
	align: CONTAINERS,
	children: CONTAINERS,
};

/** Where a misplaced field belongs, for its repair hint. */
const OPTION_HINTS: Readonly<Record<string, string>> = {
	text: "Put a form control's or placeholder's name in label, and a container's in title.",
	label:
		"Put a heading's, paragraph's, link's, badge's or button's words in text, and a container's name in title.",
	title: "Only containers take a title; put a widget's words in text or label.",
	children:
		"Only containers (header, footer, sidebar, main, section, card, modal, row, column, grid) hold children.",
	columns: "columns is a grid's column count or a table's column headers.",
	rows: "rows is a table's placeholder row count or a text area's line count.",
	items:
		"items lists tabs, nav items, breadcrumbs or list items; a select shows its value, and each radio has its own label.",
	value: "value is what an input, text area, select or search bar shows filled in.",
};

/** Each component in depth-first order with its path, depth and screen index. */
export function* wireframeComponents(diagram: Pick<WireframeDiagram, "screens">): Generator<{
	readonly component: WireframeComponent;
	readonly path: string;
	readonly depth: number;
	readonly screen: number;
	readonly parent: WireframeComponent | undefined;
}> {
	function* visit(
		components: readonly WireframeComponent[],
		prefix: string,
		depth: number,
		screen: number,
		parent: WireframeComponent | undefined,
	): Generator<{
		readonly component: WireframeComponent;
		readonly path: string;
		readonly depth: number;
		readonly screen: number;
		readonly parent: WireframeComponent | undefined;
	}> {
		for (const [index, component] of components.entries()) {
			const path = `${prefix}.children.[${index}]`;
			yield { component, path, depth, screen, parent };
			if (component.children) yield* visit(component.children, path, depth + 1, screen, component);
		}
	}
	for (const [index, screen] of diagram.screens.entries())
		yield* visit(screen.children, `screens.[${index}]`, 1, index, undefined);
}

/** The words a component shows, for checks that read a wireframe back. */
export function wireframeComponentWords(component: WireframeComponent): string[] {
	return [
		component.text,
		component.label,
		component.title,
		component.placeholder,
		component.value,
		...(component.items ?? []),
		...(Array.isArray(component.columns) ? component.columns : []),
	].filter((value): value is string => value !== undefined);
}

/** Placeholder rows a table draws when it states none. */
export const WIREFRAME_DEFAULT_TABLE_ROWS = 4;
/** Placeholder lines a paragraph without text draws when it states none. */
export const WIREFRAME_DEFAULT_TEXT_LINES = 3;

/**
 * An upper bound on the scene elements one component draws by itself, not
 * counting its children. The renderer never draws more, so a wireframe within
 * WIREFRAME_MAX_ELEMENTS always fits a scene.
 */
export function wireframeElementEstimate(component: WireframeComponent): number {
	const items = component.items?.length ?? 0;
	switch (component.type) {
		case "table": {
			const columns = Array.isArray(component.columns) ? component.columns.length : 1;
			const rows = component.rows ?? WIREFRAME_DEFAULT_TABLE_ROWS;
			// A table too narrow for its columns repeats each header beside its row's value.
			return 2 + columns + rows * (2 * columns + 1);
		}
		case "tabs":
			return 2 * items + 2;
		case "nav":
			return items + 2;
		case "list":
			return 2 * items + 2;
		case "text":
			return component.text ? 1 : (component.lines ?? WIREFRAME_DEFAULT_TEXT_LINES);
		case "chart":
			return 12;
		case "image":
			return 6;
		case "modal":
		case "select":
			return 5;
		case "input":
		case "textarea":
		case "search":
		case "checkbox":
		case "radio":
		case "toggle":
		case "card":
			return 4;
		default:
			return 3;
	}
}

export function getWireframeValidationIssues(
	diagram: WireframeDiagram,
): WireframeValidationIssue[] {
	const issues: WireframeValidationIssue[] = [];
	const push = (code: WireframeValidationIssueCode, path: string, message: string, hint: string) =>
		issues.push({ code, path, message, hint });
	const { screens } = diagram;
	if (screens.length > WIREFRAME_MAX_SCREENS)
		push(
			"wireframe_too_large",
			"screens",
			`A wireframe holds at most ${WIREFRAME_MAX_SCREENS} screens; this one has ${screens.length}.`,
			"Draw each flow as its own wireframe, or keep the screens the request names.",
		);
	const ids = new Set<string>();
	screens.forEach((screen, index) => {
		const path = `screens.[${index}]`;
		if (screen.id.includes(":"))
			push(
				"invalid_screen_id",
				`${path}.id`,
				`Screen id "${screen.id}" contains a colon.`,
				"Use a short id without colons, such as login or checkout.",
			);
		if (ids.has(screen.id))
			push(
				"duplicate_screen_id",
				`${path}.id`,
				`Screen id "${screen.id}" is used more than once.`,
				"Give each screen a unique id.",
			);
		ids.add(screen.id);
		if (screen.name.trim().length > WIREFRAME_MAX_LABEL_LENGTH)
			push(
				"wireframe_text_too_long",
				`${path}.name`,
				`The name of screen "${screen.id}" is longer than ${WIREFRAME_MAX_LABEL_LENGTH} characters.`,
				`Shorten the name to at most ${WIREFRAME_MAX_LABEL_LENGTH} characters.`,
			);
		if (screen.children.length === 0)
			push(
				"empty_wireframe_screen",
				`${path}.children`,
				`Screen "${screen.id}" has no components.`,
				"Give each screen the components the request describes.",
			);
		if (screen.align === "between")
			push(
				"invalid_wireframe_option",
				`${path}.align`,
				`Screen "${screen.id}" sets align "between", which only spreads a row.`,
				'A screen\'s content stacks down; use align "start", "center" or "end".',
			);
	});
	let count = 0;
	let elements = screens.length;
	let deepest = 0;
	for (const { component, path, depth } of wireframeComponents(diagram)) {
		count += 1;
		elements += wireframeElementEstimate(component);
		deepest = Math.max(deepest, depth);
		validateComponent(component, path, push);
	}
	if (count > WIREFRAME_MAX_COMPONENTS)
		push(
			"wireframe_too_large",
			"screens",
			`A wireframe holds at most ${WIREFRAME_MAX_COMPONENTS} components; this one has ${count}.`,
			"Keep the components the request names, or split the screens into separate wireframes.",
		);
	else if (elements > WIREFRAME_MAX_ELEMENTS)
		push(
			"wireframe_too_large",
			"screens",
			"This wireframe draws more than one scene holds.",
			"Use fewer table rows and columns, list items or screens.",
		);
	if (deepest > WIREFRAME_MAX_DEPTH)
		push(
			"wireframe_too_large",
			"screens",
			`Components nest ${deepest} levels deep; a wireframe draws at most ${WIREFRAME_MAX_DEPTH}.`,
			"Drop wrapper rows and columns that hold a single child.",
		);
	return issues.slice(0, WIREFRAME_MAX_ISSUES);
}

function validateComponent(
	component: WireframeComponent,
	path: string,
	push: (code: WireframeValidationIssueCode, path: string, message: string, hint: string) => void,
): void {
	const { type } = component;
	const name = `The ${type} at ${path}`;
	for (const [field, types] of Object.entries(OPTION_TYPES))
		if (component[field as keyof WireframeComponent] !== undefined && !types.has(type))
			push(
				"invalid_wireframe_option",
				`${path}.${field}`,
				`A ${type} takes no ${field}.`,
				OPTION_HINTS[field] ?? `Remove ${field}; it applies only to ${[...types].join(", ")}.`,
			);
	const long = (field: "text" | "label" | "title" | "placeholder" | "value", limit: number) => {
		const value = component[field];
		if (value !== undefined && value.trim().length > limit)
			push(
				"wireframe_text_too_long",
				`${path}.${field}`,
				`${name} has a ${field} longer than ${limit} characters.`,
				`Shorten the ${field} to at most ${limit} characters.`,
			);
	};
	long(
		"text",
		type === "text"
			? WIREFRAME_MAX_TEXT_LENGTH
			: type === "heading"
				? WIREFRAME_MAX_HEADING_LENGTH
				: WIREFRAME_MAX_LABEL_LENGTH,
	);
	long("label", WIREFRAME_MAX_LABEL_LENGTH);
	long("title", WIREFRAME_MAX_LABEL_LENGTH);
	long("placeholder", WIREFRAME_MAX_LABEL_LENGTH);
	long("value", WIREFRAME_MAX_LABEL_LENGTH);
	const required = (field: "text" | "label", what: string) => {
		if (component[field] === undefined)
			push(
				"missing_wireframe_text",
				`${path}.${field}`,
				`${name} has no ${field}.`,
				`Give the ${type} ${what} as ${field}.`,
			);
	};
	if (type === "heading" || type === "link" || type === "badge" || type === "button")
		required("text", "the words it shows");
	if (CHECKED_TYPES.has(type)) required("label", "the option it sets");
	const items = component.items;
	if (
		(type === "tabs" || type === "nav" || type === "breadcrumbs" || type === "list") &&
		(items === undefined || items.length === 0)
	)
		push(
			"missing_wireframe_text",
			`${path}.items`,
			`${name} has no items.`,
			`List the ${type === "list" ? "items" : type === "breadcrumbs" ? "pages of the trail" : type} it shows as items.`,
		);
	if (items !== undefined) {
		if (items.length > WIREFRAME_MAX_ITEMS)
			push(
				"wireframe_too_large",
				`${path}.items`,
				`${name} lists ${items.length} items; at most ${WIREFRAME_MAX_ITEMS} read at once.`,
				`Keep at most ${WIREFRAME_MAX_ITEMS} items.`,
			);
		items.forEach((item, index) => {
			if (item.trim().length > WIREFRAME_MAX_LABEL_LENGTH)
				push(
					"wireframe_text_too_long",
					`${path}.items.[${index}]`,
					`Item ${index + 1} of ${name.toLowerCase()} is longer than ${WIREFRAME_MAX_LABEL_LENGTH} characters.`,
					`Shorten each item to at most ${WIREFRAME_MAX_LABEL_LENGTH} characters.`,
				);
		});
	}
	if (component.active !== undefined && items !== undefined && !items.includes(component.active))
		push(
			"invalid_wireframe_option",
			`${path}.active`,
			`${name} marks "${component.active}" active, which is not one of its items.`,
			"Set active to one of items, word for word.",
		);
	if (component.level !== undefined && (component.level < 1 || component.level > 3))
		push(
			"invalid_wireframe_option",
			`${path}.level`,
			`Heading level ${component.level} is out of range.`,
			"Use level 1 for the page title, 2 for a section and 3 below that.",
		);
	const range = (field: "lines" | "rows", max: number) => {
		const value = component[field];
		if (value !== undefined && (value < 1 || value > max))
			push(
				value > max ? "wireframe_too_large" : "invalid_wireframe_option",
				`${path}.${field}`,
				`${name} asks for ${value} ${field}.`,
				`Use 1 to ${max} ${field}.`,
			);
	};
	range("lines", WIREFRAME_MAX_ROWS);
	range("rows", WIREFRAME_MAX_ROWS);
	const { columns } = component;
	if (type === "grid") {
		if (typeof columns !== "number")
			push(
				"invalid_wireframe_option",
				`${path}.columns`,
				`${name} has no column count.`,
				`Set columns to how many children sit side by side, 1 to ${WIREFRAME_MAX_GRID_COLUMNS}.`,
			);
		else if (columns < 1 || columns > WIREFRAME_MAX_GRID_COLUMNS)
			push(
				"invalid_wireframe_option",
				`${path}.columns`,
				`${name} asks for ${columns} columns.`,
				`Use 1 to ${WIREFRAME_MAX_GRID_COLUMNS} columns; more children wrap onto new rows.`,
			);
	}
	if (type === "table") {
		if (!Array.isArray(columns) || columns.length === 0)
			push(
				"missing_wireframe_text",
				`${path}.columns`,
				`${name} has no column headers.`,
				'List the table\'s column headers as columns: ["Order", "Customer", "Total"].',
			);
		else {
			if (columns.length > WIREFRAME_MAX_TABLE_COLUMNS)
				push(
					"wireframe_too_large",
					`${path}.columns`,
					`${name} has ${columns.length} columns.`,
					`Keep at most ${WIREFRAME_MAX_TABLE_COLUMNS} columns.`,
				);
			columns.forEach((header, index) => {
				if (header.trim().length > WIREFRAME_MAX_LABEL_LENGTH)
					push(
						"wireframe_text_too_long",
						`${path}.columns.[${index}]`,
						`Column ${index + 1} of ${name.toLowerCase()} has a header longer than ${WIREFRAME_MAX_LABEL_LENGTH} characters.`,
						`Shorten each header to at most ${WIREFRAME_MAX_LABEL_LENGTH} characters.`,
					);
			});
		}
	}
	if (
		(type === "row" || type === "column" || type === "grid") &&
		(component.children?.length ?? 0) === 0
	)
		push(
			"empty_wireframe_container",
			`${path}.children`,
			`${name} has no children.`,
			`A ${type} only arranges its children; give it some or remove it.`,
		);
	if (component.align === "between" && type !== "row" && type !== "header" && type !== "footer")
		push(
			"invalid_wireframe_option",
			`${path}.align`,
			`${name} sets align "between", which only spreads a row, header or footer.`,
			'Use align "start", "center" or "end" in a column.',
		);
}

export class WireframeValidationError extends DiagramValidationError {
	constructor(readonly issues: readonly WireframeValidationIssue[]) {
		super(issues[0]?.message ?? "Wireframe failed semantic validation.");
		this.name = "WireframeValidationError";
	}
}

export function validateWireframeDiagram(diagram: WireframeDiagram): WireframeDiagram {
	const issues = getWireframeValidationIssues(diagram);
	if (issues.length > 0) throw new WireframeValidationError(issues);
	return diagram;
}

export function parseWireframeDiagram(input: unknown): WireframeDiagram {
	return validateWireframeDiagram(
		Schema.decodeUnknownSync(WireframeDiagram, { errors: "all" })(input),
	);
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * The first of `keys` a record sets, removed from `rest`. An empty string or
 * null reads as unset, except where a list belongs (`list`): a null there is
 * kept for the schema to reject with its repair hint, never dropped.
 */
function take(rest: Record<string, unknown>, keys: readonly string[], list = false): unknown {
	let found: unknown;
	for (const key of keys) {
		const value = rest[key];
		if (found === undefined && value !== undefined && value !== "" && (list || value !== null))
			found = value;
		delete rest[key];
	}
	return found;
}

/** A number written where words belong is those words: a KPI of 0 reads "0". */
const words = (value: unknown) =>
	typeof value === "number" && Number.isFinite(value) ? String(value) : value;

/** An alias table's own entry for `name`; inherited names such as `constructor` are no alias. */
const alias = (table: Readonly<Record<string, string>>, name: string) =>
	Object.hasOwn(table, name) ? table[name] : undefined;

const squash = (value: string) => value.toLowerCase().replace(/[\s_-]+/gu, "");

/** Component type names models write, squashed, and the type each means. */
const TYPE_ALIASES: Readonly<Record<string, string>> = {
	h1: "heading",
	h2: "heading",
	h3: "heading",
	h4: "heading",
	title: "heading",
	headline: "heading",
	paragraph: "text",
	p: "text",
	body: "text",
	copy: "text",
	label: "text",
	caption: "text",
	description: "text",
	placeholdertext: "text",
	anchor: "link",
	hyperlink: "link",
	textlink: "link",
	tag: "badge",
	chip: "badge",
	pill: "badge",
	status: "badge",
	cta: "button",
	btn: "button",
	textinput: "input",
	textfield: "input",
	field: "input",
	inputfield: "input",
	formfield: "input",
	email: "input",
	password: "input",
	textbox: "input",
	multiline: "textarea",
	dropdown: "select",
	picker: "select",
	combobox: "select",
	check: "checkbox",
	radiobutton: "radio",
	switch: "toggle",
	searchbar: "search",
	searchbox: "search",
	searchinput: "search",
	searchfield: "search",
	tab: "tabs",
	tabbar: "tabs",
	segmented: "tabs",
	menu: "nav",
	navbar: "nav",
	navigation: "nav",
	navlinks: "nav",
	menubar: "nav",
	links: "nav",
	breadcrumb: "breadcrumbs",
	crumbs: "breadcrumbs",
	profile: "avatar",
	userpic: "avatar",
	img: "image",
	photo: "image",
	picture: "image",
	thumbnail: "image",
	media: "image",
	logo: "image",
	graph: "chart",
	barchart: "chart",
	linechart: "chart",
	piechart: "chart",
	sparkline: "chart",
	datatable: "table",
	datagrid: "table",
	ul: "list",
	ol: "list",
	bullets: "list",
	bulletlist: "list",
	hr: "divider",
	separator: "divider",
	rule: "divider",
	topbar: "header",
	appbar: "header",
	toolbar: "header",
	bottombar: "footer",
	actionbar: "footer",
	savebar: "footer",
	aside: "sidebar",
	sidenav: "sidebar",
	drawer: "sidebar",
	container: "main",
	content: "main",
	page: "main",
	dialog: "modal",
	popup: "modal",
	popover: "modal",
	panel: "card",
	tile: "card",
	box: "card",
	kpi: "card",
	stat: "card",
	metric: "card",
	stack: "column",
	vstack: "column",
	vertical: "column",
	col: "column",
	form: "column",
	fieldset: "column",
	group: "column",
	hstack: "row",
	horizontal: "row",
	buttongroup: "row",
	actions: "row",
};

const TEXT_KEYS = ["text", "label", "title", "value", "content", "name", "caption"];
const LABEL_KEYS = ["label", "text", "title", "name", "alt", "caption", "initials"];
const TITLE_KEYS = ["title", "label", "text", "heading", "name"];
const CHILDREN_KEYS = ["children", "components", "elements", "content", "body", "fields"];
const ITEM_KEYS = ["items", "options", "links", "tabs", "entries", "crumbs", "values"];

/** An item written as an object reads as its text; `active: true` marks it the active one. */
function itemText(item: unknown): unknown {
	if (!isRecord(item)) return words(item);
	// An object naming none of these stays as written, for the schema to reject.
	return words(
		item["text"] ?? item["label"] ?? item["title"] ?? item["name"] ?? item["value"] ?? item,
	);
}

function resolveComponent(input: unknown): unknown {
	if (!isRecord(input)) return input;
	const rest: Record<string, unknown> = { ...input };
	delete rest["id"];
	let raw = take(rest, ["type", "component", "widget", "element"]);
	// A chart kind written as the type is a chart of that kind.
	if (raw === undefined && typeof rest["kind"] === "string") {
		const kind = squash(rest["kind"]);
		if (!(WIREFRAME_CHART_KINDS as readonly string[]).includes(kind)) {
			raw = rest["kind"];
			delete rest["kind"];
		}
	}
	const squashed = typeof raw === "string" ? squash(raw) : undefined;
	const type =
		squashed === undefined
			? raw
			: (WIREFRAME_COMPONENT_TYPES as readonly string[]).includes(squashed)
				? squashed
				: (alias(TYPE_ALIASES, squashed) ?? raw);
	const resolved: Record<string, unknown> = { type };
	if (typeof type !== "string") return { ...rest, type };
	if (squashed !== undefined && /^h[1-4]$/u.test(squashed) && rest["level"] === undefined)
		resolved["level"] = Math.min(3, Number(squashed.slice(1)));
	if (squashed === "barchart" || squashed === "linechart" || squashed === "piechart")
		resolved["kind"] = squashed.slice(0, -"chart".length);
	if (squashed === "cta" && rest["variant"] === undefined) resolved["variant"] = "primary";
	if (squashed === "password" && rest["label"] === undefined && rest["text"] === undefined)
		resolved["label"] = "Password";
	if (squashed === "email" && rest["label"] === undefined && rest["text"] === undefined)
		resolved["label"] = "Email";
	const container = CONTAINERS.has(type);
	if (container) {
		const children = take(rest, CHILDREN_KEYS, true);
		const title = take(rest, TITLE_KEYS);
		if (title !== undefined) resolved["title"] = words(title);
		// A container's items written as components are its children.
		const items = rest["items"];
		const nested = Array.isArray(items) && items.some(isRecord) ? items : undefined;
		if (nested) delete rest["items"];
		const list = children !== undefined ? children : nested;
		if (Array.isArray(list)) resolved["children"] = list.map(resolveComponent);
		else if (list !== undefined) resolved["children"] = list;
	} else if (TEXT_TYPES.has(type)) {
		const text = take(rest, TEXT_KEYS);
		if (text !== undefined) resolved["text"] = words(text);
	} else if (LABEL_TYPES.has(type)) {
		const label = take(rest, LABEL_KEYS);
		if (label !== undefined) resolved["label"] = words(label);
	}
	if (PLACEHOLDER_TYPES.has(type)) {
		// A closed select draws only the option it shows.
		const value = take(
			rest,
			type === "select"
				? ["value", "selected", "active", "current", "defaultValue"]
				: ["value", "defaultValue"],
		);
		if (value !== undefined) resolved["value"] = words(value);
		if (type === "select") take(rest, ["items", "options", "choices"]);
		// A search bar has no label; whatever it says is its placeholder.
		const placeholder = take(
			rest,
			type === "search"
				? ["placeholder", "hint", "prompt", "text", "label"]
				: ["placeholder", "hint", "prompt"],
		);
		if (placeholder !== undefined) resolved["placeholder"] = words(placeholder);
	}
	if (ITEM_TYPES.has(type)) {
		const items = take(rest, ITEM_KEYS, true);
		if (Array.isArray(items)) {
			resolved["items"] = items.map(itemText);
			const marked = items.find(
				(item) =>
					isRecord(item) &&
					(item["active"] === true || item["selected"] === true || item["current"] === true),
			);
			if (marked !== undefined && rest["active"] === undefined)
				resolved["active"] = itemText(marked);
		} else if (items !== undefined) resolved["items"] = items;
		const active = take(rest, ["active", "selected", "current", "value", "activeTab"]);
		// An index picks its item; an index past the items, or anything else, stays for the schema to reject.
		const picked =
			typeof active === "number" && Array.isArray(resolved["items"])
				? (resolved["items"] as unknown[])[active]
				: undefined;
		if (picked !== undefined) resolved["active"] = picked;
		else if (active !== undefined) resolved["active"] = active;
	}
	if (CHECKED_TYPES.has(type)) {
		const checked = take(rest, ["checked", "selected", "on", "value", "active", "enabled"]);
		if (typeof checked === "boolean") resolved["checked"] = checked;
		else if (checked !== undefined) resolved["checked"] = checked;
	}
	if (rest["enabled"] === false && rest["disabled"] === undefined) rest["disabled"] = true;
	delete rest["enabled"];
	if (type === "button") {
		const variant = take(rest, ["variant", "style", "appearance", "kind", "emphasis"]);
		const primary = typeof rest["primary"] === "boolean" ? take(rest, ["primary"]) : undefined;
		if (typeof variant === "string") {
			const value = squash(variant);
			resolved["variant"] = ["primary", "filled", "solid", "cta", "main"].includes(value)
				? "primary"
				: ["secondary", "outline", "outlined", "ghost", "tertiary", "default", "text"].includes(
							value,
					  )
					? "secondary"
					: variant;
		} else if (variant !== undefined) resolved["variant"] = variant;
		else if (primary === true) resolved["variant"] = "primary";
	}
	if (type === "heading" && typeof rest["level"] === "string") {
		const level = Number(rest["level"].replace(/^h/iu, ""));
		rest["level"] = Number.isFinite(level) ? level : rest["level"];
	}
	if (type === "table") {
		const headers = take(rest, ["columns", "headers", "fields", "cols"], true);
		if (Array.isArray(headers)) resolved["columns"] = headers.map(itemText);
		else if (headers !== undefined) resolved["columns"] = headers;
		const rows = take(rest, ["rows", "data", "rowCount"], true);
		resolved["rows"] = Array.isArray(rows)
			? Math.max(1, Math.min(WIREFRAME_MAX_ROWS, rows.length))
			: rows;
		if (resolved["rows"] === undefined) delete resolved["rows"];
	}
	if (type === "grid") {
		const columns = take(rest, ["columns", "cols", "columnCount"], true);
		const count = typeof columns === "string" ? Number(columns) : columns;
		if (columns !== undefined) resolved["columns"] = Number.isInteger(count) ? count : columns;
	}
	if (type === "chart") {
		const kind = take(rest, ["kind", "chartType", "variant"]);
		if (typeof kind === "string") {
			const value = squash(kind).replace(/chart$/u, "");
			resolved["kind"] = value === "donut" ? "pie" : value === "area" ? "line" : value;
		} else if (kind !== undefined) resolved["kind"] = kind;
	}
	if (type === "sidebar") {
		const side = take(rest, ["side", "position", "placement"]);
		if (side !== undefined) resolved["side"] = side;
	}
	if (container) {
		const align = take(rest, ["align", "justify", "alignment"]);
		if (typeof align === "string") {
			const value = squash(align);
			resolved["align"] =
				value === "left" || value === "top" || value === "flexstart"
					? "start"
					: value === "right" || value === "bottom" || value === "flexend"
						? "end"
						: value === "middle" || value === "centre"
							? "center"
							: value === "spacebetween" || value === "spread"
								? "between"
								: align;
		} else if (align !== undefined) resolved["align"] = align;
	}
	return { ...rest, ...resolved };
}

const DEVICE_ALIASES: Readonly<Record<string, string>> = {
	phone: "mobile",
	mobile: "mobile",
	iphone: "mobile",
	android: "mobile",
	ios: "mobile",
	smartphone: "mobile",
	tablet: "tablet",
	ipad: "tablet",
	desktop: "desktop",
	web: "desktop",
	browser: "desktop",
	laptop: "desktop",
	webapp: "desktop",
};

function slug(text: string): string {
	return text
		.toLowerCase()
		.normalize("NFKD")
		.replace(/[^\p{L}\p{N}]+/gu, "-")
		.replace(/^-+|-+$/gu, "");
}

/**
 * Read the ways people write a wireframe into the canonical shape: `pages`
 * or `views` for screens, a lone screen's components at the top, `title` or
 * `label` for a screen's name, `components` or `elements` for children,
 * `phone` or `web` for a device, type names such as `paragraph`, `dialog`,
 * `dropdown` or `switch`, and each widget's words under whichever of `text`,
 * `label` or `title` it names them. A screen without an id takes one from its
 * name.
 */
export function resolveWireframeShorthand(input: unknown): unknown {
	if (!isRecord(input)) return input;
	const chart: Record<string, unknown> = { ...input };
	let screens = take(chart, ["screens", "pages", "views", "frames"], true);
	// A lone screen's components at the top read as that screen; anything else there is left as written.
	const top = ["children", "components", "elements", "layout", "body"].find((key) =>
		Array.isArray(chart[key]),
	);
	if (screens === undefined && top !== undefined) {
		const children = take(chart, [top]);
		if (Array.isArray(children)) {
			const device = take(chart, ["device", "platform", "viewport"]);
			screens = [
				{
					name: chart["title"] ?? "Screen",
					...(device === undefined ? {} : { device }),
					children,
				},
			];
		}
	}
	if (!Array.isArray(screens)) return screens === undefined ? chart : { ...chart, screens };
	const used = new Set(
		screens.flatMap((screen) =>
			isRecord(screen) && typeof screen["id"] === "string" ? [screen["id"]] : [],
		),
	);
	const resolvedScreens = screens.map((screen, index) => {
		if (!isRecord(screen)) return screen;
		const rest: Record<string, unknown> = { ...screen };
		const name = words(take(rest, ["name", "title", "label"]));
		const children = take(rest, CHILDREN_KEYS, true);
		const device = take(rest, ["device", "platform", "viewport", "size", "form"]);
		const align = rest["align"];
		const deviceName =
			typeof device === "string" ? (alias(DEVICE_ALIASES, squash(device)) ?? device) : device;
		let id = rest["id"];
		if (typeof id !== "string" || id.length === 0) {
			const base = slug(typeof name === "string" ? name : "") || `screen-${index + 1}`;
			let candidate = base;
			for (let suffix = 2; used.has(candidate); suffix += 1) candidate = `${base}-${suffix}`;
			used.add(candidate);
			id = candidate;
		}
		const resolvedAlign =
			typeof align === "string" ? resolveComponent({ type: "column", align }) : {};
		return {
			...rest,
			id,
			...(name === undefined ? {} : { name }),
			...(deviceName === undefined ? {} : { device: deviceName }),
			...(isRecord(resolvedAlign) && resolvedAlign["align"] !== undefined
				? { align: resolvedAlign["align"] }
				: {}),
			...(Array.isArray(children)
				? { children: children.map(resolveComponent) }
				: children === undefined
					? {}
					: { children }),
		};
	});
	return { ...chart, screens: resolvedScreens };
}

export const wireframeFixture = parseWireframeDiagram({
	id: "mobile-login",
	title: "Mobile login",
	type: wireframeDiagramType,
	screens: [
		{
			id: "login",
			name: "Login",
			device: "mobile",
			children: [
				{ type: "image", label: "Logo", aspect: "square" },
				{ type: "heading", text: "Welcome back" },
				{ type: "text", text: "Sign in to see your orders and saved items." },
				{ type: "input", label: "Email", placeholder: "you@example.com" },
				{ type: "input", label: "Password", placeholder: "••••••••" },
				{ type: "checkbox", label: "Remember me", checked: true },
				{ type: "button", text: "Sign in", variant: "primary" },
				{ type: "link", text: "Forgot password?" },
				{ type: "divider" },
				{
					type: "row",
					align: "center",
					children: [
						{ type: "text", text: "New here?" },
						{ type: "link", text: "Create an account" },
					],
				},
			],
		},
	],
});
