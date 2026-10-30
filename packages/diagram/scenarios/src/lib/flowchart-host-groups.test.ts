import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { parseFlowchartDiagram, type FlowchartDiagram } from "@sketchi/diagram-core";

import { evaluateScenarioDiagram } from "./evaluate";
import { candidateFromMcpResult } from "./mcp-results";
import { getFlowchartScenario } from "./scenarios";

// Build receipts (artifact links dropped) from the retained Oct 30 round 29
// evals: four draw Vercel as a group around the page, its logo filled from the
// group label; one states the cached answer on a `yes:` branch into the shared
// answer. 3gb7 (Oct 23) drew the same group before groups drew logos.
const samples = JSON.parse(
	readFileSync(new URL("./fixtures/app-stack-host-groups.json", import.meta.url), "utf8"),
) as { runId: string; receipt: Record<string, unknown> }[];
const scenario = getFlowchartScenario("ai-app-stack-logos");
const diagram = (runId: string) => {
	const candidate = candidateFromMcpResult(
		samples.find((sample) => sample.runId === runId)!.receipt,
		"flowchart",
	);
	return parseFlowchartDiagram(candidate?.ok ? candidate.diagram : undefined);
};
const failures = (candidate: FlowchartDiagram) =>
	evaluateScenarioDiagram(scenario, candidate)
		.checks.filter((check) => !check.passed)
		.map((check) => check.id);
const entryFailure = "node-label:Request reaches Vercel → Next.js page receives question";
const outcomeFailure = "node-label:Return cached answer";
const drawn = samples.filter((sample) => sample.runId !== "20261023-180357-3gb7");
// Sonnet's shared-return form inside a Vercel cloud group around the page.
const hosted = diagram("20261030-032332-zuke");
const shared = diagram("20261030-032332-abhc");
const vercel = { id: "v", label: "Vercel", kind: "cloud", icon: { slug: "vercel" } } as const;
const withGroups = (
	groups: FlowchartDiagram["groups"],
	group: (id: string) => string | undefined,
) => ({
	...hosted,
	groups,
	nodes: hosted.nodes.map(({ group: _group, ...node }) => {
		const id = group(node.id);
		return id === undefined ? node : { ...node, group: id };
	}),
});

describe("an entry part drawn as the group around the entry", () => {
	it.each(drawn)("accepts the real receipt $runId", ({ runId }) => {
		expect(failures(diagram(runId))).toEqual([]);
	});

	it("reads the group's logo from the build's filled-logo note", () => {
		expect(hosted.groups).toEqual([vercel]);
	});

	it("accepts the entry but not the logo when the group drew none", () => {
		expect(failures(diagram("20261023-180357-3gb7"))).toEqual(["icon:vercel"]);
		expect(
			failures(
				withGroups([{ id: "v", label: "Vercel", kind: "cloud" }], (id) =>
					id === "page" ? "v" : undefined,
				),
			),
		).toEqual(["icon:vercel"]);
	});

	it("does not credit a drawn group logo for an unnamed part", () => {
		expect(
			failures(
				withGroups([{ ...vercel, label: "Hosting" }], (id) => (id === "page" ? "v" : undefined)),
			),
		).toEqual(expect.arrayContaining([entryFailure, "icon:vercel"]));
	});

	it("accepts the host group as a parent of the entry's own group", () => {
		expect(
			failures(
				withGroups([vercel, { id: "app", label: "App", parent: "v" }], (id) =>
					id === "page" ? "app" : undefined,
				),
			),
		).toEqual([]);
	});

	it("rejects a group naming another technology", () => {
		expect(
			failures(
				withGroups([{ ...vercel, label: "Netlify" }], (id) => (id === "page" ? "v" : undefined)),
			),
		).toEqual(expect.arrayContaining([entryFailure, "icon:vercel"]));
	});

	it("rejects a Vercel group that does not hold the entry", () => {
		expect(failures(withGroups([vercel], (id) => (id === "call" ? "v" : undefined)))).toEqual(
			expect.arrayContaining([entryFailure, "icon:vercel"]),
		);
	});

	it("rejects a group around a node that names no entry part", () => {
		expect(
			failures({
				...hosted,
				nodes: hosted.nodes.map((node) =>
					node.id === "page" ? { ...node, label: "Question received" } : node,
				),
			}),
		).toEqual(expect.arrayContaining([entryFailure]));
	});

	it("rejects an entry dropping Next.js inside the Vercel group", () => {
		expect(
			failures({
				...hosted,
				nodes: hosted.nodes.map((node) =>
					node.id === "page" ? { ...node, label: "Page receives question" } : node,
				),
			}),
		).toEqual(expect.arrayContaining([entryFailure]));
	});

	it("still requires the entry node's own logo", () => {
		expect(
			failures({
				...hosted,
				nodes: hosted.nodes.map(({ icon: _icon, ...node }) =>
					node.id === "page" ? node : { ...node, ...(_icon ? { icon: _icon } : {}) },
				),
			}),
		).toEqual(["icon:nextjs"]);
	});

	it("rejects a logo placed on a generic step", () => {
		expect(
			failures({
				...hosted,
				nodes: hosted.nodes.map((node) =>
					node.id === "hit" ? { ...node, icon: { slug: "vercel" } } : node,
				),
			}),
		).toEqual(["icons-on-named-steps"]);
	});

	it("rejects a missing technology elsewhere in the flow", () => {
		expect(
			failures({
				...hosted,
				nodes: hosted.nodes.map(({ icon, ...node }) =>
					node.id === "log"
						? { ...node, label: "Log errors" }
						: { ...node, ...(icon ? { icon } : {}) },
				),
			}),
		).toEqual(expect.arrayContaining(["node-label:Log errors to Sentry", "icon:sentry"]));
	});

	it("rejects a miss path that logs before storing", () => {
		expect(
			failures({
				...hosted,
				edges: hosted.edges.map((edge) =>
					edge.source === "call"
						? { ...edge, target: "log" }
						: edge.source === "store"
							? { ...edge, target: "ret" }
							: edge.source === "log"
								? { ...edge, target: "store" }
								: edge,
				),
			}),
		).toEqual(
			expect.arrayContaining([
				"edge:Call the OpenAI model->Store answer in Redis",
				"edge:Store answer in Redis->Log errors to Sentry",
			]),
		);
	});
});

describe("a stated cached answer on the hit branch into the shared answer", () => {
	const hit = (label: string) => ({
		...shared,
		edges: shared.edges.map((edge) =>
			edge.source === "hit" && edge.target === "ret" ? { ...edge, label } : edge,
		),
	});

	it.each(["yes: cached answer", "yes (cached answer)", "hit - cached answer"])(
		"accepts %s",
		(label) => {
			expect(failures(hit(label))).toEqual([]);
		},
	);

	it.each([
		"yes: skip cached answer",
		"yes: not cached answer",
		"yes: answer",
		"yes: cached answer and log",
		"miss: cached answer",
	])("rejects %s", (label) => {
		expect(failures(hit(label))).toContain(outcomeFailure);
	});
});
