import { describe, expect, it } from "vitest";
import {
	parseFlowchartDiagram,
	parseIntermediateDiagram,
	segmentsFromPoints,
	segmentsOverlapInterior,
	segmentCrossesBoundsInterior,
	routingFixtures,
	flowchartFixture,
	pharmaBatchDispositionFlowchart,
} from "@sketchi/diagram-core";
import { renderIntermediateDiagram } from "@sketchi/diagram-renderer";
import {
	convertSceneToExcalidraw,
	createExcalidrawFile,
	exportedRoutingQualityFindings,
	validateExcalidrawScene,
} from "./convert";

describe.each(
	Object.entries({ ...routingFixtures, flowchartFixture, pharmaBatchDispositionFlowchart }),
)("routing export: %s", (_name, fixture) => {
	it("preserves binding, text fit, and non-overlapping segments", () => {
		const scene = convertSceneToExcalidraw(renderIntermediateDiagram(fixture));
		expect(validateExcalidrawScene(scene).issues).toEqual([]);
	});

	it("exports no endpoint jogs, near-coincident corridors or touching arrowheads", () => {
		const scene = convertSceneToExcalidraw(renderIntermediateDiagram(fixture));
		const file = createExcalidrawFile(scene);
		expect(
			exportedRoutingQualityFindings({ ...scene, elements: file.elements }).map(
				(finding) => finding.message,
			),
		).toEqual([]);
	});
});

describe.each(["TB", "BT", "LR", "RL"] as const)(
	"polish never costs a valid export: %s",
	(direction) => {
		it("keeps a corridor lane shift from overlapping a later route", () => {
			// Review repro: shifting one lane clear of a neighbor left a later edge only an overlap.
			const decisions = new Set(["n0", "n3", "n6", "n9"]);
			const scene = convertSceneToExcalidraw(
				renderIntermediateDiagram(
					parseIntermediateDiagram({
						...flowchartFixture,
						nodes: ["n0", "n1", "n2", "n3", "n4", "n5", "n6", "n8", "n9"].map((id) => ({
							id,
							label: `Stage ${id.slice(1)}`,
							kind: decisions.has(id) ? "decision" : "process",
						})),
						edges: [
							["n0", "n8", "No"],
							["n1", "n2"],
							["n1", "n5"],
							["n3", "n6", "No"],
							["n5", "n6"],
						].map(([source, target, label], index) => ({
							id: `e${index}`,
							source: source!,
							target: target!,
							...(label ? { label } : {}),
						})),
						layout: { ...flowchartFixture.layout, direction, edgeRouting: "orthogonal" },
					}),
				),
			);
			expect(validateExcalidrawScene(scene).issues).toEqual([]);
		});
	},
);

describe.each(["TB", "BT"] as const)("wide decision export: %s", (direction) => {
	it("keeps six long-labeled branch stubs clear of the next rank", () => {
		// Review repro: label room on a shared decision side pushed mandatory stubs into nodes.
		const branches = [0, 1, 2, 3, 4, 5];
		const scene = convertSceneToExcalidraw(
			renderIntermediateDiagram(
				parseFlowchartDiagram({
					id: "six-branches",
					title: "Six branches",
					type: "flowchart",
					nodes: [
						{ id: "start", label: "Start", kind: "start" },
						{ id: "route", label: "Route request", kind: "decision" },
						...branches.map((i) => ({ id: `p${i}`, label: `Process ${i}`, kind: "process" })),
						{ id: "end", label: "End", kind: "end" },
					],
					edges: [
						{ id: "in", source: "start", target: "route" },
						...branches.flatMap((i) => [
							{
								id: `b${i}`,
								source: "route",
								target: `p${i}`,
								label: `Details were received and are now ready for further review ${i}`,
							},
							{ id: `x${i}`, source: `p${i}`, target: "end" },
						]),
					],
					layout: { direction, edgeRouting: "orthogonal" },
				}),
			),
		);
		expect(validateExcalidrawScene(scene).issues).toEqual([]);
	});
});

describe.each(["TB", "BT", "LR", "RL"] as const)("polished fan-in export: %s", (direction) => {
	it.each([
		"release-fan-in",
		"stability-fan-in",
		"renewal-retry",
		"cancellation-convergence",
	] as const)("exports %s without reader-scale routing defects", (name) => {
		const fixture = routingFixtures[name];
		const scene = convertSceneToExcalidraw(
			renderIntermediateDiagram({ ...fixture, layout: { ...fixture.layout, direction } }),
		);
		expect(validateExcalidrawScene(scene).issues).toEqual([]);
		expect(exportedRoutingQualityFindings(scene).map((finding) => finding.message)).toEqual([]);
	});
});

describe.each(["TB", "BT", "LR", "RL"] as const)("settled direct export: %s", (direction) => {
	it.each(["straight", "curved"] as const)(
		"preserves all final %s bound endpoints",
		(edgeRouting) => {
			for (const minimal of [false, true]) {
				const workflow = routingFixtures["shared-feedback-returns"];
				const rendered = renderIntermediateDiagram({
					...workflow,
					nodes: minimal ? workflow.nodes.filter((n) => n.kind === "process") : workflow.nodes,
					edges: workflow.edges
						.filter((e) => !minimal || (e.id !== "entry" && e.id !== "release"))
						.map(({ label: _label, ...edge }) => edge),
					layout: { direction, edgeRouting },
				});
				const scene = convertSceneToExcalidraw(rendered),
					file = createExcalidrawFile(scene),
					arrows = file.elements.filter((e) => e.type === "arrow");
				expect(file.elements.filter((e) => e.id.startsWith("node:"))).toHaveLength(minimal ? 4 : 6);
				expect(arrows).toHaveLength(minimal ? 6 : 8);
				const endpoints = arrows.flatMap((a) => {
					const points = (a.points as [number, number][]).map(([x, y]) => ({
						x: Number(a.x) + x,
						y: Number(a.y) + y,
					}));
					return [
						{
							node: (a.startBinding as { elementId: string }).elementId,
							point: points[0]!,
							id: `${a.id}:source`,
						},
						{
							node: (a.endBinding as { elementId: string }).elementId,
							point: points.at(-1)!,
							id: `${a.id}:target`,
						},
					];
				});
				for (const [i, a] of endpoints.entries())
					for (const b of endpoints.slice(i + 1))
						if (a.node === b.node)
							expect(
								Math.hypot(a.point.x - b.point.x, a.point.y - b.point.y),
								`${a.id}/${b.id}`,
							).toBeGreaterThan(0.01);
				expect(validateExcalidrawScene({ ...scene, elements: file.elements }).issues).toEqual([]);
			}
		},
	);
	it.each(["straight", "curved"] as const)(
		"keeps actual exported text clear of its own %s return",
		(edgeRouting) => {
			for (const minimal of [false, true]) {
				const workflow = routingFixtures["shared-feedback-returns"];
				const scene = convertSceneToExcalidraw(
					renderIntermediateDiagram({
						...workflow,
						nodes: minimal ? workflow.nodes.filter((n) => n.kind === "process") : workflow.nodes,
						edges: workflow.edges
							.filter(
								(e) =>
									e.id !== "ba" &&
									e.id !== "da" &&
									(!minimal || (e.id !== "entry" && e.id !== "release")),
							)
							.map((e) => (e.id === "ca" ? { ...e, label: "Revisit earlier stage now" } : e)),
						layout: { direction, edgeRouting },
					}),
				);
				const file = createExcalidrawFile(scene),
					arrow = file.elements.find((e) => e.id === "edge:ca")!,
					label = file.elements.find((e) => e.id === "edge:ca:label")!;
				expect(file.elements.filter((e) => e.type === "arrow")).toHaveLength(minimal ? 4 : 6);
				expect(file.elements.filter((e) => e.id.startsWith("node:"))).toHaveLength(minimal ? 4 : 6);
				const points = (arrow.points as [number, number][]).map(([x, y]) => ({
					x: Number(arrow.x) + x,
					y: Number(arrow.y) + y,
				}));
				for (const [i, start] of points.slice(0, -1).entries()) {
					const end = points[i + 1]!;
					for (let step = 1; step < 1000; step++) {
						const x = start.x + ((end.x - start.x) * step) / 1000,
							y = start.y + ((end.y - start.y) * step) / 1000;
						expect(
							x > Number(label.x) + 0.01 &&
								x < Number(label.x) + Number(label.width) - 0.01 &&
								y > Number(label.y) + 0.01 &&
								y < Number(label.y) + Number(label.height) - 0.01,
						).toBe(false);
					}
				}
				expect(validateExcalidrawScene({ ...scene, elements: file.elements }).issues).toEqual([]);
			}
		},
	);
});

describe.each(["TB", "BT", "LR", "RL"] as const)("direct return export: %s", (direction) => {
	it.each(["straight", "curved"] as const)(
		"preserves distinct %s return starts and corridors",
		(edgeRouting) => {
			for (const labeled of [false, true]) {
				const fixture = routingFixtures["two-stage-retry"];
				const scene = convertSceneToExcalidraw(
					renderIntermediateDiagram({
						...fixture,
						edges: fixture.edges.map((e) =>
							e.id === "e5" && labeled ? { ...e, label: "Retry" } : e,
						),
						layout: { direction, edgeRouting },
					}),
				);
				const file = createExcalidrawFile(scene);
				const arrows = file.elements.filter((e) => e.type === "arrow");
				expect(file.elements.filter((e) => e.id.startsWith("node:"))).toHaveLength(6);
				expect(arrows).toHaveLength(7);
				const points = (a: (typeof arrows)[number]) =>
					(a.points as [number, number][]).map(([x, y]) => ({
						x: Number(a.x) + x,
						y: Number(a.y) + y,
					}));
				const returns = arrows.filter((e) => e.id === "edge:e5" || e.id === "edge:e6");
				expect(new Set(returns.map((a) => JSON.stringify(points(a)[0]))).size).toBe(2);
				for (const [i, a] of arrows.entries())
					for (const b of arrows.slice(i + 1))
						for (const x of segmentsFromPoints(points(a)))
							for (const y of segmentsFromPoints(points(b)))
								expect(segmentsOverlapInterior(x, y), `${a.id}/${b.id}`).toBe(false);
				expect(validateExcalidrawScene({ ...scene, elements: file.elements }).issues).toEqual([]);
			}
		},
	);
});

describe.each(["TB", "BT", "LR", "RL"] as const)("complete feedback export: %s", (direction) => {
	it.each(["straight", "curved"] as const)(
		"exports all %s stages without penetration",
		(edgeRouting) => {
			const workflow = routingFixtures["feedback-chain"];
			for (const minimal of [false, true]) {
				const fixture = minimal
					? {
							...workflow,
							nodes: workflow.nodes.filter((n) => n.kind === "process"),
							edges: workflow.edges.filter((e) => e.id !== "start" && e.id !== "end"),
						}
					: workflow;
				const scene = convertSceneToExcalidraw(
					renderIntermediateDiagram({ ...fixture, layout: { direction, edgeRouting } }),
				);
				const file = createExcalidrawFile(scene);
				const nodes = file.elements.filter((e) => e.id.startsWith("node:"));
				const arrows = file.elements.filter((e) => e.type === "arrow");
				expect(nodes).toHaveLength(minimal ? 3 : 5);
				expect(arrows).toHaveLength(minimal ? 3 : 5);
				expect(validateExcalidrawScene({ ...scene, elements: file.elements }).issues).toEqual([]);
				const arrow = arrows.find((e) => e.id === "edge:ca")!;
				const [start, end] = (arrow.points as [number, number][]).map(([x, y]) => ({
					x: Number(arrow.x) + x,
					y: Number(arrow.y) + y,
				}));
				for (let i = 1; i < 100; i++) {
					const x = start!.x + ((end!.x - start!.x) * i) / 100;
					const y = start!.y + ((end!.y - start!.y) * i) / 100;
					for (const n of nodes)
						expect(
							x > Number(n.x) &&
								x < Number(n.x) + Number(n.width) &&
								y > Number(n.y) &&
								y < Number(n.y) + Number(n.height),
							n.id,
						).toBe(false);
				}
			}
		},
	);
	it("exports all four mixed-label returns without collapsing departures", () => {
		const fixture = routingFixtures["multi-stage-rework"];
		const scene = convertSceneToExcalidraw(
			renderIntermediateDiagram({ ...fixture, layout: { ...fixture.layout, direction } }),
		);
		const file = createExcalidrawFile(scene);
		expect(file.elements.filter((e) => e.id.startsWith("node:"))).toHaveLength(7);
		expect(file.elements.filter((e) => e.type === "arrow")).toHaveLength(10);
		const returns = file.elements.filter((e) => e.type === "arrow" && e.id.startsWith("edge:back"));
		expect(returns).toHaveLength(4);
		expect(
			new Set(
				returns.map((a) => {
					const [x, y] = (a.points as [number, number][])[0]!;
					return JSON.stringify([Number(a.x) + x, Number(a.y) + y]);
				}),
			).size,
		).toBe(4);
		expect(validateExcalidrawScene({ ...scene, elements: file.elements }).issues).toEqual([]);
	});
});

it.each(["TB", "BT", "LR", "RL"] as const)(
	"exports feedback and skip routes in %s without endpoint-stub overlap",
	(direction) => {
		const fixture = routingFixtures["feedback-skip-stubs"];
		const scene = convertSceneToExcalidraw(
			renderIntermediateDiagram({
				...fixture,
				layout: { ...fixture.layout, direction },
			}),
		);
		const file = createExcalidrawFile(scene);
		expect(validateExcalidrawScene({ ...scene, elements: file.elements }).issues).toEqual([]);
	},
);

it.each(["straight", "curved"] as const)(
	"exports %s feedback facing away from its source rectangle",
	(edgeRouting) => {
		const fixture = routingFixtures["review-feedback"];
		const scene = convertSceneToExcalidraw(
			renderIntermediateDiagram({
				...fixture,
				layout: { direction: "TB", edgeRouting },
			}),
		);
		const file = createExcalidrawFile(scene);
		const arrow = file.elements.find((e) => e.id === "edge:feedback")!;
		const source = file.elements.find((e) => e.id === "node:revise")!;
		const noLabel = file.elements.find((e) => e.id === "edge:no:label")!;
		const [start, end] = (arrow.points as [number, number][]).map(([x, y]) => ({
			x: Number(arrow.x) + x,
			y: Number(arrow.y) + y,
		}));
		const sample = {
			x: start!.x + (end!.x - start!.x) * 0.1,
			y: start!.y + (end!.y - start!.y) * 0.1,
		};
		const insideSource =
			sample.x > Number(source.x) &&
			sample.x < Number(source.x) + Number(source.width) &&
			sample.y > Number(source.y) &&
			sample.y < Number(source.y) + Number(source.height);
		expect(insideSource).toBe(false);
		for (let i = 1; i < 100; i++) {
			const x = start!.x + ((end!.x - start!.x) * i) / 100;
			const y = start!.y + ((end!.y - start!.y) * i) / 100;
			expect(
				x > Number(noLabel.x) &&
					x < Number(noLabel.x) + Number(noLabel.width) &&
					y > Number(noLabel.y) &&
					y < Number(noLabel.y) + Number(noLabel.height),
			).toBe(false);
		}
		expect(validateExcalidrawScene({ ...scene, elements: file.elements }).issues).toEqual([]);
	},
);

const skipEdges = [
	["A", "B"],
	["B", "C"],
	["C", "D"],
	["A", "C"],
	["B", "D"],
];
it.each(["LR", "RL"] as const)("exports labeled skip edges in %s", (direction) => {
	const spec = parseIntermediateDiagram({
		id: "horizontal-skips",
		title: "Paths",
		type: "flowchart",
		nodes: ["A", "B", "C", "D"].map((id) => ({ id, label: id, kind: "process" })),
		edges: skipEdges.map(([source, target], i) => ({
			id: `path-${i}`,
			source,
			target,
			label: `Path ${i}`,
		})),
		layout: { direction, edgeRouting: "orthogonal" },
	});
	expect(
		validateExcalidrawScene(convertSceneToExcalidraw(renderIntermediateDiagram(spec))).issues,
	).toEqual([]);
});

it("keeps process fan-out labels and departure stubs disjoint", () => {
	const spec = parseIntermediateDiagram({
		id: "fanout",
		title: "Fan out",
		type: "flowchart",
		nodes: ["A", "B", "C"].map((id) => ({ id, label: id, kind: "process" })),
		edges: ["B", "C"].map((target, i) => ({
			id: target,
			source: "A",
			target,
			label: ["First", "Second"][i],
		})),
		layout: { direction: "TB", edgeRouting: "orthogonal" },
	});
	const rendered = renderIntermediateDiagram(spec);
	const exported = convertSceneToExcalidraw(rendered);
	const labels = exported.elements
		.filter((e) => e.type === "text" && e.containerId === null)
		.map((e) => ({
			id: e.id,
			x: Number(e.x),
			y: Number(e.y),
			width: Number(e.width),
			height: Number(e.height),
		}));
	expect(labels).toHaveLength(2);
	const [a, b] = labels;
	expect(
		a!.x < b!.x + b!.width &&
			a!.x + a!.width > b!.x &&
			a!.y < b!.y + b!.height &&
			a!.y + a!.height > b!.y,
	).toBe(false);
	for (const label of labels)
		for (const arrow of rendered.elements.filter((e) => e.type === "arrow")) {
			expect(
				segmentsFromPoints(arrow.points).some((segment) =>
					segmentCrossesBoundsInterior(segment, label),
				),
				`${label.id}/${arrow.id}`,
			).toBe(false);
		}
	expect(validateExcalidrawScene(exported).issues).toEqual([]);
});

it("exports exactly one positioned label after clearing groups", () => {
	const scene = renderIntermediateDiagram(routingFixtures["pharma-batch-disposition"]);
	const exported = convertSceneToExcalidraw({
		...scene,
		elements: scene.elements.map((e) => ({ ...e, groupIds: [] })),
	});
	expect(new Set(exported.elements.map((e) => e.id)).size).toBe(exported.elements.length);
});

describe.each(["departure", "arrival"] as const)("shared bound %s stems", (endpoint) => {
	function validation(offset: number) {
		const scene = convertSceneToExcalidraw(renderIntermediateDiagram(flowchartFixture));
		const first = [
			{ x: 0, y: 0 },
			{ x: 0, y: 100 },
			{ x: -100, y: 100 },
		];
		const second = [
			{ x: 0, y: offset },
			{ x: 0, y: 60 },
			{ x: 100, y: 60 },
		];
		scene.elements = [first, second].map((points, i) => {
			const ordered = endpoint === "arrival" ? points.toReversed() : points;
			return {
				id: `arrow-${i}`,
				type: "arrow",
				x: 0,
				y: 0,
				points: ordered.map((p) => [p.x, p.y]),
				startBinding: { elementId: endpoint === "departure" ? "shared" : `source-${i}` },
				endBinding: { elementId: endpoint === "arrival" ? "shared" : `target-${i}` },
			};
		});
		return validateExcalidrawScene(scene).issues.filter(
			(issue) => issue.code === "overlapping-arrow-segment",
		);
	}
	it("allows a common directed endpoint that fans out or merges", () => {
		expect(validation(0)).toEqual([]);
	});
	it("does not exempt coincident interiors with different bound endpoints", () => {
		expect(validation(20)).toHaveLength(1);
	});
});

it("allows straight merges with unbound starts and the same directed arrival", () => {
	const scene = convertSceneToExcalidraw(renderIntermediateDiagram(flowchartFixture));
	scene.elements = [0, 20].map((y, i) => ({
		id: `merge-${i}`,
		type: "arrow",
		x: 0,
		y: 0,
		points: [
			[0, y],
			[0, 100],
		],
		startBinding: null,
		endBinding: { elementId: "shared" },
	}));
	expect(
		validateExcalidrawScene(scene).issues.filter(
			(issue) => issue.code === "overlapping-arrow-segment",
		),
	).toEqual([]);
});
