import type {
	ArrowSceneElement,
	NodeSceneElement,
	RenderedDiagramScene,
	ScenePoint,
} from "./scene.js";

export interface MindmapLayoutIssue {
	readonly kind: "overlap" | "crossing" | "through-node";
	readonly ids: readonly string[];
	readonly message: string;
}

/** Bezier pieces per connector segment, and the longest step between sampled points. */
const CURVE_STEPS = 12;
const MAX_STEP = 4;
/** Where connectors that share a node meet, they may touch this close to it. */
const JOINT = 3;

function bezier(p0: ScenePoint, p1: ScenePoint, p2: ScenePoint, p3: ScenePoint, t: number) {
	const u = 1 - t;
	return {
		x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
		y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
	};
}

/**
 * The line Excalidraw paints for a connector: straight through two points, or
 * for a curved one the Catmull-Rom spline rough.js draws through its points
 * (`curve` at tightness 0, ends repeated), sampled densely.
 */
export function drawnConnector(arrow: ArrowSceneElement): ScenePoint[] {
	const points = arrow.points;
	if (!arrow.curved || points.length < 3) return [...points];
	const padded = [points[0], ...points, points.at(-1)!];
	const drawn: ScenePoint[] = [points[0]];
	for (let index = 1; index + 2 < padded.length; index += 1) {
		const before = padded[index - 1]!;
		const from = padded[index]!;
		const to = padded[index + 1]!;
		const after = padded[index + 2]!;
		const first = { x: from.x + (to.x - before.x) / 6, y: from.y + (to.y - before.y) / 6 };
		const second = { x: to.x - (after.x - from.x) / 6, y: to.y - (after.y - from.y) / 6 };
		for (let step = 1; step <= CURVE_STEPS; step += 1)
			drawn.push(bezier(from, first, second, to, step / CURVE_STEPS));
	}
	return drawn;
}

/** The polyline with no step longer than MAX_STEP, so point tests see every stretch of it. */
function densify(points: readonly ScenePoint[]): ScenePoint[] {
	const dense: ScenePoint[] = [points[0]!];
	for (let index = 1; index < points.length; index += 1) {
		const from = points[index - 1]!;
		const to = points[index]!;
		const steps = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / MAX_STEP));
		for (let step = 1; step <= steps; step += 1)
			dense.push({
				x: from.x + ((to.x - from.x) * step) / steps,
				y: from.y + ((to.y - from.y) * step) / steps,
			});
	}
	return dense;
}

/** Strictly inside a node's drawn outline: its ellipse, or its box less a pixel. */
function inside(point: ScenePoint, node: NodeSceneElement): boolean {
	if (node.shape === "ellipse") {
		const a = node.width / 2;
		const b = node.height / 2;
		return ((point.x - node.x - a) / a) ** 2 + ((point.y - node.y - b) / b) ** 2 < 0.97;
	}
	return (
		point.x > node.x + 1 &&
		point.x < node.x + node.width - 1 &&
		point.y > node.y + 1 &&
		point.y < node.y + node.height - 1
	);
}

function orientation(a: ScenePoint, b: ScenePoint, c: ScenePoint): number {
	return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function segmentsCross(a: ScenePoint, b: ScenePoint, c: ScenePoint, d: ScenePoint): boolean {
	const o1 = orientation(a, b, c);
	const o2 = orientation(a, b, d);
	const o3 = orientation(c, d, a);
	const o4 = orientation(c, d, b);
	return o1 * o2 < 0 && o3 * o4 < 0;
}

interface Drawn {
	readonly arrow: ArrowSceneElement;
	readonly points: readonly ScenePoint[];
	readonly box: { x0: number; x1: number; y0: number; y1: number };
}

function near(point: ScenePoint, joints: readonly ScenePoint[]): boolean {
	return joints.some((joint) => Math.hypot(point.x - joint.x, point.y - joint.y) <= JOINT);
}

/** Where two connectors meet by design: a shared endpoint they both bind to. */
function joints(left: ArrowSceneElement, right: ArrowSceneElement): ScenePoint[] {
	const ends = (arrow: ArrowSceneElement) => [
		{ id: arrow.sourceNodeId, point: arrow.points[0] },
		{ id: arrow.targetNodeId, point: arrow.points.at(-1)! },
	];
	return ends(left).flatMap((end) =>
		ends(right).some((other) => other.id === end.id) ? [end.point] : [],
	);
}

/**
 * What would make a drawn mindmap misread: topics overlapping, connectors
 * crossing, or a connector running through a topic (its own ends included,
 * away from where it binds), judged on the curves Excalidraw paints.
 */
export function mindmapLayoutIssues(scene: RenderedDiagramScene): MindmapLayoutIssue[] {
	const nodes = scene.elements.filter((element) => element.type === "node");
	const arrows = scene.elements.filter((element) => element.type === "arrow");
	const issues: MindmapLayoutIssue[] = [];
	for (let left = 0; left < nodes.length; left += 1) {
		for (let right = left + 1; right < nodes.length; right += 1) {
			const a = nodes[left]!;
			const b = nodes[right]!;
			if (
				a.x < b.x + b.width &&
				b.x < a.x + a.width &&
				a.y < b.y + b.height &&
				b.y < a.y + a.height
			)
				issues.push({
					kind: "overlap",
					ids: [a.nodeId, b.nodeId],
					message: `Topics "${a.label}" and "${b.label}" overlap.`,
				});
		}
	}
	const drawn: Drawn[] = arrows.map((arrow) => {
		const points = densify(drawnConnector(arrow));
		const xs = points.map((point) => point.x);
		const ys = points.map((point) => point.y);
		return {
			arrow,
			points,
			box: {
				x0: Math.min(...xs),
				x1: Math.max(...xs),
				y0: Math.min(...ys),
				y1: Math.max(...ys),
			},
		};
	});
	for (const { arrow, points, box } of drawn) {
		const ends = [points[0]!, points.at(-1)!];
		for (const node of nodes) {
			if (
				box.x1 < node.x ||
				box.x0 > node.x + node.width ||
				box.y1 < node.y ||
				box.y0 > node.y + node.height
			)
				continue;
			const own = node.nodeId === arrow.sourceNodeId || node.nodeId === arrow.targetNodeId;
			if (points.some((point) => inside(point, node) && !(own && near(point, ends))))
				issues.push({
					kind: "through-node",
					ids: [arrow.edgeId, node.nodeId],
					message: `Connector "${arrow.edgeId}" runs through topic "${node.label}".`,
				});
		}
	}
	for (let left = 0; left < drawn.length; left += 1) {
		for (let right = left + 1; right < drawn.length; right += 1) {
			const a = drawn[left]!;
			const b = drawn[right]!;
			if (a.box.x1 < b.box.x0 || b.box.x1 < a.box.x0 || a.box.y1 < b.box.y0 || b.box.y1 < a.box.y0)
				continue;
			const shared = joints(a.arrow, b.arrow);
			let crossed = false;
			for (let i = 1; i < a.points.length && !crossed; i += 1) {
				const p = a.points[i - 1]!;
				const q = a.points[i]!;
				if (near(p, shared) || near(q, shared)) continue;
				for (let j = 1; j < b.points.length && !crossed; j += 1) {
					const r = b.points[j - 1]!;
					const s = b.points[j]!;
					if (near(r, shared) || near(s, shared)) continue;
					crossed = segmentsCross(p, q, r, s);
				}
			}
			if (crossed)
				issues.push({
					kind: "crossing",
					ids: [a.arrow.edgeId, b.arrow.edgeId],
					message: `Connectors "${a.arrow.edgeId}" and "${b.arrow.edgeId}" cross.`,
				});
		}
	}
	return issues;
}
