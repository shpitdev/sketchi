import {
	CANVAS_LIMITS,
	CANVAS_SPEC_VERSION,
	estimateTextWidth,
	JOURNEY_MAX_SCORE,
	JOURNEY_MIN_SCORE,
	JOURNEY_NEUTRAL_SCORE,
	type JourneyDiagram,
	LONG_WORD_UNITS,
	journeySentiment,
	SKETCHI_DIAGRAM_PALETTE,
	textLineUnits,
	validateJourneyDiagram,
	wrapTextToWidth,
} from "@sketchi/diagram-core";

import { CHART_SERIES_COLORS } from "./chart.js";
import { breakRulesUnderText, type RuleBox } from "./scene-rules.js";
import type {
	LineSceneElement,
	NodeSceneElement,
	RenderedDiagramScene,
	SceneElement,
	ScenePoint,
	TextSceneElement,
} from "./scene.js";

export const JOURNEY_MARK_ROLE = "journey-mark";

/** A journey mark keeps its role only while it still reads as one: an unlabeled face part on its journey id. */
export function isStructurallyValidJourneyMark(element: {
	readonly id: string;
	readonly nodeId: string;
	readonly icon?: unknown;
}): boolean {
	return (
		element.nodeId.startsWith("journey:face:") &&
		element.id === `node:${element.nodeId}` &&
		element.icon === undefined
	);
}

const PADDING = 40;
const LINE_HEIGHT = 1.25;
/** The canvas checks a bound label at this line height, with 18 px of padding. */
const CHECK_LINE_HEIGHT = 1.35;
const TITLE_FONT = 20;
const SUBTITLE_FONT = 14;
const STAGE_FONT = 16;
const LABEL_FONT = 15;
const DETAIL_FONT = 13;
const NOTE_FONT = 13;
const ROW_FONT = 14;
const SCALE_FONT = 12;
const SCORE_FONT = 12;

const INK = SKETCHI_DIAGRAM_PALETTE.ink;
const MUTED_INK = "#4c4639";
const DETAIL_COLOR = "#5f574c";
const RULE_COLOR = "#d6cdbd";
const BASELINE_COLOR = "#a89d89";
/** The faint rules at scores 1, 2, 4 and 5; the dashed baseline marks 3. */
const LEVEL_COLOR = "#e9e2d5";
const CURVE_COLOR = "#4c4639";
const PAIN_COLOR = "#e34948";
const OPPORTUNITY_COLOR = "#1baf7a";
const PAIN_INK = "#b3261e";
const OPPORTUNITY_INK = "#0b6e4b";
/** Stages cycle through cool hues, so none reads as a pain point, an opportunity or a mood. */
const STAGE_COLORS = [CHART_SERIES_COLORS[0], CHART_SERIES_COLORS[6], CHART_SERIES_COLORS[4]];
/** A face's color by score, red through gray to green; its mouth says the same without color. */
const FACE_COLORS = ["#e34948", "#eb6834", "#a39a8a", "#1baf7a", "#008300"] as const;

/** Text keeps this far from a box's sides; Excalidraw's bound-text rules need 12. */
const BOX_PAD_X = 12;
/** Room below a card's details. */
const CARD_PAD_BOTTOM = 6;
const LABEL_GAP = 6;
/** Every card of a journey shares one width within these bounds; labels wrap whole. */
const CARD_MIN_WIDTH = 128;
const CARD_MAX_WIDTH = 220;
/** Cards narrow to fit a wide journey only while every label keeps to this many lines. */
const MAX_LABEL_LINES = 4;
const CARD_WIDTH_STEP = 4;
const STEP_GAP = 12;
const STAGE_GAP = 28;
const ROW_GAP = 14;
const NOTE_GAP = 8;
const BAND_GAP = 44;
const TITLE_GAP = 18;
const HEADER_MIN_HEIGHT = 40;
/** A face's diameter, and the rise of one score on the experience curve. */
const FACE_SIZE = 28;
/**
 * The rise of one score. The least leaves a face's printed score clear of the
 * level above, so no rule needs to break around it; a wide journey raises its
 * curve a step at a time before it wraps, so the map stays one band.
 */
const LEVEL_PITCHES = [34, 40, 46] as const;
/** Each face's score is printed this far above it, clear of the level above. */
const SCORE_GAP = 2;
const SCORE_HEIGHT = Math.ceil(SCORE_FONT * 1.25);
/** Above the top level, room for a 5's face and its printed score; below the bottom, for a 1's face. */
const EXPERIENCE_TOP_PAD = FACE_SIZE / 2 + SCORE_GAP + SCORE_HEIGHT + 4;
const EXPERIENCE_PAD = FACE_SIZE / 2 + 6;
const experienceHeight = (pitch: number) =>
	EXPERIENCE_TOP_PAD + EXPERIENCE_PAD + (JOURNEY_MAX_SCORE - JOURNEY_MIN_SCORE) * pitch;
/** The header column's labels keep this far from the first stage. */
const ROW_LABEL_GAP = 16;
/** Wider journeys wrap into bands of whole stages, so the map reads at this aspect or less. */
export const JOURNEY_MAX_ASPECT = 2.45;
/** The CLI's PNG ceiling in square units, with room for its 64-unit title banner. */
const MAX_AREA = 6_291_456;
const BANNER_HEIGHT = 64;

interface Measured {
	readonly text: string;
	readonly width: number;
	readonly height: number;
}

const lineCount = (text: string) => text.split("\n").length;
const textHeight = (text: string, fontSize: number) =>
	Math.ceil(lineCount(text) * fontSize * LINE_HEIGHT);
/** The height a box needs for its bound text to pass Excalidraw's and the canvas's checks. */
const boundHeight = (text: string, fontSize: number) =>
	Math.ceil(lineCount(text) * fontSize * CHECK_LINE_HEIGHT) + 18;

/** Wrap to the narrowest width that keeps the line count, so lines balance. */
function balancedWrap(text: string, maxWidth: number, fontSize: number): string {
	const wrapped = wrapToWidth(text, maxWidth, fontSize);
	if (lineCount(wrapped) === 1) return wrapped;
	// No line is narrower than the widest word, so the search starts there.
	const widestWord = Math.max(...text.split(" ").map((word) => (unitsOf(word) * fontSize) / 100));
	let low = Math.max(fontSize, Math.min(maxWidth, Math.floor(widestWord)) - 1);
	let high = maxWidth;
	while (high - low > 1) {
		const middle = Math.floor((low + high) / 2);
		if (lineCount(wrapToWidth(text, middle, fontSize)) <= lineCount(wrapped)) high = middle;
		else low = middle;
	}
	return wrapToWidth(text, high, fontSize);
}

/** Each word's advance, measured once per render. */
const wordUnits = new Map<string, number>();
const SPACE_UNITS = textLineUnits(" ");

function unitsOf(word: string): number {
	const known = wordUnits.get(word);
	if (known !== undefined) return known;
	const units = textLineUnits(word);
	wordUnits.set(word, units);
	return units;
}

/**
 * `wrapTextToWidth`, line for line, for a single line whose every word fits:
 * the same greedy breaks from word advances measured once, so trying many
 * widths stays cheap. Any other text takes the shared path.
 */
function wrapToWidth(text: string, maxWidth: number, fontSize: number): string {
	const maxUnits = Math.floor((maxWidth * 100) / fontSize + 1e-6);
	const words = text.split(" ");
	const units = words.map(unitsOf);
	// A Latin word wider than a line stays whole on a line of its own, as the shared wrap
	// keeps it; any other overlong word, a line break or a mark that would join the space
	// before it takes the shared path.
	if (
		text.includes("\n") ||
		/(^| )\p{M}/u.test(text) ||
		words.some(
			(word, index) =>
				units[index]! > maxUnits &&
				(units[index]! > LONG_WORD_UNITS || !/^[\u0021-\u007e\u00a1-\u024f]+$/u.test(word)),
		)
	)
		return wrapTextToWidth(text, maxWidth, fontSize);
	const total = units.reduce((sum, value) => sum + value, (words.length - 1) * SPACE_UNITS);
	if (total <= maxUnits) return text;
	const lines: string[] = [];
	let current = "";
	let currentUnits = 0;
	words.forEach((word, index) => {
		if (units[index]! > maxUnits) {
			if (current) lines.push(current);
			lines.push(word);
			current = "";
			currentUnits = 0;
			return;
		}
		const candidate = current ? currentUnits + SPACE_UNITS + units[index]! : units[index]!;
		if (candidate <= maxUnits) {
			current = current ? `${current} ${word}` : word;
			currentUnits = candidate;
			return;
		}
		lines.push(current);
		current = word;
		currentUnits = units[index]!;
	});
	if (current) lines.push(current);
	return lines.join("\n");
}

/** The widest run of a text that never wraps: a whole word, or a piece of an overlong one. */
const widestPiece = (text: string, fontSize: number) => measure(text, 1, fontSize).width;

/** Texts measured during one render: placement tries many widths, and most repeat. */
const measured = new Map<string, Measured>();

function measure(text: string, maxWidth: number, fontSize: number): Measured {
	const key = `${fontSize}|${maxWidth}|${text}`;
	const known = measured.get(key);
	if (known) return known;
	const wrapped = balancedWrap(text.trim(), maxWidth, fontSize);
	const result = {
		text: wrapped,
		width: Math.ceil(estimateTextWidth(wrapped, fontSize)),
		height: textHeight(wrapped, fontSize),
	};
	measured.set(key, result);
	return result;
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

const round = (value: number) => Math.round(value * 100) / 100;

/** A step's card text, measured at one card width. */
interface StepText {
	readonly label: Measured;
	readonly details: Measured | undefined;
}

/**
 * A step's actor and touchpoint under its label: on one line as `actor ·
 * touchpoint` when that fits, otherwise each on lines of its own.
 */
function stepDetails(
	step: JourneyDiagram["stages"][number]["steps"][number],
	textWidth: number,
): Measured | undefined {
	const parts = [step.actor, step.touchpoint]
		.map((part) => part?.trim())
		.filter((part): part is string => part !== undefined && part.length > 0);
	if (parts.length === 0) return undefined;
	const joined = parts.join(" · ");
	const oneLine = measure(joined, textWidth, DETAIL_FONT);
	if (parts.length === 1 || lineCount(oneLine.text) === 1) return oneLine;
	const text = parts.map((part) => measure(part, textWidth, DETAIL_FONT).text).join("\n");
	return {
		text,
		width: Math.ceil(estimateTextWidth(text, DETAIL_FONT)),
		height: textHeight(text, DETAIL_FONT),
	};
}

function stepTexts(diagram: JourneyDiagram, cardWidth: number): StepText[][] {
	const textWidth = cardWidth - 2 * BOX_PAD_X;
	return diagram.stages.map((stage) =>
		stage.steps.map((step) => ({
			label: measure(step.label, textWidth, LABEL_FONT),
			details: stepDetails(step, textWidth),
		})),
	);
}

/** Excalidraw's inset from a container's edge to its bound text. */
const BOUND_INSET = 5;

/**
 * One card height for the whole journey, so every row of cards reads as one:
 * the label bound to the card's top, the actor and touchpoint at its foot.
 */
function cardHeight(texts: readonly StepText[][]): number {
	return Math.max(
		48,
		...texts
			.flat()
			.map(({ label, details }) =>
				Math.max(
					boundHeight(label.text, LABEL_FONT),
					details ? BOUND_INSET + label.height + LABEL_GAP + details.height + CARD_PAD_BOTTOM : 0,
				),
			),
	);
}

/** Whether every card's words fit its text box: a longer word widens every card. */
function wordsFit(texts: readonly StepText[][], width: number): boolean {
	return texts
		.flat()
		.every(
			({ label, details }) =>
				label.width <= width - 2 * BOX_PAD_X &&
				(details === undefined || details.width <= width - 2 * BOX_PAD_X),
		);
}

/**
 * The card widths a journey may take: from the narrowest on which every label
 * keeps to MAX_LABEL_LINES, up to the narrowest on which no label or details
 * take more lines than on the widest card.
 */
function cardWidths(diagram: JourneyDiagram): { narrowest: number; needed: number } {
	const lines = (texts: StepText[][]) =>
		texts
			.flat()
			.map(
				({ label, details }) =>
					lineCount(label.text) * 10 + (details ? lineCount(details.text) : 0),
			);
	const widest = lines(stepTexts(diagram, CARD_MAX_WIDTH));
	let narrowest: number | undefined;
	for (let width = CARD_MIN_WIDTH; width < CARD_MAX_WIDTH; width += CARD_WIDTH_STEP) {
		const texts = stepTexts(diagram, width);
		if (!wordsFit(texts, width)) continue;
		if (
			narrowest === undefined &&
			texts.flat().every(({ label }) => lineCount(label.text) <= MAX_LABEL_LINES)
		)
			narrowest = width;
		if (lines(texts).every((count, index) => count <= widest[index]!))
			return { narrowest: narrowest ?? width, needed: width };
	}
	return { narrowest: narrowest ?? CARD_MAX_WIDTH, needed: CARD_MAX_WIDTH };
}

/** A run of one stage's steps in one band: the whole stage, or a part of one too long for any band. */
interface Segment {
	readonly stage: number;
	readonly from: number;
	readonly to: number;
}

/**
 * Contiguous runs of whole stages, `count` of them: the widest run as narrow
 * as it can be, then the runs as even as they can be, then earlier runs
 * fuller, so a short last band trails.
 */
function partitionStages(stepCounts: readonly number[], count: number): Segment[][] {
	// Steps count as columns; each stage boundary inside a run adds its wider gap.
	const width = (run: readonly number[]) =>
		run.reduce((total, stage) => total + stepCounts[stage]!, 0) +
		((run.length - 1) * STAGE_GAP) / (CARD_MIN_WIDTH + STEP_GAP);
	const stages = stepCounts.length;
	let best: { runs: number[][]; key: number[] } | undefined;
	// Every way to cut the stages into `count` runs: at most C(9, 4) = 126 for ten stages.
	const cuts = (from: number, left: number): number[][] =>
		left === 0
			? [[]]
			: Array.from({ length: stages - left - from + 1 }, (_, offset) => from + offset).flatMap(
					(cut) => cuts(cut + 1, left - 1).map((rest) => [cut, ...rest]),
				);
	for (const cut of cuts(1, count - 1)) {
		const bounds = [0, ...cut, stages];
		const runs = bounds
			.slice(1)
			.map((end, index) =>
				Array.from({ length: end - bounds[index]! }, (_, stage) => bounds[index]! + stage),
			);
		const widths = runs.map(width);
		const candidate = {
			runs,
			// Narrowest widest run, then the most even runs, then earlier runs fuller.
			key: [
				Math.max(...widths),
				widths.reduce((total, value) => total + value * value, 0),
				...widths.map((value) => -value),
			],
		};
		const order = best?.key.findIndex(
			(value, index) => Math.abs(value - candidate.key[index]!) > 1e-9,
		);
		if (!best || (order !== undefined && order >= 0 && candidate.key[order]! < best.key[order]!))
			best = candidate;
	}
	return best!.runs.map((run) => run.map((stage) => ({ stage, from: 0, to: stepCounts[stage]! })));
}

/**
 * Bands of about a `count`th of the steps each, filled in order with whole
 * stages; a stage longer than a band, or than the room left in one, splits at
 * the band's end and runs on in the next.
 */
function splitStages(stepCounts: readonly number[], count: number): Segment[][] {
	const total = stepCounts.reduce((sum, steps) => sum + steps, 0);
	const capacity = Math.max(1, Math.ceil(total / count));
	const bands: Segment[][] = [[]];
	let room = capacity;
	stepCounts.forEach((steps, stage) => {
		let from = 0;
		while (from < steps) {
			const left = steps - from;
			const band = bands.at(-1)!;
			if (left <= room) {
				band.push({ stage, from, to: steps });
				room -= left;
				from = steps;
			} else if (band.length > 0 && from === 0 && left <= capacity) {
				bands.push([]);
				room = capacity;
			} else {
				if (room > 0) {
					band.push({ stage, from, to: from + room });
					from += room;
				}
				bands.push([]);
				room = capacity;
			}
		}
	});
	return bands.filter((band) => band.length > 0);
}

interface StageColumn {
	readonly stage: number;
	/** The stage's first step in this column; past 0, the column continues the stage. */
	readonly from: number;
	readonly to: number;
	readonly x: number;
	readonly width: number;
	/** Left edge of each step's card. */
	readonly steps: readonly number[];
}

interface BandPlan {
	readonly stages: readonly StageColumn[];
	readonly right: number;
	/** One card height per band, so its row of cards reads as one. */
	readonly cardHeight: number;
	readonly headerHeight: number;
	readonly header: readonly Measured[];
	readonly pains: readonly (readonly Measured[])[];
	readonly opportunities: readonly (readonly Measured[])[];
	readonly painHeight: number;
	readonly opportunityHeight: number;
	readonly height: number;
}

interface Plan {
	readonly cardWidth: number;
	/** The rise of one score on the experience curve. */
	readonly pitch: number;
	/** How many elements the scene draws, at most. */
	readonly elements: number;
	/** Whether any card carries an actor or touchpoint. */
	readonly detailed: boolean;
	readonly texts: readonly StepText[][];
	readonly bands: readonly BandPlan[];
	readonly title: Measured;
	readonly subtitles: readonly Measured[];
	readonly headerColumn: number;
	readonly rowLabels: Readonly<
		Record<"steps" | "experience" | "pains" | "opportunities" | "continued", Measured>
	>;
	/** The experience row's level labels, 1 through 5. */
	readonly levels: readonly Measured[];
	readonly gridLeft: number;
	readonly top: number;
	readonly width: number;
	readonly height: number;
}

/** A stage column's header: its name, marked as continued past the stage's first band. */
const stageName = (diagram: JourneyDiagram, column: Pick<StageColumn, "stage" | "from">) =>
	column.from === 0
		? diagram.stages[column.stage]!.name.trim()
		: `${diagram.stages[column.stage]!.name.trim()} (continued)`;

/** A stack of notes, each in its own box as wide as its stage. */
function noteStack(notes: readonly string[] | undefined, width: number): Measured[] {
	return (notes ?? []).map((note) => {
		const text = measure(note, width - 2 * BOX_PAD_X, NOTE_FONT);
		return { ...text, height: boundHeight(text.text, NOTE_FONT) };
	});
}

const stackHeight = (notes: readonly Measured[]) =>
	notes.reduce((total, note) => total + note.height, 0) + Math.max(0, notes.length - 1) * NOTE_GAP;

function planJourney(
	diagram: JourneyDiagram,
	cardWidth: number,
	partition: readonly (readonly Segment[])[],
	pitch: number,
): Plan {
	const texts = stepTexts(diagram, cardWidth);
	const rowLabels = {
		steps: measure("Steps", 200, ROW_FONT),
		experience: measure("Experience", 200, ROW_FONT),
		pains: measure("Pain points", 200, ROW_FONT),
		opportunities: measure("Opportunities", 200, ROW_FONT),
		continued: measure("continued", 200, SCALE_FONT),
	};
	const levels = Array.from({ length: JOURNEY_MAX_SCORE - JOURNEY_MIN_SCORE + 1 }, (_, index) => {
		const level = JOURNEY_MIN_SCORE + index;
		return measure(
			level === JOURNEY_NEUTRAL_SCORE ? `${level} · Neutral` : `${level}`,
			200,
			SCALE_FONT,
		);
	});
	const anyPains = diagram.stages.some((stage) => (stage.painPoints?.length ?? 0) > 0);
	const anyOpportunities = diagram.stages.some((stage) => (stage.opportunities?.length ?? 0) > 0);
	const headerColumn =
		Math.max(
			rowLabels.steps.width,
			rowLabels.experience.width,
			...levels.map((level) => level.width),
			anyPains ? rowLabels.pains.width : 0,
			anyOpportunities ? rowLabels.opportunities.width : 0,
		) + ROW_LABEL_GAP;
	const gridLeft = PADDING + headerColumn;
	const bands = partition.map((segments): BandPlan => {
		let x = gridLeft;
		const stages = segments.map(({ stage, from, to }): StageColumn => {
			const count = to - from;
			const stepsWidth = count * cardWidth + (count - 1) * STEP_GAP;
			// A column is never narrower than its header's or its notes' widest word: a stage
			// wider than its steps centers them.
			const notes =
				from === 0
					? [
							...(diagram.stages[stage]!.painPoints ?? []),
							...(diagram.stages[stage]!.opportunities ?? []),
						]
					: [];
			const width = Math.max(
				stepsWidth,
				widestPiece(stageName(diagram, { stage, from }), STAGE_FONT) + 2 * BOX_PAD_X,
				...notes.map((note) => widestPiece(note, NOTE_FONT) + 2 * BOX_PAD_X),
			);
			const inset = (width - stepsWidth) / 2;
			const column = {
				stage,
				from,
				to,
				x,
				width,
				steps: Array.from({ length: count }, (_, index) =>
					round(x + inset + index * (cardWidth + STEP_GAP)),
				),
			};
			x += width + STAGE_GAP;
			return column;
		});
		const header = stages.map((column) =>
			measure(stageName(diagram, column), column.width - 2 * BOX_PAD_X, STAGE_FONT),
		);
		const headerHeight = Math.max(
			HEADER_MIN_HEIGHT,
			...header.map((name) => boundHeight(name.text, STAGE_FONT)),
		);
		// A stage's notes stand under its first column.
		const pains = stages.map((column) =>
			column.from === 0 ? noteStack(diagram.stages[column.stage]!.painPoints, column.width) : [],
		);
		const opportunities = stages.map((column) =>
			column.from === 0 ? noteStack(diagram.stages[column.stage]!.opportunities, column.width) : [],
		);
		const height = cardHeight(
			stages.map((column) => texts[column.stage]!.slice(column.from, column.to)),
		);
		const painHeight = Math.max(0, ...pains.map(stackHeight));
		const opportunityHeight = Math.max(0, ...opportunities.map(stackHeight));
		return {
			stages,
			right: x - STAGE_GAP,
			cardHeight: height,
			headerHeight,
			header,
			pains,
			opportunities,
			painHeight,
			opportunityHeight,
			height:
				headerHeight +
				ROW_GAP +
				height +
				ROW_GAP +
				experienceHeight(pitch) +
				(painHeight > 0 ? ROW_GAP + painHeight : 0) +
				(opportunityHeight > 0 ? ROW_GAP + opportunityHeight : 0),
		};
	});
	const gridRight = Math.max(...bands.map((band) => band.right));
	const contentWidth = gridRight - PADDING;
	const title = measure(diagram.title, Math.max(contentWidth, 360), TITLE_FONT);
	const subtitles = [
		diagram.persona === undefined ? undefined : `Persona: ${diagram.persona.trim()}`,
		diagram.actors === undefined || diagram.actors.length === 0
			? undefined
			: `Actors: ${diagram.actors.map((actor) => actor.trim()).join(", ")}`,
	]
		.filter((line): line is string => line !== undefined)
		.map((line) => measure(line, Math.max(contentWidth, 360), SUBTITLE_FONT));
	const top =
		PADDING +
		title.height +
		subtitles.reduce((total, line) => total + 4 + line.height, 0) +
		TITLE_GAP;
	const bandsHeight =
		bands.reduce((total, band) => total + band.height, 0) + (bands.length - 1) * BAND_GAP;
	// The scene's elements: every band repeats its row labels, scale and rules, so a
	// placement of many bands can outgrow the canvas's element limit.
	const steps = texts.flat();
	const elements =
		1 +
		subtitles.length +
		steps.reduce((total, text) => total + (text.details ? 8 : 7), 0) +
		2 *
			diagram.stages.reduce(
				(total, stage) =>
					total + (stage.painPoints?.length ?? 0) + (stage.opportunities?.length ?? 0),
				0,
			) +
		bands.reduce(
			(total, band, index) =>
				total +
				4 * band.stages.length +
				(band.painHeight > 0 ? 1 : 0) +
				(band.opportunityHeight > 0 ? 1 : 0) +
				(index > 0 ? 4 : 2) +
				(index < bands.length - 1 ? 1 : 0) +
				14,
			0,
		);
	return {
		cardWidth,
		pitch,
		elements,
		detailed: texts.flat().some((text) => text.details !== undefined),
		texts,
		bands,
		title,
		subtitles,
		headerColumn,
		rowLabels,
		levels,
		gridLeft,
		top,
		width: Math.ceil(
			Math.max(gridRight, PADDING + title.width, ...subtitles.map((line) => PADDING + line.width)) +
				PADDING,
		),
		height: Math.ceil(top + bandsHeight + PADDING),
	};
}

const aspectOf = (plan: Plan) => (plan.width - 2 * PADDING) / (plan.height - 2 * PADDING);
/** Whether a placement keeps to the canvas's element limit, the PNG ceiling and the readable aspect. */
const fits = (plan: Plan) =>
	plan.elements <= CANVAS_LIMITS.maxElements &&
	plan.width * (plan.height + BANNER_HEIGHT) <= MAX_AREA &&
	aspectOf(plan) <= JOURNEY_MAX_ASPECT;
/** Past this a fallback placement reads too tall: a column of bands no screen shows whole. */
const MIN_ASPECT = 0.8;
/**
 * When no placement fits, how far one misses: past the canvas's element limit
 * first, then past the PNG ceiling and the readable aspect (either way)
 * together, each relative to its bound.
 */
const excessOf = (plan: Plan): readonly [number, number] => [
	Math.max(0, plan.elements - CANVAS_LIMITS.maxElements),
	Math.max(0, plan.width * (plan.height + BANNER_HEIGHT) - MAX_AREA) / MAX_AREA +
		Math.max(0, aspectOf(plan) - JOURNEY_MAX_ASPECT) / JOURNEY_MAX_ASPECT +
		Math.max(0, MIN_ASPECT - aspectOf(plan)) / MIN_ASPECT,
];

/**
 * The journey's placement: every stage in one band when it reads at
 * JOURNEY_MAX_ASPECT or less, with cards no wider than their text needs,
 * narrowed while every label keeps to MAX_LABEL_LINES and then with a taller
 * curve before a band wraps; otherwise the fewest
 * bands of whole stages that read that narrow, all within the CLI's PNG
 * ceiling; failing that, the placement that overflows the ceiling least,
 * then reads nearest that aspect.
 */
function chooseJourneyPlan(diagram: JourneyDiagram): Plan {
	const { narrowest, needed } = cardWidths(diagram);
	const stepCounts = diagram.stages.map((stage) => stage.steps.length);
	const total = stepCounts.reduce((sum, steps) => sum + steps, 0);
	let nearest: { plan: Plan; excess: readonly [number, number] } | undefined;
	const tried = new Set<string>();
	const attempt = (partition: Segment[][], pitches: readonly number[]) => {
		const key = JSON.stringify(partition);
		if (tried.has(key)) return undefined;
		tried.add(key);
		for (const pitch of pitches)
			for (let width = needed; width >= narrowest; width -= CARD_WIDTH_STEP) {
				const plan = planJourney(diagram, width, partition, pitch);
				const excess = excessOf(plan);
				if (fits(plan)) return plan;
				if (
					!nearest ||
					excess[0] < nearest.excess[0] ||
					(excess[0] === nearest.excess[0] && excess[1] < nearest.excess[1])
				)
					nearest = { plan, excess };
			}
		return undefined;
	};
	for (let bands = 1; bands <= diagram.stages.length; bands += 1) {
		const plan = attempt(
			partitionStages(stepCounts, bands),
			bands === 1 ? LEVEL_PITCHES : LEVEL_PITCHES.slice(0, 1),
		);
		if (plan) return plan;
	}
	// A stage too long for any band splits across bands, its header marked as continued.
	for (let bands = 2; bands <= total; bands += 1) {
		const plan = attempt(splitStages(stepCounts, bands), LEVEL_PITCHES.slice(0, 1));
		if (plan) return plan;
	}
	return nearest!.plan;
}

/** Where a score sits on a band's experience row: 5 at the top, 1 at the bottom. */
function scoreY(experienceTop: number, score: number, pitch: number): number {
	return experienceTop + EXPERIENCE_TOP_PAD + (JOURNEY_MAX_SCORE - score) * pitch;
}

/** A face: its circle, two eyes and a mouth that smiles, sets flat or frowns with the score. */
function faceElements(
	id: string,
	center: ScenePoint,
	score: number,
	background: string,
): { nodes: NodeSceneElement[]; mouth: LineSceneElement } {
	const color = FACE_COLORS[score - JOURNEY_MIN_SCORE]!;
	const groupIds = [`journey:face:${id}`];
	const radius = FACE_SIZE / 2;
	const eye = (side: "left" | "right", dx: number): NodeSceneElement => ({
		type: "node",
		id: `node:journey:face:${id}:eye-${side}`,
		nodeId: `journey:face:${id}:eye-${side}`,
		kind: "journey-eye",
		rendererRole: JOURNEY_MARK_ROLE,
		shape: "ellipse",
		x: round(center.x + dx - 2),
		y: round(center.y - 6),
		width: 4,
		height: 4,
		label: `${side} eye`,
		strokeColor: INK,
		strokeWidth: 1,
		fillColor: INK,
		fillStyle: "solid",
		roughness: 0,
		groupIds,
	});
	const sentiment = journeySentiment(score);
	// Corners and middle of the mouth: the middle dips for a smile and rises for a frown.
	const bend = (score - JOURNEY_NEUTRAL_SCORE) * 2.5;
	const mouthY = center.y + 5 - bend / 2;
	const mouth: LineSceneElement = {
		type: "line",
		id: `line:journey:face:${id}:mouth`,
		points:
			bend === 0
				? [
						{ x: round(center.x - 5.5), y: round(mouthY) },
						{ x: round(center.x + 5.5), y: round(mouthY) },
					]
				: [
						{ x: round(center.x - 6), y: round(mouthY) },
						{ x: round(center.x), y: round(mouthY + bend) },
						{ x: round(center.x + 6), y: round(mouthY) },
					],
		strokeColor: INK,
		strokeWidth: 2,
		roughness: 0,
		groupIds,
	};
	return {
		nodes: [
			{
				type: "node",
				id: `node:journey:face:${id}`,
				nodeId: `journey:face:${id}`,
				kind: "journey-face",
				rendererRole: JOURNEY_MARK_ROLE,
				shape: "ellipse",
				x: round(center.x - radius),
				y: round(center.y - radius),
				width: FACE_SIZE,
				height: FACE_SIZE,
				label: `${sentiment} (${score})`,
				strokeColor: color,
				strokeWidth: 2,
				fillColor: tint(color, background, 0.4),
				fillStyle: "solid",
				roughness: 0,
				groupIds,
			},
			eye("left", -4.5),
			eye("right", 4.5),
		],
		mouth,
	};
}

/** A free text, centered on `x` and `y`, `textAlign` within its own measured box. */
function freeText(
	id: string,
	text: Measured,
	x: number,
	y: number,
	fontSize: number,
	color: string,
	extra: Partial<TextSceneElement> = {},
): TextSceneElement {
	return {
		type: "text",
		id,
		x: round(x),
		y: round(y),
		text: text.text,
		fontSize,
		lineHeight: LINE_HEIGHT,
		maxWidth: text.width,
		textColor: color,
		...extra,
	};
}

/**
 * Render a user journey map: stages as colored headers across the top, each
 * step's card under its stage in reading order, an experience curve through a
 * face per step at its score (5 at the top, 1 at the bottom) over a dashed
 * neutral baseline, and each stage's pain points and opportunities in rows
 * beneath it. A journey too wide to read at JOURNEY_MAX_ASPECT narrows its
 * cards, then wraps into bands of whole stages, one under another.
 */
export function renderJourneyDiagram(input: JourneyDiagram): RenderedDiagramScene {
	const diagram = validateJourneyDiagram(input);
	measured.clear();
	wordUnits.clear();
	const plan = chooseJourneyPlan(diagram);
	measured.clear();
	wordUnits.clear();
	const background = diagram.style.backgroundColor;
	const back: SceneElement[] = [];
	const shapes: SceneElement[] = [];
	const marks: SceneElement[] = [];
	const texts: TextSceneElement[] = [];

	let y = PADDING;
	texts.push(
		freeText(
			"text:journey:title",
			plan.title,
			PADDING + plan.title.width / 2,
			y + plan.title.height / 2,
			TITLE_FONT,
			INK,
			{ textAlign: "left" },
		),
	);
	y += plan.title.height;
	plan.subtitles.forEach((line, index) => {
		y += 4;
		texts.push(
			freeText(
				`text:journey:subtitle:${index}`,
				line,
				PADDING + line.width / 2,
				y + line.height / 2,
				SUBTITLE_FONT,
				MUTED_INK,
				{ textAlign: "left" },
			),
		);
		y += line.height;
	});

	const scores = diagram.stages.flatMap((stage) => stage.steps.map((step) => step.score));
	/** Where each printed score sits: the level rules and baseline break around them. */
	const scoreBoxes: RuleBox[] = [];
	let bandTop = plan.top;
	plan.bands.forEach((band, bandIndex) => {
		const rowLabel = (key: string, label: Measured, top: number, color: string) =>
			texts.push(
				freeText(
					`text:journey:row:${bandIndex}:${key}`,
					label,
					PADDING + label.width / 2,
					top + label.height / 2,
					ROW_FONT,
					color,
					{ textAlign: "left" },
				),
			);
		const cardsTop = bandTop + band.headerHeight + ROW_GAP;
		const experienceTop = cardsTop + band.cardHeight + ROW_GAP;
		const painTop = experienceTop + experienceHeight(plan.pitch) + ROW_GAP;
		const opportunityTop = painTop + (band.painHeight > 0 ? band.painHeight + ROW_GAP : 0);
		const bandBottom = bandTop + band.height;
		rowLabel("steps", plan.rowLabels.steps, cardsTop + BOUND_INSET, MUTED_INK);
		rowLabel("experience", plan.rowLabels.experience, experienceTop + 2, MUTED_INK);
		if (bandIndex > 0)
			texts.push(
				freeText(
					`text:journey:continued:${bandIndex}`,
					plan.rowLabels.continued,
					PADDING + plan.rowLabels.continued.width / 2,
					experienceTop +
						4 +
						plan.rowLabels.experience.height +
						plan.rowLabels.continued.height / 2,
					SCALE_FONT,
					DETAIL_COLOR,
					{ textAlign: "left" },
				),
			);
		const baselineY = scoreY(experienceTop, JOURNEY_NEUTRAL_SCORE, plan.pitch);
		// The scale at the row's left, a label per level; faint rules mark every level but
		// neutral, whose dashed baseline runs on its own.
		plan.levels.forEach((label, index) => {
			const level = JOURNEY_MIN_SCORE + index;
			const y = round(scoreY(experienceTop, level, plan.pitch));
			texts.push(
				freeText(
					`text:journey:level:${bandIndex}:${level}`,
					label,
					plan.gridLeft - ROW_LABEL_GAP + 4 - label.width / 2,
					y,
					SCALE_FONT,
					DETAIL_COLOR,
					{ textAlign: "right" },
				),
			);
			if (level !== JOURNEY_NEUTRAL_SCORE)
				back.push({
					type: "line",
					id: `line:journey:level:${bandIndex}:${level}`,
					points: [
						{ x: plan.gridLeft, y },
						{ x: band.right, y },
					],
					strokeColor: LEVEL_COLOR,
					strokeWidth: 1,
					roughness: 0,
				});
		});
		if (band.painHeight > 0) rowLabel("pain-points", plan.rowLabels.pains, painTop + 9, PAIN_INK);
		if (band.opportunityHeight > 0)
			rowLabel("opportunities", plan.rowLabels.opportunities, opportunityTop + 9, OPPORTUNITY_INK);
		back.push({
			type: "line",
			id: `line:journey:baseline:${bandIndex}`,
			points: [
				{ x: plan.gridLeft, y: baselineY },
				{ x: band.right, y: baselineY },
			],
			strokeColor: BASELINE_COLOR,
			strokeStyle: "dashed",
			strokeWidth: 1,
			roughness: 0,
		});
		band.stages.forEach((column, position) => {
			if (position === 0) return;
			const x = column.x - STAGE_GAP / 2;
			back.push({
				type: "line",
				id: `line:journey:divider:${column.stage}`,
				points: [
					{ x, y: cardsTop },
					{ x, y: bandBottom },
				],
				strokeColor: RULE_COLOR,
				strokeWidth: 1,
				roughness: 0,
			});
		});
		const curve: ScenePoint[] = [];
		band.stages.forEach((column, position) => {
			const stage = diagram.stages[column.stage]!;
			const color = STAGE_COLORS[column.stage % STAGE_COLORS.length]!;
			// A stage that runs on from the band above repeats its header, marked as continued.
			const headerId =
				column.from === 0
					? `journey:stage:${column.stage}`
					: `journey:stage-continued:${column.stage}-${column.from}`;
			shapes.push({
				type: "node",
				id: `node:${headerId}`,
				nodeId: headerId,
				kind: column.from === 0 ? "journey-stage" : "journey-stage-continued",
				shape: "rectangle",
				x: column.x,
				y: bandTop,
				width: column.width,
				height: band.headerHeight,
				label: stageName(diagram, column),
				strokeColor: color,
				strokeWidth: 2,
				fillColor: tint(color, background, 0.22),
				fillStyle: "solid",
			});
			texts.push({
				type: "text",
				id: `label:${headerId}`,
				containerId: `node:${headerId}`,
				x: round(column.x + column.width / 2),
				y: round(bandTop + band.headerHeight / 2),
				text: band.header[position]!.text,
				fontSize: STAGE_FONT,
				lineHeight: LINE_HEIGHT,
				maxWidth: column.width - 2 * BOX_PAD_X,
				textColor: INK,
			});
			stage.steps.slice(column.from, column.to).forEach((step, offset) => {
				const index = column.from + offset;
				const id = `${column.stage}-${index}`;
				const stepId = `journey:step:${id}`;
				const left = column.steps[offset]!;
				const centerX = left + plan.cardWidth / 2;
				const { label, details } = plan.texts[column.stage]![index]!;
				const groupIds = [stepId];
				shapes.push({
					type: "node",
					id: `node:${stepId}`,
					nodeId: stepId,
					kind: "journey-step",
					shape: "rectangle",
					x: left,
					y: cardsTop,
					width: plan.cardWidth,
					height: band.cardHeight,
					label: step.label.trim(),
					strokeColor: color,
					strokeWidth: 1,
					fillColor: tint(color, background, 0.07),
					fillStyle: "solid",
					groupIds,
				});
				const textMax = plan.cardWidth - 2 * BOX_PAD_X;
				// The label is the card's own text. Where any card carries details, every label
				// stands at its card's top, so the row reads level; the details sit at the foot.
				texts.push({
					type: "text",
					id: `label:${stepId}`,
					containerId: `node:${stepId}`,
					x: round(centerX),
					y: round(
						plan.detailed
							? cardsTop + BOUND_INSET + label.height / 2
							: cardsTop + band.cardHeight / 2,
					),
					text: label.text,
					fontSize: LABEL_FONT,
					lineHeight: LINE_HEIGHT,
					maxWidth: textMax,
					...(plan.detailed ? { verticalAlign: "top" as const } : {}),
					textColor: INK,
					groupIds,
				});
				if (details)
					texts.push(
						freeText(
							`text:${stepId}:details`,
							details,
							centerX,
							cardsTop + band.cardHeight - CARD_PAD_BOTTOM - details.height / 2,
							DETAIL_FONT,
							DETAIL_COLOR,
							{ groupIds },
						),
					);
				const center = {
					x: round(centerX),
					y: round(scoreY(experienceTop, step.score, plan.pitch)),
				};
				curve.push(center);
				const face = faceElements(id, center, step.score, background);
				marks.push(...face.nodes, face.mouth);
				// The score itself, just above its face and grouped with it, so a 4 reads apart from a 5.
				const written = measure(`${step.score}`, 40, SCORE_FONT);
				const writtenY = center.y - FACE_SIZE / 2 - SCORE_GAP - written.height / 2;
				texts.push(
					freeText(`text:journey:score:${id}`, written, center.x, writtenY, SCORE_FONT, INK, {
						groupIds: [`journey:face:${id}`],
					}),
				);
				scoreBoxes.push({
					left: center.x - written.width / 2,
					top: writtenY - written.height / 2,
					right: center.x + written.width / 2,
					bottom: writtenY + written.height / 2,
				});
			});
			const notes = (
				kind: "pain" | "opportunity",
				stack: readonly Measured[],
				top: number,
				stroke: string,
			) => {
				let noteTop = top;
				stack.forEach((note, index) => {
					const noteId = `journey:${kind}:${column.stage}-${index}`;
					shapes.push({
						type: "node",
						id: `node:${noteId}`,
						nodeId: noteId,
						kind: kind === "pain" ? "journey-pain-point" : "journey-opportunity",
						shape: "rectangle",
						x: column.x,
						y: noteTop,
						width: column.width,
						height: note.height,
						label: (kind === "pain" ? stage.painPoints : stage.opportunities)![index]!.trim(),
						strokeColor: stroke,
						strokeWidth: 1,
						fillColor: tint(stroke, background, 0.1),
						fillStyle: "solid",
					});
					texts.push({
						type: "text",
						id: `label:${noteId}`,
						containerId: `node:${noteId}`,
						x: round(column.x + column.width / 2),
						y: round(noteTop + note.height / 2),
						text: note.text,
						fontSize: NOTE_FONT,
						lineHeight: LINE_HEIGHT,
						maxWidth: column.width - 2 * BOX_PAD_X,
						textColor: INK,
					});
					noteTop += note.height + NOTE_GAP;
				});
			};
			notes("pain", band.pains[position]!, painTop, PAIN_COLOR);
			notes("opportunity", band.opportunities[position]!, opportunityTop, OPPORTUNITY_COLOR);
		});
		if (curve.length >= 2)
			back.push({
				type: "line",
				id: `line:journey:curve:${bandIndex}`,
				points: [curve[0]!, curve[1]!, ...curve.slice(2)],
				strokeColor: CURVE_COLOR,
				strokeWidth: 2,
				roughness: 0,
			});
		// A wrapped curve runs on: dashed out of a band toward the next step's score, and
		// dashed into the next band from the last one's.
		const first = band.stages[0]!;
		const before =
			diagram.stages.slice(0, first.stage).reduce((total, stage) => total + stage.steps.length, 0) +
			first.from;
		const previous = scores[before - 1];
		const next = scores[before + curve.length];
		const stub = (id: string, from: ScenePoint, to: ScenePoint) =>
			back.push({
				type: "line",
				id: `line:journey:${id}:${bandIndex}`,
				points: [from, to],
				strokeColor: CURVE_COLOR,
				strokeStyle: "dashed",
				strokeWidth: 2,
				roughness: 0,
			});
		if (previous !== undefined)
			stub(
				"curve-in",
				{ x: plan.gridLeft, y: round(scoreY(experienceTop, previous, plan.pitch)) },
				curve[0]!,
			);
		if (next !== undefined)
			stub("curve-out", curve.at(-1)!, {
				x: band.right,
				y: round(scoreY(experienceTop, next, plan.pitch)),
			});
		bandTop = bandBottom + BAND_GAP;
	});

	// No rule runs through a printed score; rules and the curve sit behind the cards and
	// faces that stand on them.
	const broken = breakRulesUnderText(
		back,
		scoreBoxes,
		(id) => id.startsWith("line:journey:level:") || id.startsWith("line:journey:baseline:"),
	);
	const rules = back.flatMap((element) => broken.get(element.id) ?? [element]);
	const elements: SceneElement[] = [...rules, ...shapes, ...marks, ...texts];
	return {
		kind: "canvas",
		version: CANVAS_SPEC_VERSION,
		diagramId: diagram.id,
		title: diagram.title,
		width: plan.width,
		height: plan.height,
		accentColor: diagram.style.accentColor,
		backgroundColor: background,
		elements,
		layers: [],
		layouts: [],
		zOrder: elements.map((element) => element.id),
	};
}
