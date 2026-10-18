import type { RenderedDiagramScene, SceneElement } from "./scene.js";

type NodeElement = Extract<SceneElement, { type: "node" }>;

export interface ChartReadout {
	/** Each drawn bar segment and its length along the value axis, in pixels. */
	readonly bars: readonly {
		readonly category: number;
		readonly series: number;
		readonly length: number;
	}[];
	/** Each drawn slice and the angle it spans, in degrees. */
	readonly slices: readonly { readonly index: number; readonly degrees: number }[];
}

function absolutePoints(element: NodeElement): { x: number; y: number }[] {
	return (element.points ?? []).map((point) => ({
		x: element.x + point.x,
		y: element.y + point.y,
	}));
}

/** Read a rendered chart's data marks back from its scene, for proportion checks. */
export function readChartMarks(scene: RenderedDiagramScene): ChartReadout {
	const nodes = scene.elements.filter((element): element is NodeElement => element.type === "node");
	const baseline = scene.elements.find((element) => element.id === "chart:baseline");
	const vertical =
		baseline?.type !== "line" || Math.abs(baseline.points[0].y - baseline.points[1].y) < 0.01;
	const bars = nodes.flatMap((element) => {
		const match = /^chart:bar:(\d+):(\d+)$/u.exec(element.nodeId);
		return match
			? [
					{
						category: Number(match[1]),
						series: Number(match[2]),
						length: vertical ? element.height : element.width,
					},
				]
			: [];
	});
	const sliceNodes = nodes.flatMap((element) => {
		const match = /^chart:slice:(\d+)$/u.exec(element.nodeId);
		return match ? [{ element, index: Number(match[1]) }] : [];
	});
	const all = sliceNodes.flatMap(({ element }) => absolutePoints(element));
	const xs = all.map((point) => point.x);
	const ys = all.map((point) => point.y);
	const center = {
		x: (Math.min(...xs) + Math.max(...xs)) / 2,
		y: (Math.min(...ys) + Math.max(...ys)) / 2,
	};
	const radius = (Math.max(...xs) - Math.min(...xs)) / 2;
	const slices = sliceNodes.map(({ element, index }) => {
		const rim = absolutePoints(element).filter(
			(point) => Math.hypot(point.x - center.x, point.y - center.y) > radius * 0.99,
		);
		const angles = rim.map((point) => Math.atan2(point.y - center.y, point.x - center.x));
		let span = 0;
		for (let step = 1; step < angles.length; step += 1) {
			let delta = angles[step]! - angles[step - 1]!;
			if (delta < -Math.PI) delta += 2 * Math.PI;
			if (delta > Math.PI) delta -= 2 * Math.PI;
			// A ring's outer arc ends where its inner arc turns back.
			if (delta < 0) break;
			span += delta;
		}
		return { index, degrees: (span * 180) / Math.PI };
	});
	return { bars, slices };
}
