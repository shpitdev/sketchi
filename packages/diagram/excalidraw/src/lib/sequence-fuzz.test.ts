import { describe, expect, it } from "vitest";
import {
	getCanvasValidationIssues,
	parseSequenceDiagram,
	type SequenceDiagram,
	wrappedLabelWidth,
	wrapTextToWidth,
} from "@sketchi/diagram-core";
import {
	type ArrowSceneElement,
	type RenderedDiagramScene,
	renderSequenceDiagram,
} from "@sketchi/diagram-renderer";

import { convertSceneToExcalidraw, validateExcalidrawScene } from "./convert";

// CI samples a few diagrams; the local target runs the full matrix.
const COUNT = process.env["SEQUENCE_FUZZ"] === "full" ? 400 : 12;

const PARTICIPANTS = [
	"Browser",
	"Identity Provider",
	"API Worker",
	"Cache",
	"AuthenticationController",
	"支払いサービス",
	"Queue",
];
const LABELS = [
	"Retry",
	"Validate credentials",
	"Recompute the cached order totals",
	"Check the token signature, expiry and audience before trusting the claims",
	"Supercalifragilisticexpialidocious",
	"ValidateCredentialsToken",
	"再試行する",
	"Ship it 🚀",
	"GET /orders",
];

const UNBREAKABLE_LABELS = ["ValidateCredentialsToken", "Supercalifragilisticexpialidocious"];

/** A seeded random number source: a 32-bit LCG in exact integer arithmetic. */
function seeded(start: number) {
	let seed = start >>> 0;
	const random = () => {
		seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
		return seed / 4_294_967_296;
	};
	return {
		random,
		pick: <T>(values: readonly T[]) => values[Math.floor(random() * values.length)]!,
	};
}

/**
 * Seeded sequences mixing calls, answered returns, nested and re-entrant
 * activations, self-calls inside and outside a bar, self-returns, runs of
 * consecutive self-messages, and short, wrapping, unbreakable and CJK labels.
 * Every fourth sequence nests 12 to 19 calls into a participant with a
 * neighbour on its right before its self-messages, so their loops start far
 * right of its lifeline and their labels reach toward that neighbour.
 */
function randomSequences(count: number, start: number): SequenceDiagram[] {
	const { random, pick } = seeded(start);
	return Array.from({ length: count }, (_, run) => {
		const ids = Array.from({ length: 1 + Math.floor(random() * 6) }, (_, index) => `p${index}`);
		if (run % 4 === 3) return deepSequence(run, random, pick);
		const open: { caller: string; callee: string }[] = [];
		const messages = Array.from({ length: 1 + Math.floor(random() * 18) }, (_, index) => {
			const roll = random();
			const label = pick(LABELS);
			const id = `m${index}`;
			if (roll < 0.35 || ids.length === 1) {
				const self = pick(ids);
				return {
					id,
					source: self,
					target: self,
					label,
					...(roll < 0.05 ? { type: "return" } : {}),
				};
			}
			if (roll < 0.6 && open.length > 0) {
				const { caller, callee } = open.splice(Math.floor(random() * open.length), 1)[0]!;
				return { id, source: callee, target: caller, label, type: "return" };
			}
			const source = pick(ids);
			const target = pick(ids.filter((candidate) => candidate !== source));
			open.push({ caller: source, callee: target });
			return { id, source, target, label };
		});
		return parseSequenceDiagram({
			id: `sequence-fuzz-${run}`,
			title: "Sequence fuzz",
			type: "sequence",
			participants: ids.map((id) => ({ id, label: pick(PARTICIPANTS) })),
			messages,
		});
	});
}

/** Calls stacked into one participant, self-messages at the deepest point, then the returns. */
function deepSequence(
	run: number,
	random: () => number,
	pick: <T>(values: readonly T[]) => T,
): SequenceDiagram {
	const ids = Array.from({ length: 2 + Math.floor(random() * 3) }, (_, index) => `p${index}`);
	const deep = pick(ids.slice(0, -1));
	const callers = ids.filter((id) => id !== deep);
	const calls = Array.from({ length: 12 + Math.floor(random() * 8) }, (_, index) => ({
		id: `call${index}`,
		source: pick(callers),
		target: deep,
		label: pick(LABELS),
	}));
	const selves = Array.from({ length: 1 + Math.floor(random() * 2) }, (_, index) => ({
		id: `self${index}`,
		source: deep,
		target: deep,
		// The first is one of the widest labels, whole words that do not wrap.
		label: index === 0 ? pick(UNBREAKABLE_LABELS) : pick(LABELS),
		...(random() < 0.2 ? { type: "return" as const } : {}),
	}));
	const returns = calls.toReversed().map((call) => ({
		id: `reply-${call.id}`,
		source: deep,
		target: call.source,
		label: pick(LABELS),
		type: "return" as const,
	}));
	return parseSequenceDiagram({
		id: `sequence-fuzz-${run}`,
		title: "Deep sequence fuzz",
		type: "sequence",
		participants: ids.map((id) => ({ id, label: pick(PARTICIPANTS) })),
		messages: [...calls, ...selves, ...returns],
	});
}

interface Box {
	readonly left: number;
	readonly top: number;
	readonly right: number;
	readonly bottom: number;
}

const LABEL_CLEARANCE = 4;

function overlaps(a: Box, b: Box, margin = 0): boolean {
	return (
		a.left < b.right + margin &&
		b.left < a.right + margin &&
		a.top < b.bottom + margin &&
		b.top < a.bottom + margin
	);
}

function labelBox(center: { x: number; y: number }, label: string): Box {
	const text = wrapTextToWidth(label, 160, 13);
	const width = wrappedLabelWidth(text, 13, 160);
	const height = Math.ceil(text.split("\n").length * 13 * 1.35);
	return {
		left: center.x - width / 2,
		top: center.y - height / 2,
		right: center.x + width / 2,
		bottom: center.y + height / 2,
	};
}

/**
 * Where a message label paints: a self-message's free label at its own
 * position, any other label bound to its arrow's middle point or segment.
 */
function paintedLabel(scene: RenderedDiagramScene, arrow: ArrowSceneElement): Box {
	const free = scene.elements.find((element) => element.id === `${arrow.id}:label`);
	if (free?.type === "text") return labelBox(free, free.text);
	const { points } = arrow;
	const middle = Math.floor(points.length / 2);
	const center =
		points.length % 2 === 1
			? points[middle]!
			: {
					x: (points[middle - 1]!.x + points[middle]!.x) / 2,
					y: (points[middle - 1]!.y + points[middle]!.y) / 2,
				};
	return labelBox(center, arrow.label ?? "");
}

function segmentBoxes(points: readonly { x: number; y: number }[]): Box[] {
	return points.slice(1).map((point, index) => {
		const previous = points[index]!;
		return {
			left: Math.min(previous.x, point.x),
			top: Math.min(previous.y, point.y),
			right: Math.max(previous.x, point.x),
			bottom: Math.max(previous.y, point.y),
		};
	});
}

/**
 * Every way a self-message loop or its label collides with the rest of the
 * scene. A loop's label never touches any line: its own loop's three legs,
 * another message, a lifeline, a bar or a header.
 */
function selfMessageIssues(diagram: SequenceDiagram, scene: RenderedDiagramScene): string[] {
	const issues: string[] = [];
	const arrows = scene.elements.flatMap((element) => (element.type === "arrow" ? [element] : []));
	const nodes = scene.elements.flatMap((element) => (element.type === "node" ? [element] : []));
	const self = new Set(
		diagram.messages.flatMap((message) => (message.source === message.target ? [message.id] : [])),
	);
	const labels = new Map(arrows.map((arrow) => [arrow.edgeId, paintedLabel(scene, arrow)]));
	const lifelines = nodes.filter((node) => node.rendererRole === "sequence-lifeline");
	for (const arrow of arrows) {
		const label = labels.get(arrow.edgeId)!;
		for (const lifeline of lifelines) {
			const box = {
				left: lifeline.x,
				top: lifeline.y,
				right: lifeline.x + lifeline.width,
				bottom: lifeline.y + lifeline.height,
			};
			if (overlaps(label, box, LABEL_CLEARANCE)) {
				issues.push(`${diagram.id} ${arrow.edgeId} label sits on ${lifeline.id}`);
			}
		}
	}
	for (const loop of arrows.filter((arrow) => self.has(arrow.edgeId))) {
		const label = labels.get(loop.edgeId)!;
		const legs = segmentBoxes(loop.points);
		const name = `${diagram.id} ${loop.edgeId}`;
		if (loop.points.length !== 4) issues.push(`${name} is not a four-point loop`);
		if (label.right > scene.width || label.bottom > scene.height) {
			issues.push(`${name} label leaves the scene`);
		}
		for (const leg of legs) {
			if (overlaps(label, leg, LABEL_CLEARANCE)) issues.push(`${name} label touches its own loop`);
		}
		for (const node of nodes) {
			const box = {
				left: node.x,
				top: node.y,
				right: node.x + node.width,
				bottom: node.y + node.height,
			};
			if (overlaps(label, box, LABEL_CLEARANCE)) {
				issues.push(`${name} label overlaps ${node.id}`);
			}
			// The loop leaves and re-enters its own bars or lifeline at their edges.
			const owned =
				node.id === `node:${loop.sourceNodeId}` || node.id === `node:${loop.targetNodeId}`;
			if (!owned && overlaps(legs[1]!, box)) issues.push(`${name} loop crosses ${node.id}`);
		}
		for (const other of arrows.filter((arrow) => arrow !== loop)) {
			const otherLabel = labels.get(other.edgeId)!;
			if (overlaps(label, otherLabel, LABEL_CLEARANCE)) {
				issues.push(`${name} label overlaps ${other.edgeId}'s label`);
			}
			for (const segment of segmentBoxes(other.points)) {
				if (overlaps(label, segment, LABEL_CLEARANCE)) {
					issues.push(`${name} label touches ${other.edgeId}`);
				}
			}
			for (const segment of legs) {
				if (overlaps(otherLabel, segment, LABEL_CLEARANCE)) {
					issues.push(`${name} loop crosses ${other.edgeId}'s label`);
				}
				for (const crossing of segmentBoxes(other.points)) {
					if (overlaps(segment, crossing)) issues.push(`${name} loop touches ${other.edgeId}`);
				}
			}
		}
	}
	return issues;
}

describe("sequence self-message fuzz", () => {
	const diagrams = randomSequences(COUNT, 20261019);

	it("draws every self-message as a loop clear of other messages, labels, bars and lifelines", () => {
		let loops = 0;
		let nestedLoops = 0;
		let deepLoops = 0;
		for (const diagram of diagrams) {
			const scene = renderSequenceDiagram(diagram);
			expect(getCanvasValidationIssues(scene), diagram.id).toEqual([]);
			expect(selfMessageIssues(diagram, scene), diagram.id).toEqual([]);
			const loopArrows = scene.elements.filter(
				(element) => element.type === "arrow" && element.points.length === 4,
			);
			loops += loopArrows.length;
			nestedLoops += loopArrows.filter(
				(element) => element.type === "arrow" && element.sourceNodeId.includes(":activation:"),
			).length;
			// A loop that starts eight or more nesting steps right of its lifeline.
			deepLoops += loopArrows.filter((element) => {
				if (element.type !== "arrow") return false;
				const end = element.sourceNodeId.indexOf(":lifeline") + ":lifeline".length;
				const lifeline = scene.elements.find(
					(node) => node.id === `node:${element.sourceNodeId.slice(0, end)}`,
				);
				return lifeline?.type === "node" && element.points[0].x - lifeline.x >= 8 * 6;
			}).length;
		}
		// The generator must exercise loops, including ones deep inside active bars.
		expect(loops).toBeGreaterThan(COUNT);
		expect(nestedLoops).toBeGreaterThan(0);
		expect(deepLoops).toBeGreaterThan(0);
	});

	it("exports every diagram as a valid Excalidraw scene with each loop label grouped beside its loop", () => {
		for (const diagram of diagrams) {
			const rendered = renderSequenceDiagram(diagram);
			const scene = convertSceneToExcalidraw(rendered);
			expect(validateExcalidrawScene(scene), diagram.id).toEqual({ ok: true, issues: [] });
			for (const message of diagram.messages.filter((m) => m.source === m.target)) {
				const loop = rendered.elements.find(
					(element) => element.type === "arrow" && element.edgeId === message.id,
				);
				const label = scene.elements.find((element) => element.id === `arrow:${message.id}:label`);
				if (loop?.type !== "arrow" || !label) throw new Error(`Missing ${message.id}.`);
				const painted = paintedLabel(rendered, loop);
				const name = `${diagram.id} ${message.id}`;
				// Free text grouped with its loop, stored exactly where the scene places it.
				expect(label.containerId, name).toBeNull();
				expect(label.groupIds, name).toEqual(loop.groupIds);
				expect((label.x as number) + (label.width as number) / 2, name).toBeCloseTo(
					(painted.left + painted.right) / 2,
				);
				expect((label.y as number) + (label.height as number) / 2, name).toBeCloseTo(
					(painted.top + painted.bottom) / 2,
				);
				expect(label.width, name).toBe(painted.right - painted.left);
			}
		}
	});
});
