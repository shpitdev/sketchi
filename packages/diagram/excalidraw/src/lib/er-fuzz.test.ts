import { describe, expect, it } from "vitest";
import {
	candidateRouteQuality,
	type ErCardinality,
	type ErDiagram,
	getCanvasValidationIssues,
	parseErDiagram,
	routingQualityFindings,
	routingQualityScale,
} from "@sketchi/diagram-core";
import { renderDiagram, type RenderedDiagramScene } from "@sketchi/diagram-renderer";

import { convertSceneToExcalidraw, validateExcalidrawScene } from "./convert";

const TABLES = [
	"users",
	"orders",
	"products",
	"invoices",
	"accounts",
	"projects",
	"tasks",
	"comments",
	"payment_reconciliation_batches",
	"AuthenticationController",
	"品質保証レビュー",
];
const TYPES = ["uuid", "int", "text", "timestamptz", "numeric(10,2)", "varchar(255)", "jsonb"];
const FIELDS = [
	"name",
	"created_at",
	"status",
	"amount",
	"a_very_long_snake_case_identifier_name",
	"notes",
];
const LABELS = ["places", "belongs to", "contains", "is reviewed by the assigned team lead"];
const PAIRS: readonly (readonly [ErCardinality, ErCardinality])[] = [
	["one", "zero-or-many"],
	["one", "one-or-many"],
	["one", "many"],
	["zero-or-one", "zero-or-many"],
	["one", "zero-or-one"],
	["one", "one"],
];

/**
 * Seeded random schemas as models write them: tables keyed by id, child tables
 * holding foreign keys to earlier tables, join tables with composite keys,
 * self-references, relationships between whole entities, and long names.
 */
function randomSchemas(count: number, start: number): ErDiagram[] {
	let seed = start;
	const random = () => {
		seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
		return seed / 2_147_483_648;
	};
	const pick = <T>(values: readonly T[]) => values[Math.floor(random() * values.length)]!;
	return Array.from({ length: count }, (_, index) => {
		const size = 2 + Math.floor(random() * 13);
		const entities = Array.from({ length: size }, (_, at) => ({
			id: `t${at}`,
			name: `${pick(TABLES)}_${at}`,
			fields: [
				{ name: "id", type: "int", pk: true },
				...Array.from({ length: Math.floor(random() * 5) }, (_, field) => ({
					name: `${pick(FIELDS)}_${field}`,
					type: pick(TYPES),
					...(random() < 0.25 ? { nullable: true } : {}),
					...(random() < 0.15 ? { unique: true } : {}),
				})),
			] as {
				name: string;
				type?: string;
				pk?: boolean;
				fk?: boolean;
				nullable?: boolean;
				unique?: boolean;
			}[],
		}));
		const relationships: {
			id: string;
			from: string;
			to: string;
			fromCardinality: ErCardinality;
			toCardinality: ErCardinality;
			label?: string;
		}[] = [];
		const relate = (from: string, to: string) => {
			const [fromCardinality, toCardinality] = pick(PAIRS);
			relationships.push({
				id: `r${relationships.length}`,
				from,
				to,
				fromCardinality,
				toCardinality,
				...(random() < 0.2 ? { label: pick(LABELS) } : {}),
			});
		};
		for (let at = 1; at < size; at += 1) {
			if (random() < 0.15) continue;
			const parent = Math.floor(random() * at);
			const field = `t${parent}_id_${at}`;
			entities[at]!.fields.push({
				name: field,
				type: "int",
				fk: true,
				...(random() < 0.3 ? { nullable: true } : {}),
			});
			relate(`t${parent}.id`, `t${at}.${field}`);
			if (random() < 0.12) {
				entities[at]!.fields.push({ name: "parent_id", type: "int", fk: true, nullable: true });
				relate(`t${at}.id`, `t${at}.parent_id`);
			}
		}
		if (size >= 3 && random() < 0.4) {
			const [a, b] = [Math.floor(random() * size), Math.floor(random() * size)];
			if (a !== b) {
				entities.push({
					id: `join${index}`,
					name: `join_${index}`,
					fields: [
						{ name: `t${a}_id`, type: "int", pk: true, fk: true },
						{ name: `t${b}_id`, type: "int", pk: true, fk: true },
					],
				});
				relate(`t${a}.id`, `join${index}.t${a}_id`);
				relate(`t${b}.id`, `join${index}.t${b}_id`);
			}
		}
		if (size >= 4 && random() < 0.3)
			relate(`t${size - 1}`, `t${Math.floor(random() * (size - 1))}`);
		return parseErDiagram({
			id: `er-fuzz-${index}`,
			title: `ER fuzz ${index}`,
			type: "er",
			entities,
			relationships,
		});
	});
}

/** Interior crossings between arrows, counted on corners only, and reader-scale findings. */
function routingCounts(scene: RenderedDiagramScene) {
	const arrows = scene.elements.flatMap((e) => (e.type === "arrow" ? [e] : []));
	const routes = arrows.map((a) => ({
		id: a.edgeId,
		points: a.points,
		sourceId: a.sourceNodeId,
		targetId: a.targetNodeId,
	}));
	const scale = routingQualityScale({ width: scene.width, height: scene.height });
	const quality = candidateRouteQuality(routes, scale);
	const between = (value: number, p: number, q: number) =>
		value > Math.min(p, q) + 0.01 && value < Math.max(p, q) - 0.01;
	let crossings = 0;
	for (const [index, a] of arrows.entries())
		for (const b of arrows.slice(index + 1))
			for (let i = 0; i + 1 < a.points.length; i += 1)
				for (let j = 0; j + 1 < b.points.length; j += 1) {
					const [p, q, r, u] = [a.points[i]!, a.points[i + 1]!, b.points[j]!, b.points[j + 1]!];
					const [h, v] =
						Math.abs(p.y - q.y) < 0.01 && Math.abs(r.x - u.x) < 0.01
							? [
									[p, q],
									[r, u],
								]
							: Math.abs(p.x - q.x) < 0.01 && Math.abs(r.y - u.y) < 0.01
								? [
										[r, u],
										[p, q],
									]
								: [];
					if (h && v && between(v[0]!.x, h[0]!.x, h[1]!.x) && between(h[0]!.y, v[0]!.y, v[1]!.y))
						crossings += 1;
				}
	return {
		crossings,
		findings:
			routingQualityFindings(routes, scale).length +
			routes.filter((route) => quality(route).arrowheadsCrossed > 0).length,
	};
}

/** Everything the export validator, the canvas validator or the layout guards would flag. */
function defects(diagram: ErDiagram): string[] {
	const scene = renderDiagram(diagram);
	const exported = convertSceneToExcalidraw(scene);
	const tables = scene.elements.flatMap((element) =>
		element.type === "node" &&
		element.rendererRole === "er-table" &&
		!element.id.endsWith(":header")
			? [element]
			: [],
	);
	const overlapping = tables.flatMap((box, index) =>
		tables
			.slice(index + 1)
			.filter(
				(other) =>
					box.x < other.x + other.width &&
					other.x < box.x + box.width &&
					box.y < other.y + other.height &&
					other.y < box.y + box.height,
			)
			.map((other) => `${box.id} overlaps ${other.id}`),
	);
	const diagonal = scene.elements.flatMap((element) =>
		element.type === "arrow" &&
		element.points.some(
			(point, index) =>
				index > 0 &&
				Math.abs(point.x - element.points[index - 1]!.x) > 0.01 &&
				Math.abs(point.y - element.points[index - 1]!.y) > 0.01,
		)
			? [`${element.id} runs diagonally`]
			: [],
	);
	// Table text never wraps: each column holds its widest line, the band its name.
	const unwrapped = exported.elements.flatMap((element) =>
		element.type === "text" &&
		/^(?:text:|label:.*:header$)/u.test(element.id) &&
		element.text !== element.originalText
			? [`${element.id} wraps`]
			: [],
	);
	return [
		...getCanvasValidationIssues(scene).map((issue) => issue.message),
		...validateExcalidrawScene(exported).issues.map((issue) => issue.message),
		...overlapping,
		...diagonal,
		...unwrapped,
	];
}

/**
 * Crossings and reader-scale findings ("crossings/findings") each random schema
 * draws, in order, since every relationship end has a port of its own. None
 * may draw more crossings, nor more crossings and findings together, and
 * together they may draw no more of either.
 */
const ER_ROUTING = "4/3 0/0 0/0 0/0 0/0 2/2 0/0 1/0 0/0 0/0 0/2 0/0 1/1 3/1 0/0 2/0";

/** Schemas checked in CI; the full fuzz runs locally with ER_FUZZ=full (and any ER_FUZZ_SEED). */
const CI_SCHEMAS = 16;
const FULL = process.env["ER_FUZZ"] === "full";

describe("ER routing fuzz", () => {
	const schemas = randomSchemas(
		FULL ? 240 : CI_SCHEMAS,
		Number(process.env["ER_FUZZ_SEED"] ?? 20261019),
	);

	it("exports every random schema valid, orthogonal, unwrapped and with tables apart", () => {
		const failures = schemas.flatMap((schema, index) =>
			defects(schema).map((defect) => `${index}: ${defect}`),
		);
		expect(failures).toEqual([]);
	});

	it("draws no random schema with more crossings or reader-scale findings than pinned", () => {
		const counts = schemas
			.slice(0, CI_SCHEMAS)
			.map((schema) => routingCounts(renderDiagram(schema)));
		if (process.env["PRINT_ROUTING"])
			console.log("PIN er", counts.map((c) => `${c.crossings}/${c.findings}`).join(" "));
		const pinned = ER_ROUTING.split(" ").map((pair) => pair.split("/").map(Number));
		const worse = counts.flatMap(({ crossings, findings }, index) => {
			const [pinnedCrossings, pinnedFindings] = pinned[index] as [number, number];
			return crossings > pinnedCrossings || crossings + findings > pinnedCrossings + pinnedFindings
				? [`${index}: ${pinned[index]!.join("/")} -> ${crossings}/${findings}`]
				: [];
		});
		const total = (pairs: readonly (readonly number[])[], at: number) =>
			pairs.reduce((sum, pair) => sum + pair[at]!, 0);
		const drawn = counts.map(({ crossings, findings }) => [crossings, findings]);
		expect(worse).toEqual([]);
		expect(total(drawn, 0)).toBeLessThanOrEqual(total(pinned, 0));
		expect(total(drawn, 1)).toBeLessThanOrEqual(total(pinned, 1));
	});
});
