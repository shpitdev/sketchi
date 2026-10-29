import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { parseFlowchartDiagram, type FlowchartDiagram } from "@sketchi/diagram-core";

import { evaluateScenarioDiagram } from "./evaluate";
import { specToFlowchartCandidate } from "./mcp-results";
import { getFlowchartScenario } from "./scenarios";

// Unmodified normalized specs from the retained Oct 29 production/preview receipts.
const samples = JSON.parse(
	readFileSync(new URL("./fixtures/app-stack-entries.json", import.meta.url), "utf8"),
) as { runId: string; spec: Record<string, unknown> }[];
const scenario = getFlowchartScenario("ai-app-stack-logos");
const diagrams = samples.map(({ spec }) => parseFlowchartDiagram(specToFlowchartCandidate(spec)));
const split = diagrams[0]!;
const merged = diagrams[2]!;
const failures = (diagram: FlowchartDiagram) =>
	evaluateScenarioDiagram(scenario, diagram)
		.checks.filter((check) => !check.passed)
		.map((check) => check.id);
const entryFailure = "node-label:Request reaches Vercel → Next.js page receives question";

describe("the stated multi-technology entry event", () => {
	it.each(samples)("accepts the real receipt $runId", ({ spec }) => {
		expect(failures(parseFlowchartDiagram(specToFlowchartCandidate(spec)))).toEqual([]);
	});

	it.each(["nextjs", "vercel"])("accepts either single-node logo: %s", (slug) => {
		expect(
			failures({
				...merged,
				nodes: merged.nodes.map((node) =>
					node.id === "recv" ? { ...node, icon: { slug } } : node,
				),
			}),
		).toEqual([]);
	});

	it("accepts the reversed adjacent chain with each technology's logo", () => {
		const page = split.nodes.find((node) => node.id === "page")!;
		const host = split.nodes.find((node) => node.id === "host")!;
		expect(
			failures({
				...split,
				nodes: split.nodes.map((node) =>
					node.id === page.id
						? { ...node, label: host.label, icon: host.icon }
						: node.id === host.id
							? { ...node, label: page.label, icon: page.icon }
							: node,
				),
			}),
		).toEqual([]);
	});

	it("accepts a hosting caption between the adjacent entry parts", () => {
		expect(
			failures({
				...split,
				edges: split.edges.map((edge) =>
					edge.source === "page" ? { ...edge, label: "Hosted on" } : edge,
				),
			}),
		).toEqual([]);
	});

	it.each([
		["Next.js page receives the question", "nextjs", "icon:vercel"],
		["Vercel receives the question", "vercel", "icon:nextjs"],
	] as const)("rejects an entry dropping a technology: %s", (label, slug, missingIcon) => {
		expect(
			failures({
				...merged,
				nodes: merged.nodes.map((node) =>
					node.id === "recv" ? { ...node, label, icon: { slug } } : node,
				),
			}),
		).toEqual(expect.arrayContaining([entryFailure, missingIcon]));
	});

	it("does not excuse a missing split-node logo", () => {
		expect(
			failures({
				...split,
				nodes: split.nodes.map(({ icon, ...node }) =>
					node.id === "host" ? node : { ...node, ...(icon ? { icon } : {}) },
				),
			}),
		).toContain("icon:vercel");
	});

	it("still requires a logo on the combined entry", () => {
		const diagram = {
			...merged,
			nodes: merged.nodes.map(({ icon, ...node }) =>
				node.id === "recv" ? node : { ...node, ...(icon ? { icon } : {}) },
			),
		};
		expect(failures(diagram)).toEqual(expect.arrayContaining(["icon:nextjs", "icon:vercel"]));
	});

	it("does not substitute another technology's logo for either entry logo", () => {
		expect(
			failures({
				...merged,
				nodes: merged.nodes.map((node) =>
					node.id === "recv" ? { ...node, icon: { slug: "redis" } } : node,
				),
			}),
		).toEqual(expect.arrayContaining(["icon:nextjs", "icon:vercel", "icons-on-named-steps"]));
	});

	it("requires scenario opt-in for sharing a single logo slot", () => {
		const expected = {
			...scenario,
			assertions: {
				...scenario.assertions,
				requiredNodes: scenario.assertions.requiredNodes.map(
					({ entryParts: _parts, ...step }) => step,
				),
			},
		};
		expect(
			evaluateScenarioDiagram(expected, merged)
				.checks.filter((check) => !check.passed)
				.map((check) => check.id),
		).toContain("icon:vercel");
	});

	it("rejects a logo placed on a generic step", () => {
		expect(
			failures({
				...merged,
				nodes: merged.nodes.map((node) =>
					node.id === "ret" ? { ...node, icon: { slug: "vercel" } } : node,
				),
			}),
		).toContain("icons-on-named-steps");
	});

	it("rejects an unrelated step between the two entry technologies", () => {
		expect(
			failures({
				...split,
				nodes: [
					...split.nodes,
					{ id: "auth", kind: "process", label: "Authenticate user", metadata: {} },
				],
				edges: [
					...split.edges.map((edge) =>
						edge.source === "page" ? { ...edge, target: "auth" } : edge,
					),
					{ id: "auth-host", source: "auth", target: "host", metadata: {} },
				],
			}),
		).toContain(entryFailure);
	});

	it.each(["cache", "model", "store", "errors"])("keeps the downstream %s step required", (id) => {
		expect(
			failures({
				...split,
				nodes: split.nodes.map((node) =>
					node.id === id ? { ...node, label: "Generic step" } : node,
				),
			}).length,
		).toBeGreaterThan(0);
	});

	it("rejects a miss path that logs before storing", () => {
		const next = new Map([
			["model", "errors"],
			["errors", "store"],
			["store", "answer"],
		]);
		expect(
			failures({
				...split,
				edges: split.edges.map((edge) =>
					next.has(edge.source) ? { ...edge, target: next.get(edge.source)! } : edge,
				),
			}),
		).toContain("edge:Call the OpenAI model->Store answer in Redis");
	});
});

const ownerSamples = JSON.parse(
	readFileSync(new URL("./fixtures/app-stack-entry-owners.json", import.meta.url), "utf8"),
) as { runId: string; spec: Record<string, unknown> }[];
function withBareStart(diagram = merged): FlowchartDiagram {
	return {
		...diagram,
		nodes: [
			{ id: "bare", label: "User sends question", kind: "start", metadata: {} },
			...diagram.nodes.map((node) =>
				node.kind === "start" ? { ...node, kind: "process" as const } : node,
			),
		],
		edges: [
			{ id: "bare-entry", source: "bare", target: diagram.nodes[0]!.id, metadata: {} },
			...diagram.edges,
		],
	};
}

describe("entry ownership after a bare start", () => {
	it.each(ownerSamples)(
		"restores the entry match without hiding independent defects: $runId",
		({ runId, spec }) => {
			const failed = failures(parseFlowchartDiagram(specToFlowchartCandidate(spec)));
			expect(failed).not.toContain(entryFailure);
			const independent = runId.endsWith("iseo")
				? "node-label:Return cached answer"
				: runId.endsWith("ijyw")
					? "icon:nextjs"
					: runId.endsWith("exa3")
						? "icons-on-named-steps"
						: "edge:Store answer in Redis->Log errors to Sentry";
			expect(failed).toContain(independent);
		},
	);

	it.each(["nextjs", "vercel"])("accepts a merged process owner with either logo: %s", (slug) => {
		const diagram = withBareStart();
		expect(
			failures({
				...diagram,
				nodes: diagram.nodes.map((node) =>
					node.id === "recv" ? { ...node, icon: { slug } } : node,
				),
			}),
		).toEqual([]);
	});

	it("continues past a process that already names both entry parts", () => {
		const diagram = withBareStart(split);
		expect(
			failures({
				...diagram,
				nodes: diagram.nodes.map((node) =>
					node.id === "page"
						? { ...node, label: "Vercel routes request to Next.js page", icon: { slug: "vercel" } }
						: node.id === "host"
							? { ...node, label: "Next.js page receives question", icon: { slug: "nextjs" } }
							: node,
				),
			}),
		).toEqual([]);
	});

	it.each([merged, withBareStart()])(
		"requires the logo when another node also names that technology",
		(diagram) => {
			expect(
				failures({
					...diagram,
					nodes: [
						...diagram.nodes,
						{ id: "function", kind: "process", label: "Vercel serverless function", metadata: {} },
					],
					edges: [
						...diagram.edges.map((edge) =>
							edge.source === "recv" ? { ...edge, target: "function" } : edge,
						),
						{ id: "function-cache", source: "function", target: "check", metadata: {} },
					],
				}),
			).toContain("icon:vercel");
		},
	);

	it.each([
		"Hosts",
		"Hosted on",
		"Serves",
		"Routes to",
		"Vercel hosts the Next.js page",
		"Hosted by",
		"Served by",
		"Deployed on",
		"Runs on",
		"Deploys",
	])("accepts only entry/hosting words in the caption: %s", (label) => {
		expect(
			failures({
				...split,
				edges: split.edges.map((edge) => (edge.source === "page" ? { ...edge, label } : edge)),
			}),
		).toEqual([]);
	});

	it.each([
		"Authenticate user and charge card",
		"Hosts and authenticates user",
		"Does not host",
		"No",
		"Authenticate user",
		"Hosts, then charges card",
		"Not hosted on",
		"By the",
	])("rejects unrelated or negated entry work in a caption: %s", (label) => {
		expect(
			failures({
				...split,
				edges: split.edges.map((edge) => (edge.source === "page" ? { ...edge, label } : edge)),
			}),
		).toContain(entryFailure);
	});

	it("does not borrow entry ownership from the repaired diagram for model logos", () => {
		const model = {
			...merged,
			nodes: merged.nodes.map((node) =>
				node.id === "recv" ? { ...node, kind: "process" as const } : node,
			),
		};
		model.nodes.push({ id: "bare", label: "User sends question", kind: "start", metadata: {} });
		model.edges = [
			...merged.edges.map((edge) =>
				edge.source === "recv"
					? { ...edge, source: "bare" }
					: edge.source === "err"
						? { ...edge, target: "recv" }
						: edge,
			),
			{ id: "late-entry-return", source: "recv", target: "ret", metadata: {} },
		];
		expect(
			evaluateScenarioDiagram(scenario, merged, model)
				.checks.filter((check) => !check.passed)
				.map((check) => check.id),
		).toContain("icon:vercel");
	});

	it("takes logo ownership from the model's own bare-start entry", () => {
		const model = withBareStart();
		const rename = (id: string) => (id === "recv" ? "model-entry" : id);
		const renamed = {
			...model,
			nodes: model.nodes.map((node) => ({ ...node, id: rename(node.id) })),
			edges: model.edges.map((edge) => ({
				...edge,
				source: rename(edge.source),
				target: rename(edge.target),
			})),
		};
		expect(
			evaluateScenarioDiagram(scenario, merged, renamed)
				.checks.filter((check) => !check.passed)
				.map((check) => check.id),
		).toEqual([]);
	});

	it("names every declared entry part in its missing-step diagnostic", () => {
		const diagram = {
			...merged,
			nodes: merged.nodes.map((node) =>
				node.id === "recv" ? { ...node, label: "Question arrives" } : node,
			),
		};
		const check = evaluateScenarioDiagram(scenario, diagram).checks.find(
			(check) => check.id === entryFailure,
		)!;
		expect(check.passed).toBe(false);
		expect(check.message).toContain("Vercel");
		expect(check.message).toContain("Next.js page");
		expect(check.message).toContain("adjacent");
	});
});
