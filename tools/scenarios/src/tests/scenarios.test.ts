// Every grader passes its own catalog, fails a minimal break of each matcher, and still accepts
// the rewordings real models write. Positive fixtures unwrap Results: failure is bad test data.
import type { FlowchartDiagram } from "@sketchi/diagrams/families/flowchart/document";
import { parseMindmap, type MindmapTopic } from "@sketchi/diagrams/families/mindmap/index";
import { renderDiagram } from "@sketchi/diagrams/family";
import type { CanvasSpec } from "@sketchi/drawing";
import { Result } from "effect";
import { describe, expect, it } from "vitest";

import {
	chartClearRulesCheck,
	chartDrawnDataCheck,
	chartGeometryCheck,
	chartPieLabelCheck,
	chartScenarios,
} from "../lib/chart-scenarios";
import { classClearanceCheck, classDrawnCheck, classScenarios } from "../lib/class-scenarios";
import { type DiagramScenario, diagramScenarios } from "../lib/diagram-scenarios";
import { erDrawnCheck, erScenarios } from "../lib/er-scenarios";
import {
	evaluateScenarioDiagram,
	evaluateScenarioFixture,
	type ScenarioCheck,
} from "../lib/evaluate";
import {
	ganttClearanceCheck,
	ganttDrawnDataCheck,
	ganttGeometryCheck,
	ganttScenarios,
} from "../lib/gantt-scenarios";
import { journeyDrawnCheck, journeyLayoutCheck, journeyScenarios } from "../lib/journey-scenarios";
import { mindmapLayoutCheck, mindmapScenarios } from "../lib/mindmap-scenarios";
import {
	orgChartDrawnCheck,
	orgChartLayoutCheck,
	orgChartScenarios,
} from "../lib/org-chart-scenarios";
import {
	quadrantDrawnCheck,
	quadrantLayoutCheck,
	quadrantScenarios,
} from "../lib/quadrant-scenarios";
import { sankeyDrawnCheck, sankeyLayoutCheck, sankeyScenarios } from "../lib/sankey-scenarios";
import { getFlowchartScenario } from "../lib/scenarios";
import { getSequenceScenario } from "../lib/sequence-scenarios";
import { stateMachineScenarios } from "../lib/state-machine-scenarios";
import {
	timelineGapOrderCheck,
	timelineScenarios,
	timelineSpacingCheck,
} from "../lib/timeline-scenarios";
import { vennDrawnCheck, vennLayoutCheck, vennScenarios } from "../lib/venn-scenarios";
import {
	wireframeDrawnCheck,
	wireframeLayoutCheck,
	wireframeScenarios,
} from "../lib/wireframe-scenarios";

function pick<S extends { readonly id: string }>(list: readonly S[], id: string): S {
	const found = list.find((entry) => entry.id === id);
	if (!found) throw new Error(`No scenario ${id}.`);
	return found;
}

function grade(scenario: DiagramScenario, candidate: unknown) {
	return evaluateScenarioDiagram(scenario, candidate).pipe(Result.getOrThrow);
}

/** Replace items by id; a missing id is a broken test, not a passing one. */
function withItems<T extends { readonly id: string }>(
	items: readonly T[],
	changes: Readonly<Record<string, (item: T) => T>>,
): T[] {
	for (const id of Object.keys(changes))
		if (!items.some((item) => item.id === id)) throw new Error(`No item ${id}.`);
	return items.map((item) => changes[item.id]?.(item) ?? item);
}

function flowchart(
	id: string,
	nodes: Readonly<Record<string, Partial<FlowchartDiagram["nodes"][number]>>> = {},
	edges: Readonly<Record<string, Partial<FlowchartDiagram["edges"][number]>>> = {},
) {
	const scenario = getFlowchartScenario(id);
	const diagram = scenario.expectedDiagram;
	const patch =
		<T>(changes: Readonly<Record<string, Partial<T>>>) =>
		(key: string) =>
		(item: T): T => ({ ...item, ...changes[key] });
	return {
		scenario,
		diagram: {
			...diagram,
			nodes: withItems(
				diagram.nodes,
				Object.fromEntries(Object.keys(nodes).map((key) => [key, patch(nodes)(key)])),
			),
			edges: withItems(
				diagram.edges,
				Object.fromEntries(Object.keys(edges).map((key) => [key, patch(edges)(key)])),
			),
		},
	};
}

/** Route one onboarding edge through extra unmatched stages. */
function subdivided(
	stages: readonly { id: string; label: string; kind: "process" | "decision" }[],
) {
	const { scenario, diagram } = flowchart("sketchi-onboarding-decision-flow");
	const edge = diagram.edges.find((candidate) => candidate.id === "clear-draft")!;
	const chain = [edge.source, ...stages.map((stage) => stage.id), edge.target];
	return {
		scenario,
		diagram: {
			...diagram,
			nodes: [...diagram.nodes, ...stages],
			edges: [
				...diagram.edges.filter((candidate) => candidate.id !== edge.id),
				...chain.slice(1).map((target, index) => ({
					id: `clear-draft-${index}`,
					source: chain[index]!,
					target,
					...(index === 0
						? { label: "yes" }
						: stages[index - 1]?.kind === "decision"
							? { label: "yes" }
							: {}),
				})),
				...stages
					.filter((stage) => stage.kind === "decision")
					.map((stage) => ({
						id: `${stage.id}-no`,
						source: stage.id,
						target: "review",
						label: "no",
					})),
			],
		},
	};
}

function onScene(diagram: Parameters<typeof renderDiagram>[0]) {
	const scene = renderDiagram(diagram).pipe(Result.getOrThrow);
	const element = (id: string) => {
		const found = scene.elements.find(
			(entry) => entry.id === id || ("nodeId" in entry && entry.nodeId === id),
		);
		if (!found) throw new Error(`No scene element ${id}.`);
		return found;
	};
	return {
		scene,
		element,
		/** The scene with one element changed or, when `change` returns undefined, removed. */
		edit(
			id: string,
			change: (value: CanvasSpec["elements"][number]) => CanvasSpec["elements"][number] | undefined,
		): CanvasSpec {
			const target = element(id);
			return {
				...scene,
				elements: scene.elements.flatMap((entry) =>
					entry === target ? (change(entry) ?? []) : [entry],
				),
			};
		},
	};
}

const moveBy =
	(dx: number, dy = 0) =>
	(element: CanvasSpec["elements"][number]) =>
		"x" in element && "y" in element
			? { ...element, x: element.x + dx, y: element.y + dy }
			: element;

describe("scenario graders", () => {
	it("pass every maintained scenario's own diagram, scene checks included", () => {
		for (const scenario of diagramScenarios) {
			const result = evaluateScenarioFixture(scenario).pipe(Result.getOrThrow);
			const failed = result.checks.filter((check) => !check.passed).map((check) => check.id);
			expect(failed, scenario.id).toEqual([]);
			expect(result.excalidrawValidation.issues, scenario.id).toEqual([]);
		}
	});

	const onboarding = "sketchi-onboarding-decision-flow";
	const semanticBreaks: readonly (readonly [
		string,
		() => { scenario: DiagramScenario; diagram: unknown },
		string,
	])[] = [
		[
			"flowchart: a stated step missing",
			() => flowchart(onboarding, { draft: { label: "Unrelated work" } }),
			"node-label:Draft typed IR",
		],
		[
			"flowchart: a decision drawn as a process",
			() => flowchart("incident-escalation", { severity: { kind: "process" } }),
			"node-label:Severity?",
		],
		[
			"flowchart: yes and no swapped",
			() =>
				flowchart(
					onboarding,
					{},
					{ "clear-draft": { label: "no" }, "clear-review": { label: "yes" } },
				),
			"edge:Scope clear?->Draft typed IR:yes",
		],
		[
			"flowchart: rewired with every label intact",
			() => flowchart(onboarding, {}, { "clear-review": { target: "draft" } }),
			"edge:Scope clear?->Review diagram:no",
		],
		[
			"flowchart: a connection through three unmatched stages",
			() =>
				subdivided([
					{ id: "extra-1", label: "Prepare workspace", kind: "process" },
					{ id: "extra-2", label: "Workspace ready?", kind: "decision" },
					{ id: "extra-3", label: "Record readiness", kind: "process" },
				]),
			"edge:Scope clear?->Draft typed IR:yes",
		],
		[
			"flowchart: two steps combined in one node, a named copy as padding",
			() => {
				const { scenario, diagram } = flowchart(onboarding, {
					draft: { label: "Extract requirements and draft typed IR" },
				});
				return {
					scenario,
					diagram: {
						...diagram,
						edges: [
							{ id: "a", source: "prompt", target: "draft" },
							{ id: "b", source: "draft", target: "clear" },
							{ id: "c", source: "clear", target: "draft", label: "yes" },
							{ id: "d", source: "clear", target: "review", label: "no" },
							{ id: "e", source: "draft", target: "review" },
							{ id: "f", source: "prompt", target: "requirements" },
							{ id: "g", source: "requirements", target: "review" },
						],
					},
				};
			},
			"edge:Extract requirements->Scope clear?",
		],
		[
			"flowchart: a negated step",
			() => flowchart("incident-escalation", { resolved: { label: "Incident not resolved" } }),
			"node-label:Incident resolved",
		],
		[
			"flowchart: a step in the wrong lane",
			() => flowchart("swimlane-order-fulfilment-v2", { pay: { lane: "finance" } }),
			"lane-members:Customer",
		],
		[
			"flowchart: a step in the wrong group",
			() => flowchart("grouped-expense-approval-v2", { revise: { group: "manager" } }),
			"group-members:Employee",
		],
		[
			"flowchart: a step the prompt keeps outside drawn inside",
			() => flowchart("kubernetes-cluster-zones-v2", { queue: { group: "cluster" } }),
			"outside-group:RabbitMQ queue:GKE cluster",
		],
		[
			"flowchart: nested zones drawn flat",
			() => {
				const { scenario, diagram } = flowchart("aws-three-tier-zones-v2");
				return {
					scenario,
					diagram: {
						...diagram,
						groups: diagram
							.groups!.filter((group) => group.id !== "vpc")
							.map(({ parent: _parent, ...group }) => group),
					},
				};
			},
			"zone-parent:Public subnet",
		],
		[
			"flowchart: a named logo missing",
			() => flowchart("deploy-pipeline-logos", { build: { icon: undefined } }),
			"icon:docker",
		],
		[
			"flowchart: an invented logo",
			() => flowchart("deploy-pipeline-logos", { tests: { icon: { slug: "kubernetes" } } }),
			"icons-grounded",
		],
		[
			"flowchart: avoidable crossings",
			() => {
				const scenario = getFlowchartScenario("support-chat-queue");
				return {
					scenario,
					diagram: {
						...scenario.expectedDiagram,
						layout: { direction: "TB", edgeRouting: "straight" },
					},
				};
			},
			"avoidable-crossings",
		],
		[
			"flowchart: square lines where the prompt asks for curves",
			() => {
				const scenario = getFlowchartScenario("feedback-triage-curved");
				return {
					scenario,
					diagram: {
						...scenario.expectedDiagram,
						layout: { ...scenario.expectedDiagram.layout, edgeRouting: "orthogonal" },
					},
				};
			},
			"curved-lines",
		],
		[
			"sequence: a participant missing",
			() => {
				const scenario = getSequenceScenario("oauth-authorization-code-sequence");
				const diagram = scenario.expectedDiagram;
				return {
					scenario,
					diagram: {
						...diagram,
						participants: withItems(diagram.participants, {
							idp: (p) => ({ ...p, label: "Login Server" }),
						}),
					},
				};
			},
			"participant:identity",
		],
		[
			"mindmap: a topic under the wrong parent",
			() => {
				const scenario = pick(mindmapScenarios, "team-offsite-mindmap-v2");
				const children = (topic: MindmapTopic) => [...(topic.children ?? [])];
				const root = scenario.expectedDiagram.root;
				const moved = {
					...root,
					children: children(root).map((branch) =>
						branch.label === "Activities"
							? {
									...branch,
									children: children(branch).filter((topic) => topic.label !== "Hiking"),
								}
							: branch.label === "Food"
								? { ...branch, children: [...children(branch), { label: "Hiking" }] }
								: branch,
					),
				};
				return {
					scenario,
					diagram: parseMindmap({ id: scenario.id, title: scenario.title, root: moved }).pipe(
						Result.getOrThrow,
					),
				};
			},
			"topic-parent:hiking",
		],
		[
			"state machine: the initial state renamed",
			() => {
				const scenario = stateMachineScenarios[0]!;
				const diagram = scenario.expectedDiagram;
				return {
					scenario,
					diagram: {
						...diagram,
						states: withItems(diagram.states, {
							[diagram.initial]: (s) => ({ ...s, label: "Invented state" }),
						}),
					},
				};
			},
			"initial-state",
		],
		[
			"gantt: a wrong start date",
			() => {
				const scenario = pick(ganttScenarios, "app-release-gantt-v2");
				const diagram = scenario.expectedDiagram;
				return {
					scenario,
					diagram: {
						...diagram,
						tasks: withItems(diagram.tasks, { api: (t) => ({ ...t, start: "2026-04-14" }) }),
					},
				};
			},
			"gantt-dates:api",
		],
		[
			"er: a wrong cardinality",
			() => {
				const scenario = pick(erScenarios, "shop-orders-er-v2");
				const diagram = scenario.expectedDiagram;
				return {
					scenario,
					diagram: {
						...diagram,
						relationships: withItems(diagram.relationships, {
							r1: (r) => ({ ...r, toCardinality: "one" as const }),
						}),
					},
				};
			},
			"cardinality:1",
		],
		[
			"class: an invented class",
			() => {
				const scenario = pick(classScenarios, "shape-hierarchy-class-v2");
				const diagram = scenario.expectedDiagram;
				return {
					scenario,
					diagram: {
						...diagram,
						classes: [...diagram.classes, { id: "Triangle", attributes: [], methods: [] }],
					},
				};
			},
			"classes-exact",
		],
		[
			"org chart: a report under the wrong manager",
			() => {
				const scenario = pick(orgChartScenarios, "startup-team-org-chart-v2");
				const diagram = scenario.expectedDiagram;
				return {
					scenario,
					diagram: {
						...diagram,
						people: withItems(diagram.people, { casey: (p) => ({ ...p, manager: "sam" }) }),
					},
				};
			},
			"manager:casey",
		],
		[
			"journey: a changed score",
			() => {
				const scenario = pick(journeyScenarios, "online-purchase-journey-v2");
				const diagram = scenario.expectedDiagram;
				return {
					scenario,
					diagram: {
						...diagram,
						stages: diagram.stages.map((stage, at) =>
							at === 2
								? {
										...stage,
										steps: stage.steps.map((step, index) =>
											index === 1 ? { ...step, score: 4 } : step,
										),
									}
								: stage,
						),
					},
				};
			},
			"score:apple-pay",
		],
		[
			"sankey: a changed flow value",
			() => {
				const scenario = pick(sankeyScenarios, "cloud-budget-sankey-v2");
				const diagram = scenario.expectedDiagram;
				return {
					scenario,
					diagram: {
						...diagram,
						links: diagram.links.map((link) =>
							link.source === "engineering" && link.target === "compute"
								? { ...link, value: 301 }
								: link,
						),
					},
				};
			},
			"flow:engineering->compute",
		],
		[
			"wireframe: a phone screen drawn for desktop",
			() => {
				const scenario = pick(wireframeScenarios, "mobile-login-wireframe");
				const diagram = scenario.expectedDiagram;
				return {
					scenario,
					diagram: {
						...diagram,
						screens: [{ ...diagram.screens[0]!, device: "desktop" as const }],
					},
				};
			},
			"device:login",
		],
		[
			"quadrant: a point across a midline",
			() => {
				const scenario = pick(quadrantScenarios, "effort-impact-quadrant-v2");
				const diagram = scenario.expectedDiagram;
				return {
					scenario,
					diagram: {
						...diagram,
						points: diagram.points.map((point) =>
							point.label === "Dark mode" ? { ...point, x: 0.6 } : point,
						),
					},
				};
			},
			"position:dark-mode",
		],
		[
			"timeline: an event renamed",
			() => {
				const scenario = pick(timelineScenarios, "lunar-mission-timeline-v2");
				const diagram = scenario.expectedDiagram;
				return {
					scenario,
					diagram: {
						...diagram,
						events: diagram.events.map((event, at) =>
							at === 0 ? { ...event, label: "Invented event" } : event,
						),
					},
				};
			},
			"timeline-event:1",
		],
		[
			"chart: a wrong value",
			() => {
				const scenario = pick(chartScenarios, "net-income-bar-chart");
				const diagram = scenario.expectedDiagram;
				return {
					scenario,
					diagram: {
						...diagram,
						series: diagram.series.map((series) => ({
							...series,
							values: series.values.map((value, i) => (i === 0 ? value + 1 : value)),
						})),
					},
				};
			},
			"chart-series:1",
		],
		[
			"venn: an item in a neighbouring region",
			() => {
				const scenario = pick(vennScenarios, "team-skills-venn");
				const diagram = scenario.expectedDiagram;
				const regions = diagram.regions.map((region) => ({
					...region,
					items: (region.items ?? []).filter((item) => item !== "Prototyping"),
				}));
				const design = regions.find(
					(region) => region.sets.length === 1 && region.sets[0] === "design",
				)!;
				design.items = [...design.items, "Prototyping"];
				return {
					scenario,
					diagram: { ...diagram, regions: regions.filter((region) => region.items.length > 0) },
				};
			},
			"region:prototyping",
		],
	];

	it.each(semanticBreaks)("fail %s", (_name, broken, checkId) => {
		const { scenario, diagram } = broken();
		const result = grade(scenario, diagram);
		expect(result.ok).toBe(false);
		expect(result.checks.find((check) => check.id === checkId)?.passed).toBe(false);
	});

	// Each check that reads the drawn scene fails one tampered scene. The catalog test above
	// shows each passes the untouched one.
	const sceneBreaks: readonly (readonly [string, () => ScenarioCheck])[] = [
		[
			"chart geometry: a bar drawn too tall",
			() => {
				const { expectedDiagram } = pick(chartScenarios, "net-income-bar-chart");
				const drawn = onScene(expectedDiagram);
				return chartGeometryCheck(
					expectedDiagram,
					drawn.edit("chart:bar:0:0", (e) =>
						e.type === "node" ? { ...e, height: e.height * 1.5 } : e,
					),
				);
			},
		],
		[
			"chart drawn data: a value label dropped",
			() => {
				const scenario = pick(chartScenarios, "support-tickets-stacked-bar-chart");
				return chartDrawnDataCheck(
					scenario,
					scenario.expectedDiagram,
					onScene(scenario.expectedDiagram).edit("chart:value:2:2", () => undefined),
				);
			},
		],
		[
			"chart rules: a gridline through a value label",
			() => {
				const drawn = onScene(pick(chartScenarios, "quarterly-revenue-bar-chart").expectedDiagram);
				const label = drawn.element("chart:value:1:1");
				const y = "y" in label ? label.y : 0;
				return chartClearRulesCheck(
					drawn.edit("chart:grid:1", (e) =>
						e.type === "line"
							? {
									...e,
									points: [
										{ x: 0, y },
										{ x: 2000, y },
									] as typeof e.points,
								}
							: e,
					),
				);
			},
		],
		[
			"chart pie labels: a share misprinted",
			() => {
				const { expectedDiagram } = pick(chartScenarios, "cloud-spend-pie-chart");
				return chartPieLabelCheck(
					expectedDiagram,
					onScene(expectedDiagram).edit("chart:slice-label:4", (e) =>
						e.type === "text" ? { ...e, text: "Licenses\n1.1% · $7k" } : e,
					),
				);
			},
		],
		[
			"gantt geometry: a bar off its dates",
			() => {
				const { expectedDiagram } = pick(ganttScenarios, "data-platform-migration-gantt-v2");
				return ganttGeometryCheck(
					expectedDiagram,
					onScene(expectedDiagram).edit("node:gantt:task:crm", moveBy(10)),
				);
			},
		],
		[
			"gantt drawn data: a wrong date caption",
			() => {
				const scenario = pick(ganttScenarios, "data-platform-migration-gantt-v2");
				return ganttDrawnDataCheck(
					scenario,
					scenario.expectedDiagram,
					onScene(scenario.expectedDiagram).edit("gantt:caption:crm", (e) =>
						e.type === "text" ? { ...e, text: "Mar 23 – Apr 11" } : e,
					),
				);
			},
		],
		[
			"gantt clearance: a label over a bar",
			() =>
				ganttClearanceCheck(
					onScene(pick(ganttScenarios, "data-platform-migration-gantt-v2").expectedDiagram).edit(
						"gantt:label:crm",
						moveBy(0, 50),
					),
				),
		],
		[
			"timeline spacing: an event off its date",
			() => {
				const scenario = pick(timelineScenarios, "library-releases-timeline-v2");
				return timelineSpacingCheck(
					scenario,
					scenario.expectedDiagram,
					onScene(scenario.expectedDiagram).edit("event:v10", moveBy(-120)),
				);
			},
		],
		[
			"timeline gap order: a long gap drawn no longer than a short one",
			() => {
				const scenario = pick(timelineScenarios, "library-releases-timeline-v2");
				const drawn = onScene(scenario.expectedDiagram);
				const x = (id: string) => {
					const marker = drawn.element(id);
					return "x" in marker ? marker.x : 0;
				};
				const shift = x("event:v10") - x("event:v03") - (x("event:v20") - x("event:v10"));
				return timelineGapOrderCheck(
					scenario,
					scenario.expectedDiagram,
					drawn.edit("event:v20", moveBy(shift)),
				);
			},
		],
		[
			"mindmap layout: a topic over another",
			() => {
				const drawn = onScene(mindmapScenarios[0]!.expectedDiagram);
				const topics = drawn.scene.elements.filter((e) => e.type === "node");
				const [first, second] = [topics[1]!, topics[2]!];
				return mindmapLayoutCheck(
					drawn.edit(second.id, (e) =>
						"x" in e && "x" in first ? { ...e, x: first.x, y: first.y } : e,
					),
				);
			},
		],
		[
			"er drawing: a head for the wrong cardinality",
			() => {
				const { expectedDiagram } = pick(erScenarios, "shop-orders-er-v2");
				const drawn = onScene(expectedDiagram);
				const arrow = drawn.scene.elements.find((e) => e.type === "arrow" && e.edgeId === "r2")!;
				return erDrawnCheck(
					expectedDiagram,
					drawn.edit(arrow.id, (e) => ({ ...e, endArrowhead: "crowfoot_many" as const })),
				);
			},
		],
		[
			"class drawing: a composition drawn as aggregation",
			() => {
				const { expectedDiagram } = pick(classScenarios, "online-shop-domain-class-v2");
				const drawn = onScene(expectedDiagram);
				const arrow = drawn.scene.elements.find((e) => e.type === "arrow" && e.edgeId === "r3")!;
				return classDrawnCheck(
					expectedDiagram,
					drawn.edit(arrow.id, (e) => ({ ...e, startArrowhead: "diamond_outline" as const })),
				);
			},
		],
		[
			"class clearance: a multiplicity on its class box",
			() => {
				const drawn = onScene(pick(classScenarios, "online-shop-domain-class-v2").expectedDiagram);
				const order = drawn.element("Order");
				return classClearanceCheck(
					drawn.edit("relationship:r1:to:multiplicity", (e) =>
						"x" in order && "y" in order ? { ...e, x: order.x + 30, y: order.y + 30 } : e,
					),
				);
			},
		],
		[
			"quadrant drawing: a dot off its position",
			() => {
				const { expectedDiagram } = pick(quadrantScenarios, "competitor-positioning-quadrant-v2");
				return quadrantDrawnCheck(
					expectedDiagram,
					onScene(expectedDiagram).edit("quadrant:point:0", moveBy(12)),
				);
			},
		],
		[
			"quadrant layout: a label over another",
			() => {
				const { expectedDiagram } = pick(quadrantScenarios, "competitor-positioning-quadrant-v2");
				const drawn = onScene(expectedDiagram);
				const other = drawn.element("quadrant:label:1");
				return quadrantLayoutCheck(
					expectedDiagram,
					drawn.edit("quadrant:label:0", (e) =>
						"x" in other && "y" in other ? { ...e, x: other.x, y: other.y } : e,
					),
				);
			},
		],
		[
			"org chart drawing: a dotted line dropped",
			() => {
				const { expectedDiagram } = pick(orgChartScenarios, "leadership-dotted-line-org-chart-v2");
				return orgChartDrawnCheck(
					expectedDiagram,
					onScene(expectedDiagram).edit("edge:dotted:nina-dotted-linda", () => undefined),
				);
			},
		],
		[
			"org chart layout: a card moved onto its line",
			() =>
				orgChartLayoutCheck(
					onScene(
						pick(orgChartScenarios, "leadership-dotted-line-org-chart-v2").expectedDiagram,
					).edit("node:grace", moveBy(40, -60)),
				),
		],
		[
			"journey drawing: a face between columns",
			() => {
				const { expectedDiagram } = pick(journeyScenarios, "online-purchase-journey-v2");
				return journeyDrawnCheck(
					expectedDiagram,
					onScene(expectedDiagram).edit("node:journey:face:0-0", moveBy(70)),
				);
			},
		],
		[
			"journey layout: overlapping cards",
			() =>
				journeyLayoutCheck(
					onScene(pick(journeyScenarios, "online-purchase-journey-v2").expectedDiagram).edit(
						"node:journey:step:0-1",
						moveBy(-60),
					),
				),
		],
		[
			"sankey drawing: a band dropped",
			() => {
				const { expectedDiagram } = pick(sankeyScenarios, "cloud-budget-sankey-v2");
				return sankeyDrawnCheck(
					expectedDiagram,
					onScene(expectedDiagram).edit("node:sankey:link:engineering:compute", () => undefined),
				);
			},
		],
		[
			"sankey layout: a covered label",
			() => {
				const { expectedDiagram } = pick(sankeyScenarios, "cloud-budget-sankey-v2");
				return sankeyLayoutCheck(
					expectedDiagram,
					onScene(expectedDiagram).edit("text:sankey:node:compute", moveBy(-120)),
				);
			},
		],
		[
			"wireframe drawing: a button label dropped",
			() => {
				const { expectedDiagram } = pick(wireframeScenarios, "mobile-login-wireframe");
				return wireframeDrawnCheck(
					expectedDiagram,
					onScene(expectedDiagram).edit("wf:login:5:label", () => undefined),
				);
			},
		],
		[
			"wireframe layout: a component over another",
			() =>
				wireframeLayoutCheck(
					onScene(pick(wireframeScenarios, "mobile-login-wireframe").expectedDiagram).edit(
						"wf:login:5:box",
						moveBy(0, -30),
					),
				),
		],
		[
			"venn drawing: set labels swapped",
			() => {
				const { expectedDiagram } = pick(vennScenarios, "team-skills-venn");
				const drawn = onScene(expectedDiagram);
				const [first, second] = [
					drawn.element("venn:set:0:label"),
					drawn.element("venn:set:1:label"),
				];
				return vennDrawnCheck(expectedDiagram, {
					...drawn.scene,
					elements: drawn.scene.elements.map((e) =>
						e === first
							? { ...second, id: first.id }
							: e === second
								? { ...first, id: second.id }
								: e,
					),
				});
			},
		],
		[
			"venn layout: overlapping items",
			() => {
				const drawn = onScene(pick(vennScenarios, "team-skills-venn").expectedDiagram);
				const item = drawn.element("venn:region:0:item:0");
				return vennLayoutCheck(
					drawn.edit("venn:region:0:item:1", (e) => ("y" in item ? { ...e, y: item.y } : e)),
				);
			},
		],
	];

	it.each(sceneBreaks)("fail %s", (_name, check) => {
		expect(check().passed).toBe(false);
	});

	// A grader that turns strict shows up in Frontierclimb as a false quality regression.
	const rewordings: readonly (readonly [
		string,
		() => { scenario: DiagramScenario; diagram: unknown },
	])[] = [
		[
			"punctuation, case and inflection",
			() =>
				flowchart(onboarding, {
					prompt: { label: "A prompt is received" },
					requirements: { label: "Extracts requirements" },
					clear: { label: "Is the SCOPE clear?" },
					draft: { label: "Drafts typed-IR" },
					review: { label: "Review" },
				}),
		],
		[
			"a stated step without its leading verb",
			() => flowchart("patient-intake-scheduling", { routine: { label: "Routine appointment" } }),
		],
		[
			"a separate end node for each path",
			() => {
				const { scenario, diagram } = flowchart(
					onboarding,
					{ review: { label: "Review clear request" } },
					{ "clear-review": { target: "unclear-review" } },
				);
				return {
					scenario,
					diagram: {
						...diagram,
						nodes: [
							...diagram.nodes,
							{ id: "unclear-review", label: "Review unclear request", kind: "end" as const },
						],
					},
				};
			},
		],
		[
			"a connection through two unmatched stages",
			() =>
				subdivided([
					{ id: "extra-action", label: "Prepare workspace", kind: "process" },
					{ id: "extra-check", label: "Workspace ready?", kind: "decision" },
				]),
		],
		[
			"a terminal action split into a process and its end",
			() => {
				const { scenario, diagram } = flowchart("incident-response-code-mode-proof", {
					"vendor-escalation": { kind: "process" },
				});
				return {
					scenario,
					diagram: {
						...diagram,
						nodes: [...diagram.nodes, { id: "provider-end", label: "End", kind: "end" as const }],
						edges: [
							...diagram.edges,
							{ id: "provider-done", source: "vendor-escalation", target: "provider-end" },
						],
					},
				};
			},
		],
		[
			"an intermediate step drawn as two nodes in a row",
			() => {
				const { scenario, diagram } = flowchart(
					onboarding,
					{},
					{ "requirements-clear": { source: "requirements-b" } },
				);
				return {
					scenario,
					diagram: {
						...diagram,
						nodes: [
							...diagram.nodes,
							{ id: "requirements-b", label: "Extract requirements", kind: "process" as const },
						],
						edges: [
							...diagram.edges,
							{ id: "internal-requirements", source: "requirements", target: "requirements-b" },
						],
					},
				};
			},
		],
		[
			"a decision asked by its opposite condition, answers swapped",
			() =>
				flowchart(
					"expense-reimbursement",
					{ "receipt-attached": { label: "Receipt missing?" } },
					swappedAnswers("expense-reimbursement", "receipt-attached"),
				),
		],
		[
			"a dimension question answered by its values",
			() =>
				flowchart(
					"password-reset-security",
					{ "risk-high": { label: "Risk level?" } },
					{ "risk-step-up": { label: "High risk" }, "risk-reset": { label: "Low risk" } },
				),
		],
		[
			"a branch that restates its criterion",
			() => flowchart("ci-release-gate", {}, { "canary-rollback": { label: "Unhealthy" } }),
		],
		[
			"a prompt-derived branch caption",
			() => flowchart("pharma-batch-disposition", {}, { "specs-pass": { label: "Passing" } }),
		],
		[
			"a branch target qualified by its branch",
			() =>
				flowchart(
					"incident-escalation",
					{ monitor: { label: "Monitoring" } },
					{ "severity-low": { label: "Low" } },
				),
		],
	];

	it.each(rewordings)("accept %s", (_name, reworded) => {
		const { scenario, diagram } = reworded();
		const result = grade(scenario, diagram);
		expect(result.checks.filter((check) => !check.passed).map((check) => check.id)).toEqual([]);
		expect(result.ok).toBe(true);
	});
});

function swappedAnswers(scenarioId: string, decision: string) {
	const swapped: Record<string, string> = { yes: "no", no: "yes" };
	return Object.fromEntries(
		getFlowchartScenario(scenarioId)
			.expectedDiagram.edges.filter(
				(edge) => edge.source === decision && edge.label && swapped[edge.label],
			)
			.map((edge) => [edge.id, { label: swapped[edge.label!] }]),
	);
}
