/**
 * Inks the handwritten strokes in strokes.mjs into one static SVG path.
 *
 * 1. A guide point runs along a smooth curve through each stroke's points at
 *    the speed a hand moves: slower where the path bends (the two-thirds power
 *    law of handwriting), easing in and out at the ends.
 * 2. The pen tip follows the guide on a damped spring, so it lags, rounds
 *    tight turns, loops a little at cusps and wobbles slightly.
 * 3. perfect-freehand, the stroke model behind Excalidraw's freedraw tool,
 *    turns each trajectory into an outline, with pressure simulated from speed.
 * 4. The outlines are unioned and refitted as cubic Béziers, so the result is
 *    a few KB instead of thousands of polygon points.
 *
 * Everything is seeded, so the same strokes always give the same path.
 */
import { createRequire } from "node:module";

import { getStroke } from "perfect-freehand";

const require = createRequire(import.meta.url);
const ClipperLib = require("clipper-lib");

const SEED = 5;
const PEN = { omega: 0.34, zeta: 0.64, vmax: 2.5, vmin: 0.35, tremor: 0.06, dt: 0.5, ease: 6 };
const INK = {
	size: 6.4,
	thinning: 0.25,
	smoothing: 0.6,
	streamline: 0.5,
	easing: (t) => Math.sin((t * Math.PI) / 2),
	simulatePressure: true,
	last: true,
};
const JITTER = 0.6;
/** Clipper works in integers. */
const CLIP_SCALE = 1000;

function random(seed) {
	let state = seed >>> 0;
	return () => {
		state = (state * 1664525 + 1013904223) >>> 0;
		return state / 4294967296;
	};
}

// ---------- 1. the guide ----------

/** Centripetal Catmull-Rom between p1 and p2, n samples (p2 excluded). */
function catmullRom(p0, p1, p2, p3, n) {
	const knot = (a, b) => Math.max(Math.hypot(b[0] - a[0], b[1] - a[1]) ** 0.5, 1e-4);
	const t1 = knot(p0, p1);
	const t2 = t1 + knot(p1, p2);
	const t3 = t2 + knot(p2, p3);
	const lerp = (a, b, ta, tb, t) => {
		const u = (t - ta) / (tb - ta);
		return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u];
	};
	const out = [];
	for (let i = 0; i < n; i++) {
		const t = t1 + ((t2 - t1) * i) / n;
		const a1 = lerp(p0, p1, 0, t1, t);
		const a2 = lerp(p1, p2, t1, t2, t);
		const a3 = lerp(p2, p3, t2, t3, t);
		out.push(lerp(lerp(a1, a2, 0, t2, t), lerp(a2, a3, t1, t3, t), t1, t2, t));
	}
	return out;
}

/** Dense points along the stroke, split into separate curves at each cusp. */
function guide(path, step = 0.25) {
	const runs = [];
	let run = [];
	for (const point of path) {
		run.push(point);
		if (point[2] && run.length > 1) {
			runs.push(run);
			run = [point];
		}
	}
	if (run.length > 1) runs.push(run);
	const points = [];
	for (const r of runs) {
		for (let i = 0; i < r.length - 1; i++) {
			const p1 = r[i];
			const p2 = r[i + 1];
			const p0 = r[i - 1] ?? [2 * p1[0] - p2[0], 2 * p1[1] - p2[1]];
			const p3 = r[i + 2] ?? [2 * p2[0] - p1[0], 2 * p2[1] - p1[1]];
			const n = Math.max(2, Math.ceil((Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) * 1.3) / step));
			points.push(...catmullRom(p0, p1, p2, p3, n));
		}
	}
	points.push(path.at(-1));
	let s = 0;
	return points.map(([x, y], i) => {
		if (i > 0) s += Math.hypot(x - points[i - 1][0], y - points[i - 1][1]);
		return { x, y, s };
	});
}

// ---------- 2. the pen ----------

function trajectory(path, options, rand) {
	const { omega, zeta, vmax, vmin, tremor, dt, ease } = { ...PEN, ...options };
	const g = guide(path);
	const n = g.length;
	const length = g[n - 1].s;
	const index = (s) => Math.min(n - 1, Math.max(0, Math.round((s / length) * (n - 1))));
	// How sharply the path turns around each point, in radians per unit.
	const curvature = g.map((b, i) => {
		const a = g[Math.max(0, i - 4)];
		const c = g[Math.min(n - 1, i + 4)];
		let turn = Math.abs(Math.atan2(c.y - b.y, c.x - b.x) - Math.atan2(b.y - a.y, b.x - a.x));
		if (turn > Math.PI) turn = 2 * Math.PI - turn;
		return turn / Math.max(0.5, c.s - a.s);
	});
	const speed = (s) => {
		const v = vmax * Math.min(1, 0.22 * (curvature[index(s)] + 0.02) ** (-1 / 3));
		return Math.max(vmin, v * Math.min(1, 0.25 + s / ease, 0.25 + (length - s) / ease));
	};
	const phase = Array.from({ length: 4 }, () => rand() * Math.PI * 2);
	const rate = Array.from({ length: 4 }, () => 0.05 + rand() * 0.1);
	const wobble = (t, k) =>
		tremor * (Math.sin(t * rate[k] + phase[k]) + Math.sin(t * rate[k + 1] + phase[k + 1]));

	let { x, y } = g[0];
	let vx = 0;
	let vy = 0;
	let s = 0;
	const points = [[x, y]];
	for (let t = 0; t < 10_000; t += dt) {
		s = Math.min(length, s + speed(s) * dt);
		const target = g[index(s)];
		vx += (omega * omega * (target.x - x) - 2 * zeta * omega * vx + wobble(t, 0)) * dt;
		vy += (omega * omega * (target.y - y) - 2 * zeta * omega * vy + wobble(t, 2)) * dt;
		x += vx * dt;
		y += vy * dt;
		points.push([x, y]);
		if (s >= length && Math.hypot(target.x - x, target.y - y) < 0.4) break;
	}
	return points;
}

/** A looser second pass: it drifts up to `d` off the first line, crossing it once. */
function secondPass(points, { d, from, to, phase }, rand) {
	const n = points.length;
	const a = Math.floor(from * (n - 1));
	const b = Math.ceil(to * (n - 1));
	const shift = phase + (rand() - 0.5) * 0.2;
	const out = [];
	for (let i = a; i <= b; i++) {
		const [x, y] = points[i];
		const before = points[Math.max(0, i - 2)];
		const after = points[Math.min(n - 1, i + 2)];
		const dx = after[0] - before[0];
		const dy = after[1] - before[1];
		const m = Math.hypot(dx, dy) || 1;
		const t = (i - a) / Math.max(1, b - a);
		const off =
			d * Math.sin(Math.PI * (t + shift)) * Math.sin(Math.PI * Math.min(1, t * 1.2 + 0.08));
		out.push([x - (dy / m) * off, y + (dx / m) * off]);
	}
	return out;
}

// ---------- 3. ink, and the union ----------

function outlines(strokes) {
	const rand = random(SEED);
	const polygons = [];
	const add = (points, ink) => {
		const outline = getStroke(points, ink);
		if (outline.length > 2) {
			polygons.push(
				outline.map(([x, y]) => ({ X: Math.round(x * CLIP_SCALE), Y: Math.round(y * CLIP_SCALE) })),
			);
		}
	};
	for (const stroke of strokes) {
		// The hand lands each point within a fraction of a unit of where it aimed.
		const aimed = stroke.path.map(([x, y, cusp]) => [
			x + (rand() - 0.5) * JITTER,
			y + (rand() - 0.5) * JITTER,
			cusp,
		]);
		const points = trajectory(aimed, stroke.pen, rand);
		const ink = { ...INK, ...stroke.ink };
		add(points, ink);
		if (stroke.again) add(secondPass(points, stroke.again, rand), { ...ink, ...stroke.again.ink });
	}
	const clipper = new ClipperLib.Clipper();
	clipper.AddPaths(polygons, ClipperLib.PolyType.ptSubject, true);
	const solution = new ClipperLib.Paths();
	const { pftNonZero } = ClipperLib.PolyFillType;
	clipper.Execute(ClipperLib.ClipType.ctUnion, solution, pftNonZero, pftNonZero);
	return solution.map((polygon) => polygon.map(({ X, Y }) => [X / CLIP_SCALE, Y / CLIP_SCALE]));
}

// ---------- 4. Bézier fitting (Schneider, Graphics Gems 1990) ----------

const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
const scale = (a, s) => [a[0] * s, a[1] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const norm = (a) => Math.hypot(a[0], a[1]);
const unit = (a) => scale(a, 1 / (norm(a) || 1));

const bezier = (c, t) => {
	const u = 1 - t;
	return add(
		add(scale(c[0], u * u * u), scale(c[1], 3 * u * u * t)),
		add(scale(c[2], 3 * u * t * t), scale(c[3], t * t * t)),
	);
};
const bezier1 = (c, t) => {
	const u = 1 - t;
	return add(
		add(scale(sub(c[1], c[0]), 3 * u * u), scale(sub(c[2], c[1]), 6 * u * t)),
		scale(sub(c[3], c[2]), 3 * t * t),
	);
};
const bezier2 = (c, t) =>
	add(
		scale(add(sub(c[2], scale(c[1], 2)), c[0]), 6 * (1 - t)),
		scale(add(sub(c[3], scale(c[2], 2)), c[1]), 6 * t),
	);

function chordLengths(points) {
	const u = [0];
	for (let i = 1; i < points.length; i++) u.push(u[i - 1] + norm(sub(points[i], points[i - 1])));
	return u.map((v) => v / (u.at(-1) || 1));
}

/** Least-squares cubic through `points` with fixed end tangents. */
function generate(points, u, t1, t2) {
	const first = points[0];
	const last = points.at(-1);
	let c00 = 0;
	let c01 = 0;
	let c11 = 0;
	let x0 = 0;
	let x1 = 0;
	for (let i = 0; i < points.length; i++) {
		const t = u[i];
		const a1 = scale(t1, 3 * (1 - t) * (1 - t) * t);
		const a2 = scale(t2, 3 * (1 - t) * t * t);
		c00 += dot(a1, a1);
		c01 += dot(a1, a2);
		c11 += dot(a2, a2);
		const rest = sub(points[i], bezier([first, first, last, last], t));
		x0 += dot(a1, rest);
		x1 += dot(a2, rest);
	}
	const det = c00 * c11 - c01 * c01;
	const solvable = Math.abs(det) > 1e-12;
	let alpha1 = solvable ? (x0 * c11 - x1 * c01) / det : 0;
	let alpha2 = solvable ? (c00 * x1 - c01 * x0) / det : 0;
	const span = norm(sub(last, first));
	if (alpha1 < 1e-6 * span || alpha2 < 1e-6 * span) alpha1 = alpha2 = span / 3;
	return [first, add(first, scale(t1, alpha1)), add(last, scale(t2, alpha2)), last];
}

function worstPoint(points, curve, u) {
	let worst = 0;
	let at = Math.floor(points.length / 2);
	for (let i = 1; i < points.length - 1; i++) {
		const e = norm(sub(bezier(curve, u[i]), points[i])) ** 2;
		if (e > worst) {
			worst = e;
			at = i;
		}
	}
	return [worst, at];
}

function fitCubic(points, t1, t2, tolerance, out) {
	if (points.length === 2) {
		const third = norm(sub(points[1], points[0])) / 3;
		out.push([
			points[0],
			add(points[0], scale(t1, third)),
			add(points[1], scale(t2, third)),
			points[1],
		]);
		return;
	}
	let u = chordLengths(points);
	let curve = generate(points, u, t1, t2);
	let [error, split] = worstPoint(points, curve, u);
	const close = error < tolerance * 4;
	for (let k = 0; close && error >= tolerance && k < 20; k++) {
		// Newton-Raphson: move each parameter to the closest point on the curve.
		u = u.map((t, i) => {
			const d = sub(bezier(curve, t), points[i]);
			const d1 = bezier1(curve, t);
			const den = dot(d1, d1) + dot(d, bezier2(curve, t));
			return Math.abs(den) > 1e-12 ? Math.min(1, Math.max(0, t - dot(d, d1) / den)) : t;
		});
		curve = generate(points, u, t1, t2);
		[error, split] = worstPoint(points, curve, u);
	}
	if (error < tolerance) {
		out.push(curve);
		return;
	}
	const tangent = unit(sub(points[split - 1], points[split + 1]));
	fitCubic(points.slice(0, split + 1), t1, tangent, tolerance, out);
	fitCubic(points.slice(split), scale(tangent, -1), t2, tolerance, out);
}

/** Resample a closed outline evenly, find its corners, and fit each run between them. */
function fitOutline(polygon, { step = 0.4, tolerance = 0.06, cornerDegrees = 38 } = {}) {
	const ring = polygon.concat([polygon[0]]);
	let points = [];
	let carry = 0;
	for (let i = 0; i < ring.length - 1; i++) {
		const a = ring[i];
		const b = ring[i + 1];
		const l = norm(sub(b, a));
		let t = carry;
		for (; t < l; t += step) points.push(add(a, scale(sub(b, a), t / l)));
		carry = t - l;
	}
	const n = points.length;
	if (n < 6) return [];
	const at = (i) => points[(i + n) % n];
	const turn = points.map((p, i) => {
		const cos = dot(unit(sub(p, at(i - 3))), unit(sub(at(i + 3), p)));
		return (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
	});
	const corners = [];
	for (let i = 0; i < n; i++) {
		let peak = turn[i] >= cornerDegrees;
		for (let j = -3; j <= 3 && peak; j++) if (j && turn[(i + j + n) % n] > turn[i]) peak = false;
		if (peak) corners.push(i);
	}
	const nearCorner = new Set(corners.flatMap((c) => [-2, -1, 0, 1, 2].map((j) => (c + j + n) % n)));
	points = points.map((p, i) =>
		nearCorner.has(i) ? p : scale(add(add(at(i - 1), scale(p, 2)), at(i + 1)), 0.25),
	);

	const curves = [];
	if (corners.length === 0) {
		const tangent = unit(sub(at(1), at(-1)));
		fitCubic(points.concat([points[0]]), tangent, scale(tangent, -1), tolerance, curves);
		return curves;
	}
	for (let k = 0; k < corners.length; k++) {
		const a = corners[k];
		const b = corners[(k + 1) % corners.length];
		const run = [points[a]];
		for (let i = (a + 1) % n; ; i = (i + 1) % n) {
			run.push(points[i]);
			if (i === b) break;
		}
		const t1 = unit(sub(run[Math.min(2, run.length - 1)], run[0]));
		const t2 = unit(sub(run[Math.max(run.length - 3, 0)], run.at(-1)));
		fitCubic(run, t1, t2, tolerance, curves);
	}
	return curves;
}

// ---------- 5. the path ----------

/** Tenths of a unit as the shortest SVG number: 5 -> ".5", -15 -> "-1.5". */
function number(tenths) {
	const abs = Math.abs(tenths);
	const whole = Math.floor(abs / 10);
	const frac = abs % 10;
	const body = frac === 0 ? `${whole}` : whole === 0 ? `.${frac}` : `${whole}.${frac}`;
	return tenths < 0 ? `-${body}` : body;
}

function numbers(values) {
	let out = "";
	let previous = "";
	for (const value of values) {
		const separate =
			out && !value.startsWith("-") && !(value.startsWith(".") && previous.includes("."));
		out += (separate ? " " : "") + value;
		previous = value;
	}
	return out;
}

const area = (polygon) =>
	polygon.reduce((sum, [x, y], i) => {
		const [nx, ny] = polygon[(i + 1) % polygon.length];
		return sum + x * ny - nx * y;
	}, 0) / 2;

/** Inks the strokes into `{ width, height, d }`: a path in a box from (0, 0), with relative commands and 0.1-unit precision. */
export function inkWordmark(strokes) {
	const shapes = outlines(strokes).filter((polygon) => Math.abs(area(polygon)) > 0.5);
	const xs = shapes.flat().map(([x]) => x);
	const ys = shapes.flat().map(([, y]) => y);
	const x0 = Math.floor(Math.min(...xs) - 1);
	const y0 = Math.floor(Math.min(...ys) - 1);
	const viewBox = [
		x0,
		y0,
		Math.ceil(Math.max(...xs) + 1) - x0,
		Math.ceil(Math.max(...ys) + 1) - y0,
	];

	const tenths = ([x, y]) => [Math.round((x - x0) * 10), Math.round((y - y0) * 10)];
	let d = "";
	let start = null;
	for (const curves of shapes.map((polygon) => fitOutline(polygon))) {
		if (curves.length === 0) continue;
		const first = tenths(curves[0][0]);
		const move = start ? [first[0] - start[0], first[1] - start[1]] : first;
		d += `${start ? "m" : "M"}${numbers(move.map(number))}c`;
		let pen = first;
		const values = [];
		for (const curve of curves) {
			for (const point of curve.slice(1)) {
				const [x, y] = tenths(point);
				values.push(number(x - pen[0]), number(y - pen[1]));
			}
			pen = tenths(curve[3]);
		}
		d += `${numbers(values)}z`;
		start = first;
	}
	return { width: viewBox[2], height: viewBox[3], d };
}
