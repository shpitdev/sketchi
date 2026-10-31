import { describe, expect, it } from "vitest";

import {
	type MindmapDiagram,
	type MindmapTopicTree,
	mindmapDiagramFromTree,
} from "@sketchi/diagram-core";

import { evaluateScenarioDiagram } from "./evaluate.js";
import { candidateFromMcpResult } from "./mcp-results.js";
import { mindmapAlternativesGrounded, mindmapScenarios } from "./mindmap-scenarios.js";

const scenario = (id: string) => mindmapScenarios.find((entry) => entry.id === id)!;
const failed = (id: string, diagram: MindmapDiagram) =>
	evaluateScenarioDiagram(scenario(id), diagram)
		.checks.filter((check) => !check.passed)
		.map((check) => check.id);

/** The scenario's expected map as a nested tree, to edit and rebuild. */
function treeOf(diagram: MindmapDiagram): MindmapTopicTree {
	const children = (id: string): MindmapTopicTree[] =>
		diagram.edges
			.filter((edge) => edge.source === id)
			.toSorted((a, b) => a.metadata.siblingIndex - b.metadata.siblingIndex)
			.map((edge) => ({
				label: diagram.nodes.find((node) => node.id === edge.target)!.label,
				children: children(edge.target),
			}));
	const root = diagram.nodes.find((node) => node.kind === "root")!;
	return { label: root.label, children: children(root.id) };
}

/** Rebuild the scenario's map with `edit` applied to its tree. */
function edited(id: string, edit: (root: MindmapTopicTree) => MindmapTopicTree): MindmapDiagram {
	return mindmapDiagramFromTree({
		id,
		title: scenario(id).title,
		root: edit(treeOf(scenario(id).expectedDiagram)),
	});
}

const children = (topic: MindmapTopicTree) => [...(topic.children ?? [])];
const depth = (topic: MindmapTopicTree): number => 1 + Math.max(0, ...children(topic).map(depth));

describe("prompt-grounded mindmap scenarios", () => {
	it("covers a brainstorm, three-level notes, a wide plan and two large maps", () => {
		const sizes = mindmapScenarios
			.filter((entry) => !entry.id.endsWith("-v2"))
			.map((entry) => ({
				id: entry.id,
				topics: entry.expectedDiagram.nodes.length,
				main: entry.expectedDiagram.edges.filter((edge) => edge.metadata.depth === 1).length,
				levels: depth(treeOf(entry.expectedDiagram)) - 1,
			}));
		expect(sizes).toEqual([
			{ id: "team-offsite-mindmap", topics: 14, main: 4, levels: 2 },
			{ id: "photosynthesis-study-mindmap", topics: 22, main: 3, levels: 3 },
			{ id: "app-launch-planning-mindmap", topics: 24, main: 7, levels: 2 },
			{ id: "ml-roadmap-mindmap", topics: 41, main: 7, levels: 3 },
			{ id: "animal-kingdom-mindmap", topics: 42, main: 2, levels: 5 },
		]);
		// Each real-voice v2 asks for the same map as its original.
		for (const entry of mindmapScenarios.filter((candidate) => candidate.id.endsWith("-v2")))
			expect(entry.expectedDiagram.nodes.map((node) => node.label)).toEqual(
				scenario(entry.id.slice(0, -"-v2".length)).expectedDiagram.nodes.map((node) => node.label),
			);
	});

	for (const entry of mindmapScenarios) {
		it(`${entry.id}: grounds every topic in the prompt`, () => {
			for (const [key, topic] of Object.entries(entry.assertions.topics))
				expect(mindmapAlternativesGrounded(entry.prompt, topic.labels), key).toBe(true);
			for (const node of entry.expectedDiagram.nodes)
				expect(entry.prompt, node.label).toContain(node.label);
		});

		it(`${entry.id}: accepts its fixture with zero validator issues`, () => {
			const evaluation = evaluateScenarioDiagram(entry, entry.expectedDiagram);
			expect(evaluation.checks.filter((check) => !check.passed)).toEqual([]);
			expect(evaluation.excalidrawValidation.issues).toEqual([]);
			expect(evaluation.checks.map((check) => check.id)).toContain("mindmap-layout");
		});

		it(`${entry.id}: requires every stated topic`, () => {
			const root = treeOf(entry.expectedDiagram);
			// Drop each main branch's last child in turn.
			children(root).forEach((branch, index) => {
				const last = children(branch).at(-1);
				if (!last) return;
				const without = edited(entry.id, (tree) => ({
					...tree,
					children: children(tree).map((other, at) =>
						at === index ? { ...other, children: children(other).slice(0, -1) } : other,
					),
				}));
				expect(failed(entry.id, without), last.label).not.toEqual([]);
			});
		});
	}

	it("checks each topic's parent", () => {
		// Hiking moved from Activities to Food.
		const moved = edited("team-offsite-mindmap", (tree) => ({
			...tree,
			children: children(tree).map((branch) =>
				branch.label === "Activities"
					? { ...branch, children: children(branch).filter((topic) => topic.label !== "Hiking") }
					: branch.label === "Food"
						? { ...branch, children: [...children(branch), { label: "Hiking" }] }
						: branch,
			),
		}));
		expect(failed("team-offsite-mindmap", moved)).toEqual(["topic-parent:hiking"]);
	});

	it("rejects invented and duplicated topics", () => {
		const invented = edited("team-offsite-mindmap", (tree) => ({
			...tree,
			children: [...children(tree), { label: "Weather backup plan" }],
		}));
		expect(failed("team-offsite-mindmap", invented)).toEqual(["no-invented-topics"]);
		const twice = edited("team-offsite-mindmap", (tree) => ({
			...tree,
			children: children(tree).map((branch) =>
				branch.label === "Food"
					? { ...branch, children: [...children(branch), { label: "Catering" }] }
					: branch,
			),
		}));
		expect(failed("team-offsite-mindmap", twice)).toEqual(["no-invented-topics"]);
	});

	it("matches reworded labels and the central topic", () => {
		const reworded = edited("photosynthesis-study-mindmap", (tree) => ({
			...tree,
			label: "Photosynthesis study notes",
			children: children(tree).map((branch) =>
				branch.label === "Light reactions"
					? { ...branch, label: "Light-dependent reactions" }
					: branch,
			),
		}));
		expect(failed("photosynthesis-study-mindmap", reworded)).toEqual([]);
		const renamed = edited("photosynthesis-study-mindmap", (tree) => ({
			...tree,
			label: "Plants",
		}));
		expect(failed("photosynthesis-study-mindmap", renamed)).toEqual(["root"]);
	});

	it("keeps topics that share words apart", () => {
		// Without the Regression grouping, its two regressions sit straight under
		// Supervised learning: the grouping is missing and they are misplaced, but
		// neither stands in for Logistic regression.
		const flattened = edited("ml-roadmap-mindmap", (tree) => ({
			...tree,
			children: children(tree).map((branch) =>
				branch.label === "Supervised learning"
					? {
							...branch,
							children: children(branch).flatMap((topic) =>
								topic.label === "Regression" ? children(topic) : [topic],
							),
						}
					: branch,
			),
		}));
		const failures = failed("ml-roadmap-mindmap", flattened);
		expect(failures).toContain("topic-parent:linear-regression");
		expect(failures).not.toContain("topic:logistic-regression");
		expect(failures).not.toContain("topic-parent:logistic-regression");
	});

	it("grades a Code Mode build from its nested normalized spec", () => {
		const entry = scenario("team-offsite-mindmap");
		const normalize = (topic: MindmapTopicTree, path: number[]): unknown => ({
			id: `topic-${path.join("-")}`,
			label: topic.label,
			children: children(topic).map((child, index) => normalize(child, [...path, index])),
		});
		const candidate = candidateFromMcpResult(
			{
				ok: true,
				status: "accepted",
				operation: "buildMindmap",
				buildId: "build-1",
				normalizedSpec: {
					id: "team-offsite",
					title: "Team offsite",
					root: normalize(treeOf(entry.expectedDiagram), [0]),
					layout: { direction: "LR" },
					style: { accentColor: "#8f707f", backgroundColor: "#fffdf8" },
				},
			},
			"mindmap",
		);
		if (!candidate?.ok) throw new Error("Expected an accepted mindmap build.");
		const evaluation = evaluateScenarioDiagram(entry, candidate.diagram);
		expect(evaluation.checks.filter((check) => !check.passed)).toEqual([]);
	});
});
