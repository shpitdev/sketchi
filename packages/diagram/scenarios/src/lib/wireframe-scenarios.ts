import {
	parseWireframeDiagram,
	type WireframeComponent,
	type WireframeComponentType,
	type WireframeDevice,
	type WireframeDiagram,
	wireframeComponentWords,
} from "@sketchi/diagram-core";
import {
	layoutWireframeDiagram,
	type RenderedDiagramScene,
	wireframeFrameName,
	wireframeLayoutIssues,
} from "@sketchi/diagram-renderer";

import type { ScenarioCheck } from "./evaluate.js";
import type { DiagramScenarioDifficulty } from "./scenarios.js";

/** A screen the prompt states: the names it may go by (any, when it names none) and its device. */
export interface WireframeScenarioScreen {
	readonly names: readonly string[];
	readonly device: WireframeDevice;
}

/** A container a stated component sits in: one of these kinds, or one titled one of these. */
export interface WireframeScenarioContainer {
	readonly types?: readonly WireframeComponentType[];
	readonly titles?: readonly string[];
}

/** A component the prompt states, and every fact it states about it. */
export interface WireframeScenarioComponent {
	readonly key: string;
	/** The screen it sits on, by key; the only screen when omitted. */
	readonly screen?: string;
	/** The kinds that draw it; aliases (a switch is a toggle) resolve to these. */
	readonly types: readonly WireframeComponentType[];
	/** What it shows, in whichever field its kind shows words: label, placeholder, value or text. */
	readonly texts?: readonly string[];
	/** A title it carries itself or takes from the card or section around it, or the heading just above it. */
	readonly titled?: readonly string[];
	/** An amount it, or anything inside it, shows in any spelling: $48,200 or $48.2k. */
	readonly amount?: string;
	readonly inside?: WireframeScenarioContainer;
	readonly state?: {
		readonly variant?: "primary" | "secondary";
		readonly checked?: boolean;
		/** What a field shows filled in; a placeholder showing it also reads as stated. */
		readonly value?: readonly string[];
		readonly placeholder?: readonly string[];
		readonly active?: string;
	};
	/** Its items in order: nav items, tabs or breadcrumbs (order:), list items (list:) or a table's columns (columns:). */
	readonly items?: readonly string[];
	/** Where the prompt places it on its screen; "bottom" is scored by `side:<screen>-bottom`. */
	readonly placement?: "bottom";
}

/** A predicate on where stated components sit relative to one another. */
export interface WireframeScenarioSide {
	readonly id: string;
	readonly message: string;
	readonly holds: (found: WireframeScenarioFound) => boolean;
}

export interface WireframeScenario {
	readonly assertions: {
		readonly screens: Readonly<Record<string, WireframeScenarioScreen>>;
		readonly components: readonly WireframeScenarioComponent[];
		/** Stated reading orders, by component key. */
		readonly orders: Readonly<Record<string, readonly string[]>>;
		readonly sides: readonly WireframeScenarioSide[];
	};
	readonly description: string;
	readonly diagramType: "wireframe";
	readonly difficulty: DiagramScenarioDifficulty;
	readonly expectedDiagram: WireframeDiagram;
	readonly id: string;
	readonly logos: readonly [];
	readonly prompt: string;
	readonly tags: readonly string[];
	readonly title: string;
}

/** Texts compare without case, spaces or punctuation: "Forgot password?" matches "forgot-password". */
const key = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

/** The number an amount states, in any spelling: "$48,200", "48.2k" and "$48.2K" are 48200. */
function amountOf(text: string): number | undefined {
	const match = /(-?\d[\d,]*(?:\.\d+)?)\s*([kmb])?/iu.exec(text.replace(/\s+/gu, " "));
	if (!match) return undefined;
	const value = Number(match[1]!.replace(/,/gu, ""));
	const scale = { k: 1e3, m: 1e6, b: 1e9 }[match[2]?.toLowerCase() as "k" | "m" | "b"] ?? 1;
	return Number.isFinite(value) ? value * scale : undefined;
}

/** A component of the model's diagram with where it sits. */
export interface WireframeLocated {
	readonly component: WireframeComponent;
	readonly screen: number;
	/** Containers around it, innermost first. */
	readonly ancestors: readonly WireframeComponent[];
	/** Its position in its screen's reading order: depth first, as drawn top down. */
	readonly order: number;
	readonly parent: WireframeComponent | undefined;
	readonly siblings: readonly WireframeComponent[];
}

function locate(diagram: WireframeDiagram): WireframeLocated[] {
	const located: WireframeLocated[] = [];
	diagram.screens.forEach((screen, index) => {
		let order = 0;
		const visit = (
			components: readonly WireframeComponent[],
			ancestors: readonly WireframeComponent[],
		) => {
			for (const component of components) {
				located.push({
					component,
					screen: index,
					ancestors,
					order: order++,
					parent: ancestors[0],
					siblings: components,
				});
				if (component.children) visit(component.children, [component, ...ancestors]);
			}
		};
		visit(screen.children, []);
	});
	return located;
}

export interface WireframeScenarioFound {
	/** The component each stated key matched in the model's diagram. */
	readonly matches: ReadonlyMap<string, WireframeLocated>;
	readonly located: readonly WireframeLocated[];
	readonly diagram: WireframeDiagram;
}

const words = (component: WireframeComponent) => wireframeComponentWords(component).map(key);
const sameText = (found: string | undefined, accepted: readonly string[]) =>
	found !== undefined && accepted.some((text) => key(text) === key(found));

/**
 * A card or section with no title of its own reads as titled by its first
 * heading or text child; that child is then its title, not its content.
 */
function titleChild(component: WireframeComponent): WireframeComponent | undefined {
	if ((component.type !== "card" && component.type !== "section") || component.title !== undefined)
		return undefined;
	return component.children?.find(
		(child) => (child.type === "heading" || child.type === "text") && child.text !== undefined,
	);
}

const titleOf = (component: WireframeComponent) => component.title ?? titleChild(component)?.text;

/** The titles a component reads under: its own, its card's or section's, or the heading just above it. */
function titlesOf(entry: WireframeLocated): string[] {
	const own = [entry.component.label, titleOf(entry.component)].filter(
		(value): value is string => value !== undefined,
	);
	const around = entry.ancestors
		.filter((ancestor) => ancestor.type === "card" || ancestor.type === "section")
		.slice(0, 1)
		.flatMap((ancestor) => {
			const title = titleOf(ancestor);
			return title ? [title] : [];
		});
	const index = entry.siblings.indexOf(entry.component);
	const before = index > 0 ? entry.siblings[index - 1] : undefined;
	const heading =
		before && (before.type === "heading" || before.type === "text") && before.text
			? [before.text]
			: [];
	return [...own, ...around, ...heading];
}

function insideHolds(entry: WireframeLocated, container: WireframeScenarioContainer): boolean {
	return entry.ancestors.some(
		(ancestor) =>
			(container.types === undefined || container.types.includes(ancestor.type)) &&
			(container.titles === undefined || sameText(titleOf(ancestor), container.titles)),
	);
}

/** Whether it, or anything inside it other than a card's or section's title child, shows the amount. */
function amountShown(component: WireframeComponent, amount: string): boolean {
	const expected = amountOf(amount);
	const all: WireframeComponent[] = [component];
	for (let at = 0; at < all.length; at += 1) {
		const title = titleChild(all[at]!);
		all.push(...(all[at]!.children ?? []).filter((child) => child !== title));
	}
	return all.some((entry) =>
		wireframeComponentWords(entry).some((word) => {
			const value = amountOf(word);
			return (
				value !== undefined &&
				expected !== undefined &&
				Math.abs(value - expected) < 1e-6 * Math.max(1, Math.abs(expected))
			);
		}),
	);
}

/** Item overlap with the stated items, which picks the right nav, tab bar or table. */
function itemOverlap(component: WireframeComponent, items: readonly string[]): number {
	const own = (Array.isArray(component.columns) ? component.columns : (component.items ?? [])).map(
		key,
	);
	return items.filter((item) => own.includes(key(item))).length;
}

function candidates(
	stated: WireframeScenarioComponent,
	located: readonly WireframeLocated[],
	screens: ReadonlyMap<string, number>,
): WireframeLocated[] {
	const screen = stated.screen === undefined ? undefined : screens.get(stated.screen);
	return located.filter(
		(entry) =>
			stated.types.includes(entry.component.type) &&
			(screen === undefined || entry.screen === screen) &&
			(stated.texts === undefined ||
				stated.texts.some((text) => words(entry.component).includes(key(text)))) &&
			(stated.titled === undefined ||
				titlesOf(entry).some((title) => sameText(title, stated.titled!))) &&
			(stated.amount === undefined || amountShown(entry.component, stated.amount)) &&
			(stated.items === undefined || itemOverlap(entry.component, stated.items) > 0),
	);
}

function stateHolds(
	entry: WireframeLocated,
	state: NonNullable<WireframeScenarioComponent["state"]>,
): boolean {
	const { component } = entry;
	return (
		(state.variant === undefined ||
			(state.variant === "primary"
				? component.variant === "primary"
				: component.variant !== "primary")) &&
		(state.checked === undefined || (component.checked === true) === state.checked) &&
		(state.value === undefined ||
			sameText(component.value, state.value) ||
			sameText(component.placeholder, state.value)) &&
		(state.placeholder === undefined || sameText(component.placeholder, state.placeholder)) &&
		(state.active === undefined || sameText(component.active, [state.active]))
	);
}

const describeStated = (stated: WireframeScenarioComponent) =>
	`${stated.types.join(" or ")}${stated.texts ? ` "${stated.texts[0]}"` : ""}${stated.titled ? ` titled "${stated.titled[0]}"` : ""}${stated.amount ? ` showing ${stated.amount}` : ""}${stated.items ? ` with ${stated.items.slice(0, 3).join(", ")}…` : ""}`;

/**
 * At the bottom of its screen: in the screen's footer, which the renderer pins
 * to the bottom. A last block of the flow can still end mid-screen.
 */
function atBottomOf(entry: WireframeLocated): boolean {
	return entry.ancestors.some((ancestor) => ancestor.type === "footer");
}

/** Controls a reader can operate: each nav item and tab counts on its own. */
function controlCount(component: Pick<WireframeComponent, "type" | "items">): number {
	switch (component.type) {
		case "button":
		case "link":
		case "input":
		case "textarea":
		case "select":
		case "search":
		case "checkbox":
		case "radio":
		case "toggle":
			return 1;
		case "tabs":
		case "nav":
			return component.items?.length ?? 0;
		default:
			return 0;
	}
}

/**
 * Wireframe checks score what the prompt states, each on its own: every
 * stated screen and its device; every stated component of a kind that draws
 * it, showing its stated words; the container it sits in; its stated state;
 * the items, tabs, breadcrumbs and columns in stated order; stated reading
 * orders and sides; and no control or screen the prompt does not state.
 */
export function wireframeScenarioChecks(
	scenario: WireframeScenario,
	diagram: WireframeDiagram,
): ScenarioCheck[] {
	const { screens, components, orders, sides } = scenario.assertions;
	const located = locate(diagram);
	const screenKeys = Object.keys(screens);
	// A screen the prompt does not name is the model's screen in its place; a named one matches by name.
	const screenIndex = new Map(
		screenKeys.map((screenKey, at) => {
			const expected = screens[screenKey]!;
			const index =
				expected.names.length === 0
					? at < diagram.screens.length
						? at
						: -1
					: diagram.screens.findIndex((screen) => sameText(screen.name, expected.names));
			return [screenKey, index] as const;
		}),
	);
	const checks: ScenarioCheck[] = [];
	for (const [screenKey, expected] of Object.entries(screens)) {
		const index = screenIndex.get(screenKey)!;
		const screen = index >= 0 ? diagram.screens[index] : undefined;
		checks.push(
			{
				id: `screen:${screenKey}`,
				passed: screen !== undefined,
				message:
					expected.names.length === 0
						? "Expected a screen."
						: `Expected a screen named "${expected.names.join('" or "')}".`,
			},
			{
				id: `device:${screenKey}`,
				passed: screen?.device === expected.device,
				message: `Expected the ${expected.names[0] ? `${expected.names[0]} ` : ""}screen on ${expected.device}${screen ? `; found ${screen.device}` : ""}.`,
			},
		);
	}
	checks.push({
		id: "screens-exact",
		passed: diagram.screens.length === screenKeys.length,
		message: `Expected exactly ${screenKeys.length} screen${screenKeys.length === 1 ? "" : "s"}; found ${diagram.screens.length}.`,
	});
	const presentScreens = new Map([...screenIndex].filter(([, index]) => index >= 0));
	const matches = new Map<string, WireframeLocated>();
	for (const stated of components) {
		const found = candidates(stated, located, presentScreens).toSorted(
			(a, b) =>
				(stated.items
					? itemOverlap(b.component, stated.items) - itemOverlap(a.component, stated.items)
					: 0) ||
				Number(stated.inside ? insideHolds(b, stated.inside) : 0) -
					Number(stated.inside ? insideHolds(a, stated.inside) : 0) ||
				Number(stated.state ? stateHolds(b, stated.state) : 0) -
					Number(stated.state ? stateHolds(a, stated.state) : 0) ||
				a.screen - b.screen ||
				a.order - b.order,
		);
		const match = found[0];
		if (match) matches.set(stated.key, match);
		checks.push({
			id: `component:${stated.key}`,
			passed: match !== undefined,
			message: `Expected a ${describeStated(stated)}.`,
		});
		if (stated.inside)
			checks.push({
				id: `inside:${stated.key}`,
				passed: match !== undefined && insideHolds(match, stated.inside),
				message: `Expected the ${describeStated(stated)} inside a ${stated.inside.types?.join(" or ") ?? "container"}${stated.inside.titles ? ` titled "${stated.inside.titles[0]}"` : ""}.`,
			});
		if (stated.state)
			checks.push({
				id: `state:${stated.key}`,
				passed: match !== undefined && stateHolds(match, stated.state),
				message: `Expected the ${describeStated(stated)} ${Object.entries(stated.state)
					.map(([field, value]) => `${field} ${Array.isArray(value) ? value[0] : String(value)}`)
					.join(", ")}.`,
			});
		if (stated.items) {
			const own = match
				? Array.isArray(match.component.columns)
					? match.component.columns
					: (match.component.items ?? [])
				: [];
			const prefix = stated.types.includes("table")
				? "columns"
				: stated.types.includes("list")
					? "list"
					: "order";
			checks.push({
				id: `${prefix}:${stated.key}`,
				passed:
					own.length === stated.items.length &&
					own.every((item, at) => key(item) === key(stated.items![at]!)),
				message: `Expected the ${stated.types[0]}'s ${prefix === "columns" ? "columns" : "items"} to be exactly ${stated.items.join(", ")}${own.length ? `; found ${own.join(", ")}` : ""}.`,
			});
		}
	}
	for (const [id, keys] of Object.entries(orders)) {
		const entries = keys.map((componentKey) => matches.get(componentKey));
		checks.push({
			id: `order:${id}`,
			passed:
				entries.every((entry) => entry !== undefined) &&
				entries.every(
					(entry, at) =>
						at === 0 ||
						(entry?.screen === entries[at - 1]?.screen &&
							(entry?.order ?? 0) > (entries[at - 1]?.order ?? 0)),
				),
			message: `Expected ${keys.join(", ")} in that order.`,
		});
	}
	const found: WireframeScenarioFound = { matches, located, diagram };
	for (const side of sides)
		checks.push({ id: `side:${side.id}`, passed: side.holds(found), message: side.message });
	// What the prompt places at the bottom of a screen, scored once per screen.
	for (const screenKey of screenKeys) {
		const bottom = components.filter(
			(entry) => entry.placement === "bottom" && (entry.screen ?? screenKeys[0]) === screenKey,
		);
		if (bottom.length === 0) continue;
		checks.push({
			id: `side:${screenKey}-bottom`,
			passed: bottom.every((entry) => {
				const match = matches.get(entry.key);
				return match !== undefined && atBottomOf(match);
			}),
			message: `Expected ${bottom.map(describeStated).join(" and ")} at the bottom of the screen, in its footer.`,
		});
	}
	// Every control the prompt states counts once; anything more is invented.
	const stated = components.reduce(
		(sum, entry) =>
			sum +
			(entry.types.every((type) => controlCount({ type, items: entry.items ?? [] }) > 0)
				? controlCount({ type: entry.types[0]!, items: entry.items ?? [] })
				: 0),
		0,
	);
	const drawn = located.reduce((sum, entry) => sum + controlCount(entry.component), 0);
	checks.push({
		id: "controls-stated",
		passed: drawn === stated,
		message: `Expected exactly the ${stated} controls the prompt states (buttons, links, fields, selects, checkboxes, radios, toggles, tabs and nav items); found ${drawn}.`,
	});
	return checks;
}

/** Whether every box in `inner` sits inside `outer`. */
const holds = (
	outer: { x: number; y: number; width: number; height: number },
	inner: { x: number; y: number; width: number; height: number },
) =>
	inner.x >= outer.x - 0.5 &&
	inner.y >= outer.y - 0.5 &&
	inner.x + inner.width <= outer.x + outer.width + 0.5 &&
	inner.y + inner.height <= outer.y + outer.height + 0.5;

const CONTAINER_TYPES: ReadonlySet<string> = new Set([
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
]);

/**
 * The drawn scene says what the diagram says: every screen a frame named for
 * it, and every component drawn as its own group showing its words, inside
 * its parent's box and its screen's frame.
 */
export function wireframeDrawnCheck(
	diagram: WireframeDiagram,
	scene: RenderedDiagramScene,
): ScenarioCheck {
	const problems: string[] = [];
	const layout = layoutWireframeDiagram(diagram);
	const flat = (text: string) => text.replace(/\s+/gu, "");
	for (const [index, screen] of diagram.screens.entries()) {
		const frame = scene.elements.find((element) => element.id === `frame:${screen.id}`);
		if (frame?.type !== "frame" || frame.name !== wireframeFrameName(screen.name))
			problems.push(`${screen.name} frame`);
		const placed = layout.screens[index];
		if (!placed) continue;
		const byPath = new Map(placed.components.map((component) => [component.path, component]));
		// A component's own elements are `wf:<screen>:<path>:<part>`; a header's title leads its row as `<path>.title`.
		const own = (path: string) =>
			scene.elements.filter((element) => element.id.startsWith(`wf:${screen.id}:${path}:`));
		const visit = (components: readonly WireframeComponent[], prefix: string) =>
			components.forEach((component, at) => {
				const path = prefix ? `${prefix}.${at}` : String(at);
				const elements = [...own(path), ...own(`${path}.title`)];
				const layoutOnly = ["row", "column", "grid", "main", "section"].includes(component.type);
				if (!layoutOnly && elements.length === 0) problems.push(`${path} ${component.type}`);
				// Widgets and outlined containers are each one group that moves as one.
				const group = `group:${screen.id}:${path}`;
				if (!layoutOnly && own(path).some((element) => !element.groupIds?.includes(group)))
					problems.push(`${path} ungrouped`);
				const shown = elements
					.flatMap((element) => (element.type === "text" ? [flat(element.text)] : []))
					.join("|");
				const stated = CONTAINER_TYPES.has(component.type)
					? component.title
						? [component.title]
						: []
					: wireframeComponentWords(component).filter(
							(word) =>
								!(component.type === "avatar" && word === component.label) &&
								// A field shows its value in place of its placeholder.
								!(
									component.value !== undefined &&
									word === component.placeholder &&
									word !== component.value
								),
						);
				for (const word of stated)
					if (!shown.includes(flat(word))) problems.push(`${path} "${word}"`);
				const box = byPath.get(path);
				if (box && !holds(placed.frame, box.box)) problems.push(`${path} outside its screen`);
				const parent = box?.parent === undefined ? undefined : byPath.get(box.parent);
				if (box && parent && !holds(parent.box, box.box))
					problems.push(`${path} outside its ${parent.type}`);
				if (component.children) visit(component.children, path);
			});
		visit(screen.children, "");
	}
	return {
		id: "wireframe-drawn",
		passed: problems.length === 0,
		message:
			problems.length === 0
				? "Every screen is a frame, and every component is drawn as its own group with its words, inside its parent and its screen."
				: `Drawn differently from the diagram: ${problems.slice(0, 8).join(", ")}.`,
	};
}

/** Components apart, every text inside its component and clear of others, every screen holding its own. */
export function wireframeLayoutCheck(scene: RenderedDiagramScene): ScenarioCheck {
	const issues = wireframeLayoutIssues(scene);
	return {
		id: "wireframe-layout",
		passed: issues.length === 0,
		message:
			issues.length === 0
				? "No components overlap, every text fits its component, and every screen's frame holds everything on it."
				: issues
						.slice(0, 6)
						.map((issue) => issue.message)
						.join(" "),
	};
}

// ----------------------------------------------------------------- scenarios

const field = (
	key: string,
	types: readonly WireframeComponentType[],
	texts: readonly string[] | undefined,
	extra: Omit<WireframeScenarioComponent, "key" | "types" | "texts"> = {},
): WireframeScenarioComponent => ({ key, types, ...(texts ? { texts } : {}), ...extra });

const COPY: readonly WireframeComponentType[] = ["text", "heading"];
const HEADING: readonly WireframeComponentType[] = ["heading", "text"];
const SEARCH: readonly WireframeComponentType[] = ["search", "input"];

interface WireframeScenarioDefinition {
	readonly id: string;
	readonly title: string;
	readonly difficulty: DiagramScenarioDifficulty;
	readonly tags: readonly string[];
	readonly description: string;
	readonly prompt: string;
	readonly screens: Readonly<Record<string, WireframeScenarioScreen>>;
	readonly components: readonly WireframeScenarioComponent[];
	readonly orders?: Readonly<Record<string, readonly string[]>>;
	readonly sides?: readonly WireframeScenarioSide[];
	readonly expected: unknown;
}

function defineWireframeScenario(definition: WireframeScenarioDefinition): WireframeScenario {
	const { screens, components, orders = {}, sides = [], expected, ...scenario } = definition;
	return {
		...scenario,
		diagramType: "wireframe",
		logos: [],
		assertions: { screens, components, orders, sides },
		expectedDiagram: parseWireframeDiagram(expected),
	};
}

/** The stated component that sits at the bottom of its screen; see `atBottomOf`. */
const atBottom = (found: WireframeScenarioFound, componentKey: string) => {
	const entry = found.matches.get(componentKey);
	return entry !== undefined && atBottomOf(entry);
};

/** The stated component that sits in a header, or leads its screen above everything else. */
const atTop = (found: WireframeScenarioFound, componentKey: string) => {
	const entry = found.matches.get(componentKey);
	if (!entry) return false;
	const header = entry.ancestors.find((ancestor) => ancestor.type === "header");
	return header !== undefined || entry.order === 0;
};

/** Two stated components in one row, the first left of the second. */
const leftOf = (found: WireframeScenarioFound, left: string, right: string) => {
	const a = found.matches.get(left);
	const b = found.matches.get(right);
	if (!a || !b || a.screen !== b.screen) return false;
	const chainA = [a.component, ...a.ancestors];
	const chainB = [b.component, ...b.ancestors];
	const row = chainA.find(
		(ancestor) =>
			(ancestor.type === "row" || ancestor.type === "grid") && chainB.includes(ancestor),
	);
	if (!row?.children) return false;
	const index = (chain: readonly WireframeComponent[]) =>
		row.children!.findIndex((child) => chain.includes(child));
	return index(chainA) >= 0 && index(chainA) < index(chainB);
};

const wireframeScenarioDefinitions: readonly WireframeScenarioDefinition[] = [
	{
		id: "mobile-login-wireframe",
		title: "Mobile login",
		difficulty: "smoke",
		tags: ["wireframe", "mobile", "form", "login"],
		description:
			"A phone login screen: a heading and copy, two fields, a checkbox, a primary button and two links, top to bottom.",
		prompt:
			'Draw a mobile wireframe of our app\'s login screen. At the top, the heading "Welcome back" and the text "Sign in to continue". Below them, an Email input with the placeholder "you@example.com", a Password input and a "Remember me" checkbox. Then a primary "Sign in" button and a "Forgot password?" link. At the bottom, the text "New here?" and a "Create account" link.',
		screens: { login: { names: [], device: "mobile" } },
		components: [
			field("welcome", ["heading"], ["Welcome back"]),
			field("intro", COPY, ["Sign in to continue"]),
			field("email", ["input"], ["Email"], { state: { placeholder: ["you@example.com"] } }),
			field("password", ["input"], ["Password"]),
			field("remember", ["checkbox"], ["Remember me"]),
			field("sign-in", ["button"], ["Sign in"], { state: { variant: "primary" } }),
			field("forgot", ["link"], ["Forgot password?"]),
			field("new-here", COPY, ["New here?"], { placement: "bottom" }),
			field("create", ["link"], ["Create account"], { placement: "bottom" }),
		],
		orders: {
			login: [
				"welcome",
				"intro",
				"email",
				"password",
				"remember",
				"sign-in",
				"forgot",
				"new-here",
				"create",
			],
		},
		expected: {
			id: "mobile-login-wireframe",
			title: "Mobile login",
			type: "wireframe",
			screens: [
				{
					id: "login",
					name: "Login",
					device: "mobile",
					children: [
						{ type: "heading", text: "Welcome back" },
						{ type: "text", text: "Sign in to continue" },
						{ type: "input", label: "Email", placeholder: "you@example.com" },
						{ type: "input", label: "Password" },
						{ type: "checkbox", label: "Remember me" },
						{ type: "button", text: "Sign in", variant: "primary" },
						{ type: "link", text: "Forgot password?" },
						{
							type: "footer",
							align: "center",
							children: [
								{ type: "text", text: "New here?" },
								{ type: "link", text: "Create account" },
							],
						},
					],
				},
			],
		},
	},
	{
		id: "saas-dashboard-wireframe",
		title: "Northstar dashboard",
		difficulty: "challenge",
		tags: ["wireframe", "desktop", "dashboard", "dense", "long-labels"],
		description:
			"A dense desktop dashboard with long labels: a seven-item sidebar, a header with a long search placeholder, four KPI cards in a row, a chart and a six-column table.",
		prompt:
			'Wireframe a desktop SaaS analytics dashboard. A sidebar on the left holds the product name "Northstar" and these nav items in order: Overview (active), Customers, Orders, Products, Reports, Integrations, Settings. A header above the main content holds a search bar with the placeholder "Search orders, customers or products" and an avatar. The main content starts with the heading "Overview", then a row of four KPI cards: "Monthly recurring revenue" $48,200, "Active subscriptions" 1,284, "Average revenue per account" $37.50 and "Churn rate this month" 2.1%. Below the cards, a chart placeholder titled "Revenue over the last 12 months", then a table titled "Recent orders" with the columns Order ID, Customer, Plan, Amount, Status and Created at.',
		screens: { dashboard: { names: [], device: "desktop" } },
		components: [
			field("product-name", HEADING, ["Northstar"], { inside: { types: ["sidebar"] } }),
			field("nav", ["nav"], undefined, {
				items: [
					"Overview",
					"Customers",
					"Orders",
					"Products",
					"Reports",
					"Integrations",
					"Settings",
				],
				inside: { types: ["sidebar"] },
				state: { active: "Overview" },
			}),
			field("search", SEARCH, ["Search orders, customers or products"], {
				inside: { types: ["header"] },
			}),
			field("avatar", ["avatar"], undefined, { inside: { types: ["header"] } }),
			field("overview", ["heading"], ["Overview"]),
			field("mrr", ["card", "section"], undefined, {
				titled: ["Monthly recurring revenue"],
				amount: "$48,200",
			}),
			field("subscriptions", ["card", "section"], undefined, {
				titled: ["Active subscriptions"],
				amount: "1,284",
			}),
			field("arpa", ["card", "section"], undefined, {
				titled: ["Average revenue per account"],
				amount: "$37.50",
			}),
			field("churn", ["card", "section"], undefined, {
				titled: ["Churn rate this month"],
				amount: "2.1%",
			}),
			field("chart", ["chart"], undefined, { titled: ["Revenue over the last 12 months"] }),
			field("orders", ["table"], undefined, {
				titled: ["Recent orders"],
				items: ["Order ID", "Customer", "Plan", "Amount", "Status", "Created at"],
			}),
		],
		orders: { main: ["overview", "mrr", "subscriptions", "arpa", "churn", "chart", "orders"] },
		sides: [
			{
				id: "sidebar-left",
				message: "Expected the sidebar on the left.",
				holds: (found) =>
					found.matches
						.get("nav")
						?.ancestors.some(
							(ancestor) => ancestor.type === "sidebar" && ancestor.side !== "right",
						) ?? false,
			},
			{
				id: "header-top",
				message: "Expected the search bar and avatar in a header at the top.",
				holds: (found) => atTop(found, "search") && atTop(found, "avatar"),
			},
			{
				id: "kpi-row",
				message: "Expected the four KPI cards side by side in one row, in the stated order.",
				holds: (found) => {
					const cards = ["mrr", "subscriptions", "arpa", "churn"].map((cardKey) =>
						found.matches.get(cardKey),
					);
					const parent = cards[0]?.parent;
					return (
						parent !== undefined &&
						(parent.type === "row" ||
							(parent.type === "grid" && (parent.columns as number) >= 4)) &&
						cards.every((card) => card?.parent === parent) &&
						cards.every((card, at) => at === 0 || card!.order > cards[at - 1]!.order)
					);
				},
			},
		],
		expected: {
			id: "saas-dashboard-wireframe",
			title: "Northstar dashboard",
			type: "wireframe",
			screens: [
				{
					id: "dashboard",
					name: "Dashboard",
					device: "desktop",
					children: [
						{
							type: "sidebar",
							children: [
								{ type: "heading", level: 3, text: "Northstar" },
								{
									type: "nav",
									items: [
										"Overview",
										"Customers",
										"Orders",
										"Products",
										"Reports",
										"Integrations",
										"Settings",
									],
									active: "Overview",
								},
							],
						},
						{
							type: "header",
							children: [
								{ type: "search", placeholder: "Search orders, customers or products" },
								{ type: "avatar" },
							],
						},
						{
							type: "main",
							children: [
								{ type: "heading", level: 1, text: "Overview" },
								{
									type: "row",
									children: [
										{
											type: "card",
											title: "Monthly recurring revenue",
											children: [{ type: "heading", level: 2, text: "$48,200" }],
										},
										{
											type: "card",
											title: "Active subscriptions",
											children: [{ type: "heading", level: 2, text: "1,284" }],
										},
										{
											type: "card",
											title: "Average revenue per account",
											children: [{ type: "heading", level: 2, text: "$37.50" }],
										},
										{
											type: "card",
											title: "Churn rate this month",
											children: [{ type: "heading", level: 2, text: "2.1%" }],
										},
									],
								},
								{
									type: "card",
									title: "Revenue over the last 12 months",
									children: [{ type: "chart", kind: "line" }],
								},
								{
									type: "card",
									title: "Recent orders",
									children: [
										{
											type: "table",
											columns: ["Order ID", "Customer", "Plan", "Amount", "Status", "Created at"],
										},
									],
								},
							],
						},
					],
				},
			],
		},
	},
	{
		id: "account-settings-wireframe",
		title: "Account settings",
		difficulty: "standard",
		tags: ["wireframe", "desktop", "settings", "form", "state"],
		description:
			"A desktop settings page: an active tab, three titled sections of toggles on and off and selects showing values, and a save bar with a secondary and a primary button.",
		prompt:
			'Wireframe a desktop account settings page. The heading is "Settings", with the tabs General, Notifications (active), Billing and Security. The Notifications tab shows three sections. "Email notifications" has the toggles "Product updates" (on), "Weekly digest" (on) and "Marketing emails" (off). "Push notifications" has the toggles "New comments" (on) and "Mentions" (on). "Quiet hours" has a "Start time" select showing 22:00 and an "End time" select showing 07:00. A save bar at the bottom of the page holds a secondary "Cancel" button and a primary "Save changes" button.',
		screens: { settings: { names: [], device: "desktop" } },
		components: [
			field("settings", ["heading"], ["Settings"]),
			field("tabs", ["tabs"], undefined, {
				items: ["General", "Notifications", "Billing", "Security"],
				state: { active: "Notifications" },
			}),
			field("email-section", ["section", "card"], undefined, { titled: ["Email notifications"] }),
			field("product-updates", ["toggle"], ["Product updates"], {
				inside: { titles: ["Email notifications"] },
				state: { checked: true },
			}),
			field("weekly-digest", ["toggle"], ["Weekly digest"], {
				inside: { titles: ["Email notifications"] },
				state: { checked: true },
			}),
			field("marketing", ["toggle"], ["Marketing emails"], {
				inside: { titles: ["Email notifications"] },
				state: { checked: false },
			}),
			field("push-section", ["section", "card"], undefined, { titled: ["Push notifications"] }),
			field("new-comments", ["toggle"], ["New comments"], {
				inside: { titles: ["Push notifications"] },
				state: { checked: true },
			}),
			field("mentions", ["toggle"], ["Mentions"], {
				inside: { titles: ["Push notifications"] },
				state: { checked: true },
			}),
			field("quiet-section", ["section", "card"], undefined, { titled: ["Quiet hours"] }),
			field("start-time", ["select"], ["Start time"], {
				inside: { titles: ["Quiet hours"] },
				state: { value: ["22:00"] },
			}),
			field("end-time", ["select"], ["End time"], {
				inside: { titles: ["Quiet hours"] },
				state: { value: ["07:00"] },
			}),
			field("cancel", ["button"], ["Cancel"], { state: { variant: "secondary" } }),
			field("save", ["button"], ["Save changes"], { state: { variant: "primary" } }),
		],
		orders: {
			sections: ["email-section", "push-section", "quiet-section"],
			"email-notifications": ["product-updates", "weekly-digest", "marketing"],
			"push-notifications": ["new-comments", "mentions"],
			"quiet-hours": ["start-time", "end-time"],
			"save-bar": ["cancel", "save"],
		},
		sides: [
			{
				id: "save-bar-bottom",
				message:
					"Expected the Cancel and Save changes buttons together in a save bar at the bottom of the page.",
				holds: (found) => {
					const cancel = found.matches.get("cancel");
					const save = found.matches.get("save");
					return (
						cancel !== undefined &&
						save !== undefined &&
						cancel.parent !== undefined &&
						cancel.parent === save.parent &&
						atBottom(found, "cancel") &&
						atBottom(found, "save")
					);
				},
			},
		],
		expected: {
			id: "account-settings-wireframe",
			title: "Account settings",
			type: "wireframe",
			screens: [
				{
					id: "settings",
					name: "Settings",
					device: "desktop",
					children: [
						{
							type: "main",
							children: [
								{ type: "heading", level: 1, text: "Settings" },
								{
									type: "tabs",
									items: ["General", "Notifications", "Billing", "Security"],
									active: "Notifications",
								},
								{
									type: "section",
									title: "Email notifications",
									children: [
										{ type: "toggle", label: "Product updates", checked: true },
										{ type: "toggle", label: "Weekly digest", checked: true },
										{ type: "toggle", label: "Marketing emails" },
									],
								},
								{
									type: "section",
									title: "Push notifications",
									children: [
										{ type: "toggle", label: "New comments", checked: true },
										{ type: "toggle", label: "Mentions", checked: true },
									],
								},
								{
									type: "section",
									title: "Quiet hours",
									children: [
										{
											type: "row",
											children: [
												{ type: "select", label: "Start time", value: "22:00" },
												{ type: "select", label: "End time", value: "07:00" },
											],
										},
									],
								},
							],
						},
						{
							type: "footer",
							align: "end",
							children: [
								{ type: "button", text: "Cancel", variant: "secondary" },
								{ type: "button", text: "Save changes", variant: "primary" },
							],
						},
					],
				},
			],
		},
	},
	{
		id: "product-page-wireframe",
		title: "Summit backpack product page",
		difficulty: "standard",
		tags: ["wireframe", "desktop", "e-commerce", "two-column"],
		description:
			"A desktop product page: a header with a store name, nav, search and cart link; breadcrumbs; an image column beside a details column of fields and buttons; and a reviews section.",
		prompt:
			'Draw a desktop wireframe of an e-commerce product page. A header holds the store name "Trailhead Outfitters", the nav links Men, Women, Gear and Sale, a search bar and a Cart link. Below it, the breadcrumbs Home > Gear > Backpacks. The left half holds a large product image placeholder with a row of four thumbnail image placeholders under it. The right half holds the heading "Summit 40L Backpack", the price "$189", the text "Rated 4.6 from 212 reviews", a "Color" select showing Slate, a "Size" select showing M/L, a "Quantity" input showing 1, a primary "Add to cart" button and a secondary "Save to wishlist" button. Below both halves, a "Customer reviews" section lists three reviews: "Fits a weekend\'s gear", "Hip belt could be wider" and "Survived a week of rain".',
		screens: { product: { names: [], device: "desktop" } },
		components: [
			field("store", HEADING, ["Trailhead Outfitters"], { inside: { types: ["header"] } }),
			field("nav", ["nav"], undefined, {
				items: ["Men", "Women", "Gear", "Sale"],
				inside: { types: ["header"] },
			}),
			field("search", SEARCH, undefined, { inside: { types: ["header"] } }),
			field("cart", ["link"], ["Cart"], { inside: { types: ["header"] } }),
			field("breadcrumbs", ["breadcrumbs"], undefined, { items: ["Home", "Gear", "Backpacks"] }),
			field("main-image", ["image"], undefined),
			field("heading", ["heading"], ["Summit 40L Backpack"]),
			field("price", HEADING, undefined, { amount: "$189" }),
			field("rating", COPY, ["Rated 4.6 from 212 reviews"]),
			field("color", ["select"], ["Color"], { state: { value: ["Slate"] } }),
			field("size", ["select"], ["Size"], { state: { value: ["M/L"] } }),
			field("quantity", ["input"], ["Quantity"], { state: { value: ["1"] } }),
			field("add-to-cart", ["button"], ["Add to cart"], { state: { variant: "primary" } }),
			field("wishlist", ["button"], ["Save to wishlist"], { state: { variant: "secondary" } }),
			field("reviews", ["section", "card"], undefined, { titled: ["Customer reviews"] }),
			field("review-list", ["list"], undefined, {
				items: ["Fits a weekend's gear", "Hip belt could be wider", "Survived a week of rain"],
				inside: { titles: ["Customer reviews"] },
			}),
		],
		orders: {
			header: ["store", "nav", "search", "cart"],
			details: [
				"heading",
				"price",
				"rating",
				"color",
				"size",
				"quantity",
				"add-to-cart",
				"wishlist",
			],
			page: ["breadcrumbs", "main-image", "heading", "reviews"],
		},
		sides: [
			{
				id: "image-left",
				message: "Expected the image column left of the details column, in one row.",
				holds: (found) => leftOf(found, "main-image", "heading"),
			},
			{
				id: "thumbnails",
				message: "Expected four thumbnail images side by side under the main image.",
				holds: (found) => {
					const main = found.matches.get("main-image");
					if (!main) return false;
					const thumbnails = found.located.filter(
						(entry) =>
							entry.component.type === "image" &&
							entry.component !== main.component &&
							entry.screen === main.screen &&
							entry.order > main.order,
					);
					const parent = thumbnails[0]?.parent;
					return (
						thumbnails.length === 4 &&
						parent !== undefined &&
						(parent.type === "row" || parent.type === "grid") &&
						thumbnails.every((entry) => entry.parent === parent)
					);
				},
			},
			{
				id: "header-top",
				message: "Expected the store name, nav, search bar and cart link in a header at the top.",
				holds: (found) =>
					["store", "nav", "search", "cart"].every((componentKey) => atTop(found, componentKey)),
			},
		],
		expected: {
			id: "product-page-wireframe",
			title: "Summit backpack product page",
			type: "wireframe",
			screens: [
				{
					id: "product",
					name: "Product page",
					device: "desktop",
					children: [
						{
							type: "header",
							children: [
								{ type: "heading", level: 3, text: "Trailhead Outfitters" },
								{ type: "nav", items: ["Men", "Women", "Gear", "Sale"] },
								{ type: "search" },
								{ type: "link", text: "Cart" },
							],
						},
						{
							type: "main",
							children: [
								{ type: "breadcrumbs", items: ["Home", "Gear", "Backpacks"] },
								{
									type: "row",
									children: [
										{
											type: "column",
											children: [
												{ type: "image", label: "Product image", aspect: "square" },
												{
													type: "grid",
													columns: 4,
													children: Array.from({ length: 4 }, () => ({
														type: "image",
														aspect: "square",
													})),
												},
											],
										},
										{
											type: "column",
											children: [
												{ type: "heading", level: 1, text: "Summit 40L Backpack" },
												{ type: "heading", level: 2, text: "$189" },
												{ type: "text", text: "Rated 4.6 from 212 reviews" },
												{ type: "select", label: "Color", value: "Slate" },
												{ type: "select", label: "Size", value: "M/L" },
												{ type: "input", label: "Quantity", value: "1" },
												{
													type: "row",
													children: [
														{ type: "button", text: "Add to cart", variant: "primary" },
														{ type: "button", text: "Save to wishlist", variant: "secondary" },
													],
												},
											],
										},
									],
								},
								{
									type: "section",
									title: "Customer reviews",
									children: [
										{
											type: "list",
											items: [
												"Fits a weekend's gear",
												"Hip belt could be wider",
												"Survived a week of rain",
											],
										},
									],
								},
							],
						},
					],
				},
			],
		},
	},
];

export const wireframeScenarios: readonly WireframeScenario[] =
	wireframeScenarioDefinitions.map(defineWireframeScenario);
