import { estimateTextWidth } from "@sketchi/diagram-core";

import type {
	LineSceneElement,
	NodeSceneElement,
	RenderedDiagramScene,
	ScenePoint,
	TextSceneElement,
} from "./scene.js";

interface Box {
	readonly left: number;
	readonly top: number;
	readonly right: number;
	readonly bottom: number;
}

export interface JourneyReadStage {
	readonly index: number;
	readonly name: string;
	readonly box: Box;
	/** Headers of the stage's later parts, when it runs on into later bands. */
	readonly continued: readonly Box[];
}

export interface JourneyReadStep {
	readonly stage: number;
	readonly index: number;
	readonly label: string;
	/** The actor and touchpoint line at the card's foot. */
	readonly details: string | undefined;
	readonly box: Box;
	/** The face's center and the score its label states, or undefined when no face is drawn. */
	readonly face:
		| {
				readonly center: ScenePoint;
				readonly score: number;
				readonly mouth: number;
				/** The score printed above the face, or undefined when none is. */
				readonly written: number | undefined;
		  }
		| undefined;
}

export interface JourneyReadNote {
	readonly kind: "pain-point" | "opportunity";
	readonly stage: number;
	readonly index: number;
	readonly text: string;
	readonly box: Box;
}

/** What a journey's scene draws, read back from its elements. */
export interface JourneyReadout {
	readonly stages: readonly JourneyReadStage[];
	readonly steps: readonly JourneyReadStep[];
	readonly notes: readonly JourneyReadNote[];
	/** Each band's curve through its faces, in order. */
	readonly curves: readonly (readonly ScenePoint[])[];
	/** Each band's neutral baseline. */
	readonly baselines: readonly number[];
	/** Each band's level labels, 1 through 5: where each score's faces must sit. */
	readonly levels: readonly (readonly number[])[];
}

export interface JourneyLayoutIssue {
	readonly code:
		| "boxes-overlap"
		| "text-outside-box"
		| "card-off-stage"
		| "note-off-stage"
		| "face-off-step"
		| "face-off-score"
		| "face-wrong-expression"
		| "curve-off-faces"
		| "curve-leaves-row"
		| "curve-through-text"
		| "rule-through-text"
		| "score-misprinted"
		| "stages-out-of-order";
	readonly elementId: string;
	readonly message: string;
}

const LINE_HEIGHT = 1.25;
/** Boxes closer than this read as touching. */
const GAP = 4;

const boxOf = (element: { x: number; y: number; width: number; height: number }): Box => ({
	left: element.x,
	top: element.y,
	right: element.x + element.width,
	bottom: element.y + element.height,
});

/** The box a text paints: its stored width and wrapped lines, centered on its position. */
function textBox(text: TextSceneElement): Box {
	const width = Math.max(text.maxWidth ?? 0, estimateTextWidth(text.text, text.fontSize));
	const height = text.text.split("\n").length * text.fontSize * (text.lineHeight ?? LINE_HEIGHT);
	return {
		left: text.x - width / 2,
		top: text.y - height / 2,
		right: text.x + width / 2,
		bottom: text.y + height / 2,
	};
}

const meets = (a: Box, b: Box, gap: number) =>
	a.left < b.right + gap &&
	b.left < a.right + gap &&
	a.top < b.bottom + gap &&
	b.top < a.bottom + gap;
const inside = (inner: Box, outer: Box, margin = 0) =>
	inner.left >= outer.left + margin - 0.5 &&
	inner.right <= outer.right - margin + 0.5 &&
	inner.top >= outer.top + margin - 0.5 &&
	inner.bottom <= outer.bottom - margin + 0.5;
const flat = (text: string | undefined) => text?.replace(/\s*\n\s*/gu, " ").trim();

/** Read a journey's stages, step cards, faces, notes, curves and baselines from its scene. */
export function readJourneyScene(scene: RenderedDiagramScene): JourneyReadout {
	const byId = new Map(scene.elements.map((element) => [element.id, element]));
	const text = (id: string) => {
		const element = byId.get(id);
		return element?.type === "text" ? element.text : undefined;
	};
	const nodes = scene.elements.filter(
		(element): element is NodeSceneElement => element.type === "node",
	);
	const continued = nodes.filter((node) => node.kind === "journey-stage-continued");
	const stages = nodes
		.filter((node) => node.kind === "journey-stage")
		.map((node) => {
			const index = Number(node.nodeId.split(":").at(-1));
			return {
				index,
				name: flat(text(`label:${node.id.slice("node:".length)}`)) ?? node.label,
				box: boxOf(node),
				continued: continued
					.filter((part) => Number(part.nodeId.split(":").at(-1)!.split("-")[0]) === index)
					.map(boxOf)
					.toSorted((a, b) => a.top - b.top),
			};
		});
	const steps = nodes
		.filter((node) => node.kind === "journey-step")
		.map((node): JourneyReadStep => {
			const key = node.nodeId.split(":").at(-1)!;
			const [stage, index] = key.split("-").map(Number) as [number, number];
			const face = byId.get(`node:journey:face:${key}`);
			const mouth = byId.get(`line:journey:face:${key}:mouth`);
			const score = face?.type === "node" ? /\((\d+)\)$/u.exec(face.label)?.[1] : undefined;
			const written = text(`text:journey:score:${key}`);
			return {
				stage,
				index,
				label: flat(text(`label:${node.nodeId}`)) ?? node.label,
				details: flat(text(`text:${node.nodeId}:details`)),
				box: boxOf(node),
				face:
					face?.type === "node" && score !== undefined
						? {
								center: { x: face.x + face.width / 2, y: face.y + face.height / 2 },
								score: Number(score),
								// How far the mouth's middle sits below its corners: positive smiles, negative frowns.
								mouth:
									mouth?.type === "line" && mouth.points.length === 3
										? mouth.points[1].y - (mouth.points[0].y + mouth.points[2]!.y) / 2
										: 0,
								written:
									written !== undefined && /^\d+$/u.test(written.trim())
										? Number(written)
										: undefined,
							}
						: undefined,
			};
		})
		.toSorted((a, b) => a.stage - b.stage || a.index - b.index);
	const notes = nodes
		.filter((node) => node.kind === "journey-pain-point" || node.kind === "journey-opportunity")
		.map((node): JourneyReadNote => {
			const [stage, index] = node.nodeId.split(":").at(-1)!.split("-").map(Number) as [
				number,
				number,
			];
			return {
				kind: node.kind === "journey-pain-point" ? "pain-point" : "opportunity",
				stage,
				index,
				text: flat(text(`label:${node.nodeId}`)) ?? node.label,
				box: boxOf(node),
			};
		})
		.toSorted(
			(a, b) =>
				Number(a.kind === "opportunity") - Number(b.kind === "opportunity") ||
				a.stage - b.stage ||
				a.index - b.index,
		);
	// Lines by band: a band of one step has a baseline but no curve. A rule broken around
	// text keeps its id on its first stretch and numbers the rest.
	const lines = (prefix: string) => {
		const byBand: LineSceneElement[] = [];
		for (const element of scene.elements)
			if (element.type === "line" && element.id.startsWith(prefix)) {
				const band = Number(element.id.slice(prefix.length).split(":")[0]);
				byBand[band] ??= element;
			}
		return byBand;
	};
	const levels: number[][] = [];
	for (const element of scene.elements) {
		const match = /^text:journey:level:(\d+):(\d+)$/u.exec(element.id);
		if (element.type !== "text" || !match) continue;
		(levels[Number(match[1])] ??= [])[Number(match[2]) - 1] = element.y;
	}
	return {
		stages: stages.toSorted((a, b) => a.index - b.index),
		steps,
		notes,
		curves: Array.from(lines("line:journey:curve:"), (line) => line?.points ?? []),
		baselines: lines("line:journey:baseline:").map((line) => line.points[0].y),
		levels,
	};
}

/** Points along Excalidraw's rounded line through `points` (a cardinal spline, as Rough.js draws it). */
export function journeyCurveSamples(points: readonly ScenePoint[], steps = 12): ScenePoint[] {
	const samples: ScenePoint[] = [];
	for (let index = 0; index + 1 < points.length; index += 1) {
		const p0 = points[Math.max(0, index - 1)]!;
		const p1 = points[index]!;
		const p2 = points[index + 1]!;
		const p3 = points[Math.min(points.length - 1, index + 2)]!;
		const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 };
		const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
		for (let step = 0; step <= steps; step += 1) {
			const t = step / steps;
			const u = 1 - t;
			samples.push({
				x: u * u * u * p1.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * p2.x,
				y: u * u * u * p1.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * p2.y,
			});
		}
	}
	return samples;
}

/**
 * How a journey's drawing reads: nothing overlaps, every text inside its box,
 * every card and note within its stage's column, stages in reading order,
 * each face centered under its step's card at its score's height (the same
 * height for the same score in a band, the baseline for neutral) with a mouth
 * that smiles, sets flat or frowns as its score says, and each band's curve
 * through its faces in order, inside its row.
 */
export function journeyLayoutIssues(scene: RenderedDiagramScene): JourneyLayoutIssue[] {
	const issues: JourneyLayoutIssue[] = [];
	const push = (code: JourneyLayoutIssue["code"], elementId: string, message: string) =>
		issues.push({ code, elementId, message });
	const read = readJourneyScene(scene);
	const nodes = scene.elements.filter(
		(element): element is NodeSceneElement =>
			element.type === "node" && element.kind !== "journey-eye",
	);
	const texts = scene.elements.filter(
		(element): element is TextSceneElement => element.type === "text",
	);
	// Every box and free text stands apart; a card's own texts and a face's own parts sit inside it.
	const free = texts.filter(
		(element) => element.containerId === undefined && !element.id.startsWith("text:journey:step:"),
	);
	const boxes = [
		...nodes.map((node) => ({ id: node.id, box: boxOf(node) })),
		...free.map((element) => ({ id: element.id, box: textBox(element) })),
	];
	for (const [index, entry] of boxes.entries())
		for (const other of boxes.slice(index + 1))
			if (
				meets(
					entry.box,
					other.box,
					entry.id.startsWith("text:") || other.id.startsWith("text:") ? 2 : GAP,
				)
			)
				push("boxes-overlap", entry.id, `"${entry.id}" and "${other.id}" overlap.`);
	const byId = new Map(scene.elements.map((element) => [element.id, element]));
	for (const element of texts) {
		// A card's details belong to it as much as its bound label does.
		const card = /^text:(journey:step:[^:]+):/u.exec(element.id)?.[1];
		const ownerId = element.containerId ?? (card === undefined ? undefined : `node:${card}`);
		const owner = ownerId === undefined ? undefined : byId.get(ownerId);
		if (owner?.type !== "node") continue;
		const box = boxOf(owner);
		const painted = estimateTextWidth(element.text, element.fontSize);
		const height = Math.ceil(element.text.split("\n").length * element.fontSize * 1.35);
		if (painted + 24 > owner.width + 0.5 || height + 18 > owner.height + 0.5)
			push("text-outside-box", element.id, `Text "${element.id}" does not fit "${owner.id}".`);
		if (element.containerId === undefined && !inside(textBox(element), box, 2))
			push("text-outside-box", element.id, `Text "${element.id}" leaves "${owner.id}".`);
	}
	// A card's details stand clear of its label.
	for (const step of read.steps) {
		const label = byId.get(`label:journey:step:${step.stage}-${step.index}`);
		const details = byId.get(`text:journey:step:${step.stage}-${step.index}:details`);
		if (label?.type !== "text" || details?.type !== "text") continue;
		const labelTop = label.verticalAlign === "top" ? step.box.top + 5 : textBox(label).top;
		const labelBox = {
			...textBox(label),
			top: labelTop,
			bottom: labelTop + label.text.split("\n").length * label.fontSize * LINE_HEIGHT,
		};
		if (meets(labelBox, textBox(details), 0))
			push(
				"boxes-overlap",
				details.id,
				`The details of step ${step.stage}-${step.index} touch its label.`,
			);
	}
	const stageOf = new Map(read.stages.map((stage) => [stage.index, stage]));
	// Every header, a stage's own and those of its later parts: they read left to right,
	// band by band down the page, each stage first under its own header.
	const headers = read.stages
		.flatMap((stage) => [
			{ stage: stage.index, box: stage.box, continued: false },
			...stage.continued.map((box) => ({ stage: stage.index, box, continued: true })),
		])
		.toSorted((a, b) => a.box.top - b.box.top || a.box.left - b.box.left);
	if (
		headers.some((header, index) =>
			index === 0
				? header.stage !== 0 || header.continued
				: header.continued
					? header.stage !== headers[index - 1]!.stage ||
						header.box.top <= headers[index - 1]!.box.top
					: header.stage !== headers[index - 1]!.stage + 1,
		)
	)
		push("stages-out-of-order", "journey", "The stages do not read in order.");
	const bandTops = [...new Set(headers.map((header) => header.box.top))].toSorted((a, b) => a - b);
	/** The header a card stands under: its stage's nearest above it. */
	const headerOf = (step: JourneyReadStep) =>
		headers
			.filter(
				(header) =>
					header.stage === step.stage &&
					header.box.bottom <= step.box.top &&
					step.box.left >= header.box.left - 0.5 &&
					step.box.right <= header.box.right + 0.5,
			)
			.at(-1);
	const bandOf = (step: JourneyReadStep) => {
		const header = headerOf(step);
		return header ? bandTops.indexOf(header.box.top) : -1;
	};
	for (const step of read.steps) {
		const id = `node:journey:step:${step.stage}-${step.index}`;
		const header = headerOf(step);
		const nextBand = bandTops.find((top) => top > (header?.box.top ?? Infinity));
		if (!header || (nextBand !== undefined && step.box.bottom > nextBand))
			push(
				"card-off-stage",
				id,
				`Step ${step.stage}-${step.index} sits outside its stage's column.`,
			);
		const previous = read.steps.find(
			(other) => other.stage === step.stage && other.index === step.index - 1,
		);
		if (
			previous &&
			(bandOf(previous) > bandOf(step) ||
				(bandOf(previous) === bandOf(step) && previous.box.right > step.box.left))
		)
			push(
				"card-off-stage",
				id,
				`Step ${step.stage}-${step.index} does not follow the step before it.`,
			);
		if (!step.face) {
			push("face-off-step", id, `Step ${step.stage}-${step.index} has no face.`);
			continue;
		}
		const center = (step.box.left + step.box.right) / 2;
		if (Math.abs(step.face.center.x - center) > 0.5 || step.face.center.y < step.box.bottom)
			push(
				"face-off-step",
				id,
				`The face of step ${step.stage}-${step.index} is not under its card.`,
			);
		if (step.face.written !== step.face.score)
			push(
				"score-misprinted",
				id,
				`Step ${step.stage}-${step.index} prints ${step.face.written ?? "no score"} beside a face for ${step.face.score}.`,
			);
		const level = read.levels[bandOf(step)]?.[step.face.score - 1];
		if (level === undefined || Math.abs(level - step.face.center.y) > 0.5)
			push(
				"face-off-score",
				`node:journey:face:${step.stage}-${step.index}`,
				`The face of step ${step.stage}-${step.index} sits off its level, ${step.face.score}.`,
			);
		const expected = step.face.score > 3 ? 1 : step.face.score < 3 ? -1 : 0;
		if (Math.sign(Math.round(step.face.mouth * 10)) !== expected)
			push(
				"face-wrong-expression",
				id,
				`The face of step ${step.stage}-${step.index} does not read as a score of ${step.face.score}.`,
			);
	}
	// Within a band, height follows score: the same score one height, the baseline for 3.
	for (const [band, baseline] of read.baselines.entries()) {
		const faces = read.steps.filter((step) => bandOf(step) === band && step.face);
		const pitches = new Set<number>();
		for (const step of faces) {
			const rise = baseline - step.face!.center.y;
			const levels = step.face!.score - 3;
			if (levels === 0) {
				if (Math.abs(rise) > 0.5)
					push(
						"face-off-score",
						`node:journey:face:${step.stage}-${step.index}`,
						`A neutral face of step ${step.stage}-${step.index} sits off the baseline.`,
					);
			} else if (rise / levels <= 0)
				push(
					"face-off-score",
					`node:journey:face:${step.stage}-${step.index}`,
					`The face of step ${step.stage}-${step.index} sits on the wrong side of the baseline.`,
				);
			else pitches.add(Math.round((rise / levels) * 10) / 10);
		}
		if (pitches.size > 1)
			push(
				"face-off-score",
				`line:journey:baseline:${band}`,
				`Band ${band}'s faces sit on uneven steps.`,
			);
		const curve = read.curves[band];
		const centers = faces.map((step) => step.face!.center);
		if (
			centers.length >= 2 &&
			(!curve ||
				curve.length === 0 ||
				curve.length !== centers.length ||
				curve.some(
					(point, index) =>
						Math.abs(point.x - centers[index]!.x) > 0.5 ||
						Math.abs(point.y - centers[index]!.y) > 0.5,
				))
		)
			push(
				"curve-off-faces",
				`line:journey:curve:${band}`,
				`Band ${band}'s curve misses its faces.`,
			);
		// The curve keeps between its band's cards and notes, clear of both.
		if (curve && curve.length > 0 && faces.length > 0) {
			const cardsBottom = Math.max(...faces.map((step) => step.box.bottom));
			const notesTop = Math.min(
				Infinity,
				...read.notes
					.filter(
						(note) => bandTops.indexOf(stageOf.get(note.stage)?.box.top ?? Number.NaN) === band,
					)
					.map((note) => note.box.top),
			);
			if (
				journeyCurveSamples(curve).some(
					(point) => point.y < cardsBottom + 4 || point.y > notesTop - 4,
				)
			)
				push(
					"curve-leaves-row",
					`line:journey:curve:${band}`,
					`Band ${band}'s curve leaves its row.`,
				);
		}
	}
	// No line runs through a text: not the curve, its dashed continuations, a level rule,
	// the baseline or a divider.
	const textBoxes = free.map((element) => ({ id: element.id, box: textBox(element) }));
	const through = (point: ScenePoint) =>
		textBoxes.find(
			({ box }) =>
				point.x > box.left - 1 &&
				point.x < box.right + 1 &&
				point.y > box.top - 1 &&
				point.y < box.bottom + 1,
		);
	for (const element of scene.elements) {
		if (element.type !== "line" || !element.id.startsWith("line:journey:")) continue;
		if (element.id.includes(":face:")) continue;
		const samples = element.id.startsWith("line:journey:curve:")
			? journeyCurveSamples(element.points)
			: element.points.slice(1).flatMap((to, index) => {
					const from = element.points[index]!;
					const steps = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / 2));
					return Array.from({ length: steps + 1 }, (_, step) => ({
						x: from.x + ((to.x - from.x) * step) / steps,
						y: from.y + ((to.y - from.y) * step) / steps,
					}));
				});
		const hit = samples.map(through).find((entry) => entry !== undefined);
		if (hit)
			push(
				/^line:journey:curve(-in|-out)?:/u.test(element.id)
					? "curve-through-text"
					: "rule-through-text",
				element.id,
				`"${element.id}" runs through "${hit.id}".`,
			);
	}
	for (const note of read.notes) {
		const stage = stageOf.get(note.stage);
		if (!stage || note.box.left < stage.box.left - 0.5 || note.box.right > stage.box.right + 0.5)
			push(
				"note-off-stage",
				`node:journey:${note.kind === "pain-point" ? "pain" : "opportunity"}:${note.stage}-${note.index}`,
				`A ${note.kind} of stage ${note.stage} sits outside its stage's column.`,
			);
	}
	return issues;
}
