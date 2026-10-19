import {
	CANVAS_SPEC_VERSION,
	canvasFrameNameBox,
	canvasFrameNameWidth,
	GROUP_OUTLINE_CLEARANCE,
	estimateTextWidth,
	type OrgChartDiagram,
	type OrgPerson,
	orgChartReports,
	orgChartRoots,
	orgPersonInitials,
	SKETCHI_DIAGRAM_PALETTE,
	validateOrgChartDiagram,
	wrappedLabelWidth,
	wrapTextToWidth,
} from "@sketchi/diagram-core";

import { CHART_SERIES_COLORS } from "./chart.js";
import {
	ROUTE_BUDGET,
	routeOrthogonal,
	type RouteObstacle,
	type RoutePoint,
	type RoutePort,
	type RouteSegment,
	routeSegments,
} from "./gantt-routing.js";
import {
	layoutOrgChart,
	type OrgLayout,
	type OrgPoint,
	type OrgRect,
	type OrgTreeNode,
	simplifyPolyline,
} from "./org-chart-layout.js";
import type {
	ArrowSceneElement,
	FrameSceneElement,
	NodeSceneElement,
	RenderedDiagramScene,
	SceneElement,
	TextSceneElement,
} from "./scene.js";

const NAME_FONT_SIZE = 16;
const DETAIL_FONT_SIZE = 13;
const LINE_HEIGHT = 1.25;
/** A card's text keeps this far from its sides; Excalidraw's bound-text rules need 12. */
const CARD_PAD_X = 12;
/** Room above a card's content; below it, Excalidraw's own 5 px inset for bottom-aligned text. */
const CARD_PAD_TOP = 9;
const CARD_PAD_BOTTOM = 5;
const NAME_GAP = 3;
/** Cards of a level share one width within these bounds; longer names and titles wrap. */
const CARD_MIN_WIDTH = 148;
const CARD_MAX_WIDTH = 232;
/** An avatar placeholder: a circle wide enough for Excalidraw's 16 px initials. */
const AVATAR_SIZE = 44;
const AVATAR_GAP = 5;
const PADDING = 40;
/** Solid reporting lines; dotted-line reports in their own color, dashed, with a head at the second manager. */
const LINE_COLOR = "#857b6f";
const DOTTED_COLOR = "#6250d6";
const DETAIL_COLOR = "#5f574c";
const DOTTED_LABEL_FONT_SIZE = 13;
/** Dotted lines keep this far from cards they do not join, and from region frames. */
const CARD_CLEARANCE = 6;
/** What a dotted line pays to cross a reporting line, in units of route length. */
const HIERARCHY_CROSSING_COST = 500;
/** The clearance a line keeps when no search finds one at CARD_CLEARANCE. */
const RELAXED_CLEARANCE = 3;
const FRAME_CLEARANCE = 8;
/** Horizontal runs of dotted lines prefer these offsets from card edges. */
const LANE_OFFSETS = [14, 22, 30];
const DENSE_LANE_OFFSETS = [8, 18, 26, 36];
/** Search steps dotted lines may spend, per line and in all. */
const DOTTED_BUDGET_PER_LINE = 48_000;
const DOTTED_BUDGET = 400_000;

/** A person's card before placement: its text, size and colors. */
interface Card {
	readonly person: OrgPerson;
	readonly depth: number;
	readonly name: string;
	/** Title and department lines, bound to the card at its bottom. */
	readonly details: string | undefined;
	readonly color: string;
	readonly avatar: boolean;
	width: number;
	height: number;
}

/** A color `share` of the way from the background to `color`. */
function tint(color: string, background: string, share: number): string {
	const channel = (hex: string, offset: number) =>
		Number.parseInt(hex.slice(offset, offset + 2), 16);
	return `#${[1, 3, 5]
		.map((offset) =>
			Math.round(
				channel(background, offset) +
					(channel(color, offset) - channel(background, offset)) * share,
			)
				.toString(16)
				.padStart(2, "0"),
		)
		.join("")}`;
}

/** Wrap to the narrowest width that keeps the line count, so lines balance. */
function balancedWrap(text: string, maxWidth: number, fontSize: number): string {
	const lines = (value: string) => value.split("\n").length;
	const wrapped = wrapTextToWidth(text, maxWidth, fontSize);
	if (lines(wrapped) === 1) return wrapped;
	let low = fontSize;
	let high = maxWidth;
	while (high - low > 1) {
		const middle = Math.floor((low + high) / 2);
		if (lines(wrapTextToWidth(text, middle, fontSize)) <= lines(wrapped)) high = middle;
		else low = middle;
	}
	return wrapTextToWidth(text, high, fontSize);
}

const lineCount = (text: string | undefined) => (text === undefined ? 0 : text.split("\n").length);
const textHeight = (text: string | undefined, fontSize: number) =>
	Math.ceil(lineCount(text) * fontSize * LINE_HEIGHT);

/**
 * Department regions: below the top, a person with reports whose department
 * differs from their manager's starts one around their whole subtree, unless
 * they already sit in one. Regions never nest.
 */
function regionRoots(diagram: OrgChartDiagram): Map<string, string> {
	const roots = new Map<string, string>();
	if (diagram.groupByDepartment !== true) return roots;
	const reports = orgChartReports(diagram);
	const byId = new Map(diagram.people.map((person) => [person.id, person]));
	const visit = (person: OrgPerson, inRegion: boolean) => {
		const manager = person.manager === undefined ? undefined : byId.get(person.manager);
		const starts =
			!inRegion &&
			manager !== undefined &&
			person.department !== undefined &&
			person.department !== manager.department &&
			(reports.get(person.id)?.length ?? 0) > 0;
		if (starts) roots.set(person.id, person.department);
		for (const report of reports.get(person.id) ?? []) visit(report, inRegion || starts);
	};
	for (const root of orgChartRoots(diagram)) visit(root, false);
	return roots;
}

/** Measure every card: wrapped text, and one width and height per level. */
function measureCards(diagram: OrgChartDiagram, regions: ReadonlyMap<string, string>) {
	const reports = orgChartReports(diagram);
	const departments = [...new Set(diagram.people.flatMap((person) => person.department ?? []))];
	// People of one department share a color. A chart that names no department
	// colors each branch below the top instead, so its teams still read apart.
	const byId = new Map(diagram.people.map((person) => [person.id, person]));
	const branchOf = (person: OrgPerson): OrgPerson | undefined => {
		let current = person;
		for (let depth = 0; depth <= diagram.people.length; depth += 1) {
			const manager = current.manager === undefined ? undefined : byId.get(current.manager);
			if (!manager) return undefined;
			if (manager.manager === undefined) return current;
			current = manager;
		}
		return undefined;
	};
	const branches = orgChartRoots(diagram).flatMap((root) =>
		(reports.get(root.id) ?? []).filter((report) => report.assistant !== true),
	);
	const series = (index: number) => CHART_SERIES_COLORS[index % CHART_SERIES_COLORS.length]!;
	const colorOf = (person: OrgPerson) => {
		if (departments.length > 0)
			return person.department === undefined
				? diagram.style.accentColor
				: series(departments.indexOf(person.department));
		// The top person and their assistants keep the accent.
		const branch = branchOf(person);
		const index = branch === undefined ? -1 : branches.indexOf(branch);
		return index < 0 ? diagram.style.accentColor : series(index);
	};
	// A card in a region of its own department leaves the department to the region's name.
	const regionOf = new Map<string, string>();
	const depthOf = new Map<string, number>();
	const visit = (person: OrgPerson, depth: number, region: string | undefined) => {
		const own = regions.get(person.id) ?? region;
		depthOf.set(person.id, depth);
		if (own !== undefined) regionOf.set(person.id, own);
		for (const report of reports.get(person.id) ?? []) visit(report, depth + 1, own);
	};
	for (const root of orgChartRoots(diagram)) visit(root, 0, undefined);
	const textWidth = CARD_MAX_WIDTH - 2 * CARD_PAD_X;
	const cards = new Map<string, Card>();
	for (const person of diagram.people) {
		// A department shows where it starts: on a top person, or below a manager of
		// another department, and never inside a region of its own name. Below that,
		// the card's color carries it.
		const manager = person.manager === undefined ? undefined : byId.get(person.manager);
		const department =
			person.department !== undefined &&
			manager?.department !== person.department &&
			regionOf.get(person.id) !== person.department
				? person.department
				: undefined;
		const detailLines = [person.title, department]
			.filter((line): line is string => line !== undefined)
			.map((line) => balancedWrap(line.trim(), textWidth, DETAIL_FONT_SIZE));
		cards.set(person.id, {
			person,
			depth: depthOf.get(person.id) ?? 0,
			name: balancedWrap(person.name.trim(), textWidth, NAME_FONT_SIZE),
			details: detailLines.length > 0 ? detailLines.join("\n") : undefined,
			color: colorOf(person),
			avatar: person.avatar === true,
			width: 0,
			height: 0,
		});
	}
	// One width per level, so a rank of cards reads as one; one height per set of
	// reports of one manager, so a row or stack of them lines up without cards of
	// other teams making them taller.
	const levels = new Map<number, Card[]>();
	for (const card of cards.values()) {
		const list = levels.get(card.depth) ?? [];
		list.push(card);
		levels.set(card.depth, list);
	}
	for (const level of levels.values()) {
		const needed = Math.max(
			...level.map(
				(card) =>
					Math.max(
						estimateTextWidth(card.name, NAME_FONT_SIZE),
						card.details ? estimateTextWidth(card.details, DETAIL_FONT_SIZE) : 0,
						card.avatar ? AVATAR_SIZE : 0,
					) +
					2 * CARD_PAD_X,
			),
		);
		const width = Math.ceil(Math.min(CARD_MAX_WIDTH, Math.max(CARD_MIN_WIDTH, needed)));
		for (const card of level) card.width = width;
	}
	const natural = (card: Card) =>
		CARD_PAD_TOP +
		(card.avatar ? AVATAR_SIZE + AVATAR_GAP : 0) +
		textHeight(card.name, NAME_FONT_SIZE) +
		(card.details ? NAME_GAP + textHeight(card.details, DETAIL_FONT_SIZE) : 0) +
		CARD_PAD_BOTTOM +
		// A name alone sits centered, with room for Excalidraw's bound-text check.
		(card.details ? 0 : 4);
	// The canvas checks a bound label at 1.35 lines per font size, 18 px of padding included.
	const boundCheck = (card: Card) =>
		card.details
			? Math.ceil(lineCount(card.details) * DETAIL_FONT_SIZE * 1.35) + 18
			: Math.ceil(lineCount(card.name) * NAME_FONT_SIZE * 1.35) +
				18 +
				(card.avatar ? AVATAR_SIZE + AVATAR_GAP : 0);
	const teams = new Map<string, Card[]>();
	for (const card of cards.values()) {
		const team = `${card.person.manager ?? `top:${card.person.id}`}:${card.person.assistant === true}`;
		teams.set(team, [...(teams.get(team) ?? []), card]);
	}
	for (const team of teams.values()) {
		const height = Math.ceil(
			Math.max(40, ...team.map((card) => Math.max(natural(card), boundCheck(card)))),
		);
		for (const card of team) card.height = height;
	}
	return cards;
}

function buildTrees(
	diagram: OrgChartDiagram,
	cards: ReadonlyMap<string, Card>,
	regions: ReadonlyMap<string, string>,
): OrgTreeNode[] {
	const reports = orgChartReports(diagram);
	const build = (person: OrgPerson): OrgTreeNode => {
		const card = cards.get(person.id)!;
		const region = regions.get(person.id);
		const own = reports.get(person.id) ?? [];
		return {
			id: person.id,
			width: card.width,
			height: card.height,
			reports: own.filter((report) => report.assistant !== true).map(build),
			assistants: own.filter((report) => report.assistant === true).map(build),
			...(region === undefined
				? {}
				: { region: { label: region, nameWidth: canvasFrameNameWidth(region) } }),
		};
	};
	return orgChartRoots(diagram).map(build);
}

/** A card's outline, its name and details, and its avatar, grouped so they move as one. */
function cardElements(
	card: Card,
	rect: OrgRect,
	background: string,
	frameId: string | undefined,
): { nodes: NodeSceneElement[]; texts: TextSceneElement[] } {
	const { person } = card;
	const composition = {
		groupIds: [`person:${person.id}`],
		...(frameId ? { frameId } : {}),
	};
	const outline: NodeSceneElement = {
		type: "node",
		id: `node:${person.id}`,
		nodeId: person.id,
		kind: person.assistant ? "assistant" : "person",
		shape: "rectangle",
		...rect,
		label: person.name,
		strokeColor: card.color,
		strokeWidth: 2,
		fillColor: tint(card.color, background, 0.13),
		fillStyle: "solid",
		...composition,
	};
	const nodes = [outline];
	const texts: TextSceneElement[] = [];
	const centerX = rect.x + rect.width / 2;
	const textMax = rect.width - 2 * CARD_PAD_X;
	if (card.avatar)
		nodes.push({
			type: "node",
			id: `node:${person.id}:avatar`,
			nodeId: `${person.id}:avatar`,
			kind: "avatar",
			shape: "ellipse",
			x: centerX - AVATAR_SIZE / 2,
			y: rect.y + CARD_PAD_TOP,
			width: AVATAR_SIZE,
			height: AVATAR_SIZE,
			label: orgPersonInitials(person.name),
			strokeColor: card.color,
			strokeWidth: 1,
			fillColor: tint(card.color, background, 0.32),
			fillStyle: "solid",
			...composition,
		});
	if (card.details) {
		// The details sit where Excalidraw puts bottom-aligned bound text; the name stands above them.
		const detailsHeight = textHeight(card.details, DETAIL_FONT_SIZE);
		const detailsTop = rect.y + rect.height - CARD_PAD_BOTTOM - detailsHeight;
		texts.push({
			type: "text",
			id: `label:${person.id}`,
			containerId: outline.id,
			x: centerX,
			y: detailsTop + detailsHeight / 2,
			text: card.details,
			fontSize: DETAIL_FONT_SIZE,
			lineHeight: LINE_HEIGHT,
			maxWidth: textMax,
			verticalAlign: "bottom",
			textColor: DETAIL_COLOR,
			...composition,
		});
		const nameHeight = textHeight(card.name, NAME_FONT_SIZE);
		texts.push({
			type: "text",
			id: `text:${person.id}:name`,
			x: centerX,
			y: detailsTop - NAME_GAP - nameHeight / 2,
			text: card.name,
			fontSize: NAME_FONT_SIZE,
			lineHeight: LINE_HEIGHT,
			maxWidth: Math.ceil(estimateTextWidth(card.name, NAME_FONT_SIZE)),
			textColor: SKETCHI_DIAGRAM_PALETTE.ink,
			...composition,
		});
	} else {
		const nameHeight = textHeight(card.name, NAME_FONT_SIZE);
		const bottom = card.avatar;
		texts.push({
			type: "text",
			id: `label:${person.id}`,
			containerId: outline.id,
			x: centerX,
			y: bottom
				? rect.y + rect.height - CARD_PAD_BOTTOM - nameHeight / 2
				: rect.y + rect.height / 2,
			text: card.name,
			fontSize: NAME_FONT_SIZE,
			lineHeight: LINE_HEIGHT,
			maxWidth: textMax,
			...(bottom ? { verticalAlign: "bottom" as const } : {}),
			textColor: SKETCHI_DIAGRAM_PALETTE.ink,
			...composition,
		});
	}
	return { nodes, texts };
}

const toRouteBox = (rect: OrgRect, grow = 0) => ({
	left: rect.x - grow,
	top: rect.y - grow,
	right: rect.x + rect.width + grow,
	bottom: rect.y + rect.height + grow,
});

/**
 * Where a dotted line may leave or reach a card: the middle of either side
 * and a quarter in from either end of its top and bottom, skipping any point a
 * solid line already uses.
 */
function cardPorts(rect: OrgRect, taken: readonly OrgPoint[], entering: boolean): RoutePort[] {
	const { x, y, width, height } = rect;
	const candidates: { x: number; y: number; outward: 0 | 1 | 2 | 3; cost: number }[] = [
		{ x: x + width, y: y + height / 2, outward: 0, cost: 0 },
		{ x, y: y + height / 2, outward: 2, cost: 0 },
		{ x: x + width, y: y + height / 4, outward: 0, cost: 4 },
		{ x, y: y + height / 4, outward: 2, cost: 4 },
		{ x: x + (3 * width) / 4, y: y + height, outward: 1, cost: 6 },
		{ x: x + width / 4, y: y + height, outward: 1, cost: 6 },
		{ x: x + (3 * width) / 4, y, outward: 3, cost: 6 },
		{ x: x + width / 4, y, outward: 3, cost: 6 },
	];
	return candidates
		.filter(
			(port) =>
				!taken.some((point) => Math.abs(point.x - port.x) + Math.abs(point.y - port.y) < 14),
		)
		.map((port) => ({
			x: port.x,
			y: port.y,
			// A route enters its target traveling inward, against the side's outward direction.
			direction: (entering ? (port.outward + 2) % 4 : port.outward) as 0 | 1 | 2 | 3,
			cost: port.cost,
		}));
}

/** How many times a route crosses the lines drawn before it. */
function routeCrossings(points: readonly RoutePoint[], routed: readonly RouteSegment[]): number {
	let crossings = 0;
	for (const run of routeSegments(points)) {
		const horizontal = Math.abs(run.to.y - run.from.y) < 0.01;
		for (const other of routed) {
			const otherHorizontal = Math.abs(other.to.y - other.from.y) < 0.01;
			if (horizontal === otherHorizontal) continue;
			const [across, along] = horizontal ? [run, other] : [other, run];
			const x = along.from.x;
			const y = across.from.y;
			if (
				x > Math.min(across.from.x, across.to.x) + 0.5 &&
				x < Math.max(across.from.x, across.to.x) - 0.5 &&
				y > Math.min(along.from.y, along.to.y) + 0.5 &&
				y < Math.max(along.from.y, along.to.y) - 0.5
			)
				crossings += 1;
		}
	}
	return crossings;
}

/** What a reader pays to follow a route: its length, a bend's worth per turn and more per crossing. */
function routeCost(points: readonly RoutePoint[], routed: readonly RouteSegment[]): number {
	const runs = routeSegments(points);
	return (
		24 * Math.max(0, runs.length - 1) +
		runs.reduce(
			(length, run) => length + Math.abs(run.to.x - run.from.x) + Math.abs(run.to.y - run.from.y),
			0,
		) +
		HIERARCHY_CROSSING_COST * routeCrossings(points, routed)
	);
}

/**
 * A last resort when no search finds a clear route: one straight dashed line
 * from the report's outline to the manager's, drawn under the cards it passes.
 */
function straightRoute(from: OrgRect, to: OrgRect): RoutePoint[] {
	const center = (rect: OrgRect) => ({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 });
	const [a, b] = [center(from), center(to)];
	// Where the line between the centers leaves a card: its nearest crossing of the outline.
	const exit = (rect: OrgRect, toward: RoutePoint, away: RoutePoint) => {
		const dx = toward.x - away.x;
		const dy = toward.y - away.y;
		const scale = Math.min(
			dx === 0 ? Infinity : rect.width / 2 / Math.abs(dx),
			dy === 0 ? Infinity : rect.height / 2 / Math.abs(dy),
		);
		return { x: away.x + dx * scale, y: away.y + dy * scale };
	};
	return [exit(from, b, a), exit(to, a, b)];
}

interface TextRect {
	readonly left: number;
	readonly top: number;
	readonly right: number;
	readonly bottom: number;
}

const rectsMeet = (a: TextRect, b: TextRect, gap: number) =>
	a.left < b.right + gap &&
	b.left < a.right + gap &&
	a.top < b.bottom + gap &&
	b.top < a.bottom + gap;

/** Whether a run passes within `gap` of a box. */
function runMeets(from: RoutePoint, to: RoutePoint, box: TextRect, gap: number): boolean {
	return rectsMeet(
		{
			left: Math.min(from.x, to.x),
			right: Math.max(from.x, to.x),
			top: Math.min(from.y, to.y),
			bottom: Math.max(from.y, to.y),
		},
		box,
		gap,
	);
}

/**
 * Route every dotted-line report clear of the cards it does not join, the
 * regions neither end sits in and every region name, never along a solid line
 * or an earlier dotted one, and with `detours`, around the hierarchy rather than
 * across it where it can; each label beside its line and never over a card.
 * `straight` counts the lines no search routed.
 */
function dottedElements(
	diagram: OrgChartDiagram,
	rects: ReadonlyMap<string, OrgRect>,
	frames: readonly FrameSceneElement[],
	frameOf: ReadonlyMap<string, string>,
	links: readonly ArrowSceneElement[],
	detours: boolean,
): { arrows: ArrowSceneElement[]; labels: TextSceneElement[]; straight: number } {
	if (diagram.dottedLines.length === 0) return { arrows: [], labels: [], straight: 0 };
	const taken = new Map<string, OrgPoint[]>();
	for (const link of links) {
		const first = link.points[0];
		const last = link.points.at(-1)!;
		taken.set(link.sourceNodeId, [...(taken.get(link.sourceNodeId) ?? []), first]);
		taken.set(link.targetNodeId, [...(taken.get(link.targetNodeId) ?? []), last]);
	}
	const routed: RouteSegment[] = links.flatMap((link) => routeSegments(link.points));
	const edgesY = [...rects.values()].flatMap((rect) => [rect.y, rect.y + rect.height]);
	const lanesFor = (offsets: readonly number[]) =>
		[...rects.values()].flatMap((rect) =>
			offsets.flatMap((offset) => [rect.y - offset, rect.y + rect.height + offset]),
		);
	// The middle of every gap between a card and the next one below it, as in a stack.
	const cards = [...rects.values()];
	const gaps = cards.flatMap((upper) => {
		const below = cards
			.filter(
				(lower) =>
					lower.y >= upper.y + upper.height &&
					lower.x < upper.x + upper.width &&
					upper.x < lower.x + lower.width,
			)
			.map((lower) => lower.y);
		return below.length === 0 ? [] : [(upper.y + upper.height + Math.min(...below)) / 2];
	});
	const names = frames.map((frame) => canvasFrameNameBox(frame));
	// Above each region's name and below each region, and around the whole chart, so a
	// line can always go around what it cannot pass.
	const highest = Math.min(...edgesY, ...names.map((name) => name.y));
	const lowest = Math.max(...edgesY, ...frames.map((frame) => frame.y + frame.height));
	const around = [
		...names.map((name) => name.y - 10),
		...frames.flatMap((frame) => [frame.y + frame.height + 14, frame.y + frame.height + 24]),
		highest - 24,
		lowest + 24,
	];
	const lanes = [...lanesFor(LANE_OFFSETS), ...gaps, ...around];
	const denseLanes = [...lanesFor([...LANE_OFFSETS, ...DENSE_LANE_OFFSETS]), ...gaps, ...around];
	const top = highest - 60 - 10 * diagram.dottedLines.length;
	const bottom = lowest + 60;
	const reach = {
		left: Math.min(...cards.map((rect) => rect.x), ...frames.map((frame) => frame.x)) - 60,
		right:
			Math.max(
				...cards.map((rect) => rect.x + rect.width),
				...frames.map((frame) => frame.x + frame.width),
			) + 60,
	};
	const budget = {
		remaining: Math.min(DOTTED_BUDGET, diagram.dottedLines.length * DOTTED_BUDGET_PER_LINE),
	};
	const arrows: ArrowSceneElement[] = [];
	const labels: TextSceneElement[] = [];
	const placedLabels: TextRect[] = [];
	/** Lines that went over the chart, each on a lane of its own, and those drawn straight. */
	let overs = 0;
	let straight = 0;
	const outlines = frames.flatMap((frame) =>
		routeSegments([
			{ x: frame.x, y: frame.y },
			{ x: frame.x + frame.width, y: frame.y },
			{ x: frame.x + frame.width, y: frame.y + frame.height },
			{ x: frame.x, y: frame.y + frame.height },
			{ x: frame.x, y: frame.y },
		]),
	);
	const coversCard = (rect: TextRect) =>
		cards.some((card) => rectsMeet(rect, toRouteBox(card), 0)) ||
		names.some((name) => rectsMeet(rect, toRouteBox(name), 0));
	/**
	 * Where a label sits beside its route: by the longest run it fits beside, clear of cards,
	 * lines, regions and other labels, on one line or balanced onto two or three to fit.
	 */
	const labelSpot = (label: string, points: readonly RoutePoint[]) => {
		const runs = routeSegments(points).toSorted(
			(a, b) =>
				Math.abs(b.to.x - b.from.x) +
				Math.abs(b.to.y - b.from.y) -
				(Math.abs(a.to.x - a.from.x) + Math.abs(a.to.y - a.from.y)),
		);
		const allRuns = [...routed, ...routeSegments(points)];
		// Covering a card or a name reads worst, crossing a line least.
		const collisions = (rect: TextRect) =>
			100 * cards.filter((card) => rectsMeet(rect, toRouteBox(card), 4)).length +
			100 * names.filter((name) => rectsMeet(rect, toRouteBox(name), 2)).length +
			10 * outlines.filter((run) => runMeets(run.from, run.to, rect, 3)).length +
			10 * placedLabels.filter((other) => rectsMeet(rect, other, 4)).length +
			allRuns.filter((run) => runMeets(run.from, run.to, rect, 3)).length;
		const singleWidth = estimateTextWidth(label, DOTTED_LABEL_FONT_SIZE);
		const forms = [1, 2, 3].map((lines) => {
			const text =
				lines === 1
					? label
					: balancedWrap(
							label,
							Math.ceil(singleWidth / lines) + DOTTED_LABEL_FONT_SIZE,
							DOTTED_LABEL_FONT_SIZE,
						);
			// Measured as the region check reads free text: its wrapped box at 1.35 lines.
			const width = wrappedLabelWidth(
				text,
				DOTTED_LABEL_FONT_SIZE,
				Math.ceil(estimateTextWidth(text, DOTTED_LABEL_FONT_SIZE)),
			);
			return { text, width, height: Math.ceil(lineCount(text) * DOTTED_LABEL_FONT_SIZE * 1.35) };
		});
		// Along each run, nearest its middle first, on either side.
		const candidates = forms.flatMap(({ text, width, height }, form) =>
			runs.flatMap((run) => {
				const horizontal = Math.abs(run.to.y - run.from.y) < 0.01;
				return [0.5, 0.3, 0.7, 0.15, 0.85].flatMap((share) => {
					const at = {
						x: run.from.x + (run.to.x - run.from.x) * share,
						y: run.from.y + (run.to.y - run.from.y) * share,
					};
					return [6, 14, 30, 50, 80].flatMap((offset) =>
						(horizontal
							? [-1, 1].map((side) => ({
									left: at.x - width / 2,
									right: at.x + width / 2,
									top: side < 0 ? at.y - offset - height : at.y + offset,
									bottom: side < 0 ? at.y - offset : at.y + offset + height,
								}))
							: [1, -1].map((side) => ({
									left: side > 0 ? at.x + offset : at.x - offset - width,
									right: side > 0 ? at.x + offset + width : at.x - offset,
									top: at.y - height / 2,
									bottom: at.y + height / 2,
								}))
						).map((rect) => ({ text, width, rect, offset, form, score: collisions(rect) })),
					);
				});
			}),
		);
		// The spot touching the fewest cards, lines and labels; of those, the nearest its line,
		// then on the fewest lines.
		const spot = candidates.reduce((best, candidate) =>
			candidate.score < best.score ||
			(candidate.score === best.score &&
				(candidate.offset < best.offset ||
					(candidate.offset === best.offset && candidate.form < best.form)))
				? candidate
				: best,
		);
		return { text: spot.text, width: spot.width, rect: spot.rect, covers: coversCard(spot.rect) };
	};
	/** A label's spot above everything drawn so far, centered on `x`. */
	const aboveChart = (
		spot: ReturnType<typeof labelSpot>,
		x: number,
		points: readonly RoutePoint[],
	): ReturnType<typeof labelSpot> => {
		const bottom =
			Math.min(
				highest,
				...placedLabels.map((rect) => rect.top),
				...[...routed, ...routeSegments(points)].flatMap((run) => [run.from.y, run.to.y]),
			) - 8;
		const height = spot.rect.bottom - spot.rect.top;
		return {
			...spot,
			rect: { left: x - spot.width / 2, right: x + spot.width / 2, top: bottom - height, bottom },
			covers: false,
		};
	};
	for (const [index, line] of diagram.dottedLines.entries()) {
		const from = rects.get(line.report)!;
		const to = rects.get(line.manager)!;
		const ends = new Set([frameOf.get(line.report), frameOf.get(line.manager)]);
		const inside =
			frameOf.get(line.report) === frameOf.get(line.manager) ? frameOf.get(line.report) : undefined;
		// Cards and unrelated regions, then region outlines a line may cross but never run
		// along, and keep a line between two people of one region inside it. Only a line
		// no search finds under those keeps closer to cards and may follow an outline.
		const obstaclesFor = (clearance: number, outlines: boolean): RouteObstacle[] => [
			...[...rects].map(([id, rect]) => ({
				box: toRouteBox(rect),
				clearance,
				...(id === line.report || id === line.manager ? { own: true } : {}),
			})),
			...names.map((name) => ({
				box: toRouteBox(name),
				clearance: 2,
			})),
			...frames
				.filter((frame) => !ends.has(frame.id))
				.map((frame) => ({
					box: toRouteBox(frame),
					clearance: Math.min(clearance, FRAME_CLEARANCE),
				})),
			...frames
				.filter((frame) => outlines || inside === frame.id)
				.flatMap((frame) =>
					[
						{ ...frame, height: 0 },
						{ ...frame, y: frame.y + frame.height, height: 0 },
						{ ...frame, width: 0 },
						{ ...frame, x: frame.x + frame.width, width: 0 },
					].map((edge) => ({
						box: toRouteBox(edge),
						clearance: GROUP_OUTLINE_CLEARANCE,
						...(inside === frame.id ? {} : { parallel: true }),
					})),
				),
		];
		// The search keeps to the lanes it is given, so it runs through the open channels
		// alone and through every lane, and the plainer route wins.
		const sources = cardPorts(from, taken.get(line.report) ?? [], false);
		const targets = cardPorts(to, taken.get(line.manager) ?? [], true);
		const ends2 = [from, to];
		const near = [
			...around,
			...lanes.filter((y) =>
				ends2.some((rect) => y > rect.y - 120 && y < rect.y + rect.height + 120),
			),
		];
		const search = (
			obstacles: RouteObstacle[],
			grids: readonly { lanes: number[]; denseLanes: number[] }[],
			ports: { sources: RoutePort[]; targets: RoutePort[] } = { sources, targets },
			goAround = false,
		) =>
			grids
				.flatMap((grid) => {
					const own = { remaining: Math.min(budget.remaining, ROUTE_BUDGET) };
					const found = routeOrthogonal({
						...ports,
						obstacles,
						...grid,
						routed,
						top,
						bottom,
						reach,
						// The way around searches the whole chart and pays a reporting line's crossing in full,
						// whichever way it heads.
						...(goAround
							? { wide: true, crossingCost: HIERARCHY_CROSSING_COST, backCrossingFactor: 1 }
							: {}),
						budget: own,
					});
					budget.remaining -= Math.min(budget.remaining, ROUTE_BUDGET) - own.remaining;
					return found ? [simplifyPolyline(found)] : [];
				})
				.reduce<RoutePoint[] | undefined>(
					(best, route) =>
						!best || routeCost(route, routed) < routeCost(best, routed) ? route : best,
					undefined,
				);
		const through =
			search(obstaclesFor(CARD_CLEARANCE, true), [
				{ lanes: [...gaps, ...around], denseLanes: lanes },
				{ lanes, denseLanes },
			]) ??
			// A line across the whole chart searches a sparser grid: the lanes near its ends,
			// and those around the regions and the chart.
			search(obstaclesFor(CARD_CLEARANCE, true), [{ lanes: near, denseLanes: near }]) ??
			search(obstaclesFor(RELAXED_CLEARANCE, false), [{ lanes: denseLanes, denseLanes }]);
		// The searches near its ends find the way through; when that crosses the hierarchy, one
		// over the whole chart looks for a way around, while the lines still to route keep their
		// share of the budget.
		const linesLeft = diagram.dottedLines.length - 1 - index;
		const detour =
			detours &&
			through &&
			routeCrossings(through, routed) > 0 &&
			budget.remaining >= ROUTE_BUDGET + linesLeft * DOTTED_BUDGET_PER_LINE
				? search(
						obstaclesFor(CARD_CLEARANCE, true),
						[{ lanes: [...gaps, ...around], denseLanes: lanes }],
						undefined,
						true,
					)
				: undefined;
		const searched =
			detour && through && routeCost(detour, routed) < routeCost(through, routed)
				? detour
				: through;
		// Past every search, a line across the chart goes over it: up out of the report's
		// subtree to a lane above everything, along it, and down into the manager's.
		const over = (): RoutePoint[] | undefined => {
			// Its run along the lane joins two searches unchecked, so the lane lies above every line.
			const y = Math.min(
				highest - 24 - 10 * overs,
				...routed.flatMap((run) => [run.from.y - 10, run.to.y - 10]),
			);
			const columns = (rect: OrgRect, direction: 1 | 3): RoutePort[] =>
				[0, -1, 1, -2, 2, -4, 4].map((step) => ({
					x: rect.x + rect.width / 2 + step * 48,
					y,
					direction,
					cost: Math.abs(step) * 8,
				}));
			const grid = [{ lanes: [...near, y], denseLanes: [...near, y] }];
			const up = search(obstaclesFor(CARD_CLEARANCE, true), grid, {
				sources,
				targets: columns(from, 3),
			});
			const down =
				up &&
				search(obstaclesFor(CARD_CLEARANCE, true), grid, {
					sources: columns(to, 1),
					targets,
				});
			return up && down ? simplifyPolyline([...up, ...down]) : undefined;
		};
		const overRoute = searched ? undefined : over();
		if (overRoute) overs += 1;
		if (!searched && !overRoute) straight += 1;
		let points = simplifyPolyline(searched ?? overRoute ?? straightRoute(from, to)).map(
			({ x, y }) => ({ x, y }),
		);
		const label = line.label?.trim();
		let spot = label === undefined ? undefined : labelSpot(label, points);
		// A label never covers a card. Where no spot beside the route is clear of every card
		// and region name, the line goes over the chart instead, whose top run always has room.
		if (
			label !== undefined &&
			spot?.covers &&
			!overRoute &&
			budget.remaining >= ROUTE_BUDGET + linesLeft * DOTTED_BUDGET_PER_LINE
		) {
			const overInstead = over();
			const overSpot = overInstead && labelSpot(label, overInstead);
			if (overInstead && overSpot && !overSpot.covers) {
				overs += 1;
				points = overInstead.map(({ x, y }) => ({ x, y }));
				spot = overSpot;
			}
		}
		// Past that, it sits above the whole chart, over where its line starts.
		if (spot?.covers) spot = aboveChart(spot, points[0]!.x, points);
		routed.push(...routeSegments(points));
		taken.set(line.report, [...(taken.get(line.report) ?? []), points[0]!]);
		taken.set(line.manager, [...(taken.get(line.manager) ?? []), points.at(-1)!]);
		arrows.push({
			type: "arrow",
			id: `edge:dotted:${line.id}`,
			edgeId: `dotted:${line.id}`,
			sourceNodeId: line.report,
			targetNodeId: line.manager,
			points: points as [OrgPoint, ...OrgPoint[]],
			startArrowhead: null,
			endArrowhead: "arrow",
			strokeColor: DOTTED_COLOR,
			strokeStyle: "dashed",
			strokeWidth: 2,
			roughness: 0,
		});
		if (spot === undefined) continue;
		placedLabels.push(spot.rect);
		labels.push({
			type: "text",
			id: `text:dotted:${line.id}`,
			x: (spot.rect.left + spot.rect.right) / 2,
			y: (spot.rect.top + spot.rect.bottom) / 2,
			text: spot.text,
			fontSize: DOTTED_LABEL_FONT_SIZE,
			lineHeight: LINE_HEIGHT,
			maxWidth: spot.width,
			textColor: DOTTED_COLOR,
		});
	}
	return { arrows, labels, straight };
}

/**
 * Render an org chart top-down: one card per person with their name, title
 * and department, managers above the reports their bus line feeds, many leaf
 * reports stacked in one or two columns, assistants beside their manager,
 * dotted-line reports dashed with a head at the second manager, and, when
 * grouping, each department below the top in a region of its own.
 */
export function renderOrgChartDiagram(input: OrgChartDiagram): RenderedDiagramScene {
	const diagram = validateOrgChartDiagram(input);
	const regions = regionRoots(diagram);
	const cards = measureCards(diagram, regions);
	const layout = layoutOrgChart(buildTrees(diagram, cards, regions));
	const background = diagram.style.backgroundColor;
	const at = (rect: OrgRect): OrgRect => ({ ...rect, x: rect.x + PADDING, y: rect.y + PADDING });
	const rects = new Map([...layout.cards].map(([id, rect]) => [id, at(rect)]));
	const frames: FrameSceneElement[] = layout.regions.map((region) => ({
		type: "frame",
		id: `frame:${region.root}`,
		name: region.label,
		...at(region.frame),
	}));
	const frameOf = new Map(
		layout.regions.flatMap((region) =>
			region.members.map((member) => [member, `frame:${region.root}`] as const),
		),
	);
	const drawn = diagram.people.map((person) =>
		cardElements(cards.get(person.id)!, rects.get(person.id)!, background, frameOf.get(person.id)),
	);
	const links: ArrowSceneElement[] = layout.links.map((link) => {
		const points = link.points.map((point) => ({ x: point.x + PADDING, y: point.y + PADDING }));
		// A line wholly inside a region moves with it.
		const frameId =
			frameOf.get(link.manager) !== undefined &&
			frameOf.get(link.manager) === frameOf.get(link.report)
				? frameOf.get(link.report)
				: undefined;
		return {
			type: "arrow",
			id: `edge:${link.report}`,
			edgeId: link.report,
			sourceNodeId: link.manager,
			targetNodeId: link.report,
			points: points as [OrgPoint, ...OrgPoint[]],
			startArrowhead: null,
			endArrowhead: null,
			strokeColor: LINE_COLOR,
			strokeWidth: 2,
			roughness: 0,
			...(frameId ? { frameId } : {}),
		};
	});
	// A line going around the hierarchy never costs a later one its route.
	const around = dottedElements(diagram, rects, frames, frameOf, links, true);
	const dotted =
		around.straight === 0
			? around
			: ([dottedElements(diagram, rects, frames, frameOf, links, false)].find(
					(through) => through.straight < around.straight,
				) ?? around);
	const elements: SceneElement[] = [
		...frames,
		...links,
		...dotted.arrows,
		...drawn.flatMap((card) => card.nodes),
		...drawn.flatMap((card) => card.texts),
		...dotted.labels,
	];
	const corners = elements.flatMap((element): OrgPoint[] => {
		if (element.type === "arrow") return [...element.points];
		if (element.type === "text") {
			if (element.containerId) return [];
			const half = (element.maxWidth ?? 0) / 2;
			const tall = (lineCount(element.text) * element.fontSize * LINE_HEIGHT) / 2;
			return [
				{ x: element.x - half, y: element.y - tall },
				{ x: element.x + half, y: element.y + tall },
			];
		}
		if (element.type === "node" || element.type === "frame")
			return [
				{ x: element.x, y: element.y },
				{ x: element.x + element.width, y: element.y + element.height },
			];
		return [];
	});
	const nameTops = frames.map((frame) => canvasFrameNameBox(frame).y);
	const minX = Math.min(...corners.map((point) => point.x));
	const minY = Math.min(...corners.map((point) => point.y), ...nameTops);
	// Dotted lines may route above or left of the cards; keep the padding on every side.
	const dx = Math.max(0, Math.ceil(PADDING - minX));
	const dy = Math.max(0, Math.ceil(PADDING - minY));
	const moved =
		dx === 0 && dy === 0
			? elements
			: elements.map((element): SceneElement => {
					if (element.type === "arrow")
						return {
							...element,
							points: element.points.map((point) => ({ x: point.x + dx, y: point.y + dy })) as [
								OrgPoint,
								...OrgPoint[],
							],
						};
					if (element.type === "line") return element;
					return { ...element, x: element.x + dx, y: element.y + dy };
				});
	return {
		kind: "canvas",
		version: CANVAS_SPEC_VERSION,
		diagramId: diagram.id,
		title: diagram.title,
		width: Math.ceil(Math.max(...corners.map((point) => point.x)) + dx + PADDING),
		height: Math.ceil(Math.max(...corners.map((point) => point.y)) + dy + PADDING),
		accentColor: diagram.style.accentColor,
		backgroundColor: background,
		elements: moved,
		layers: [],
		layouts: [],
		zOrder: moved.map((element) => element.id),
	};
}

/** The placement an org chart renders with, before padding: its cards, lines, regions and search. */
export function layoutOrgChartDiagram(input: OrgChartDiagram): OrgLayout {
	const diagram = validateOrgChartDiagram(input);
	const regions = regionRoots(diagram);
	return layoutOrgChart(buildTrees(diagram, measureCards(diagram, regions), regions));
}
