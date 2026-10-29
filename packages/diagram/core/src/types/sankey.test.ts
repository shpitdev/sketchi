import { describe, expect, it } from "vitest";

import { parseCanonicalDiagram } from "../diagram";
import { sankeyStressFixtures } from "../sankey-fixtures";
import {
	getSankeyValidationIssues,
	parseSankeyDiagram,
	resolveSankeyShorthand,
	SANKEY_MAX_COLUMNS,
	SANKEY_MAX_NODES,
	sankeyColumns,
	sankeyCycle,
	sankeyDiagramType,
	sankeyFixture,
	sankeyNodeTotals,
	sankeySum,
	SankeyValidationError,
} from "./sankey";

const node = (id: string) => ({ id, label: id.toUpperCase() });
const diagram = (
	nodes: unknown[],
	links: unknown[],
	extra: Record<string, unknown> = {},
): Record<string, unknown> => ({
	id: "flow",
	title: "Flow",
	type: sankeyDiagramType,
	nodes,
	links,
	...extra,
});

/** The issues a diagram fails with, or [] when it is valid. */
function issuesOf(input: unknown) {
	try {
		parseSankeyDiagram(input);
		return [];
	} catch (error) {
		if (!(error instanceof SankeyValidationError)) throw error;
		return error.issues;
	}
}
const codes = (input: unknown) => issuesOf(input).map((issue) => issue.code);

describe("Sankey contract", () => {
	it("has a typed fixture that satisfies the canonical diagram contract", () => {
		expect(sankeyFixture.type).toBe(sankeyDiagramType);
		expect(parseCanonicalDiagram(sankeyFixture)).toEqual(sankeyFixture);
		expect(sankeyFixture.style).toMatchObject({ accentColor: expect.any(String) });
		for (const fixture of Object.values(sankeyStressFixtures))
			expect(getSankeyValidationIssues(fixture), fixture.id).toEqual([]);
	});

	it("places each node at its longest path from the sources", () => {
		const columns = sankeyColumns(
			parseSankeyDiagram(
				diagram(
					[node("a"), node("b"), node("c"), node("d")],
					[
						{ source: "a", target: "b", value: 2 },
						{ source: "b", target: "c", value: 2 },
						{ source: "a", target: "c", value: 1 },
						{ source: "d", target: "c", value: 1 },
					],
				),
			),
		);
		expect(Object.fromEntries(columns)).toEqual({ a: 0, b: 1, c: 2, d: 0 });
		// A sink fed by several nodes aligns with the last column; one fed by one node stays.
		const sinks = sankeyColumns(
			parseSankeyDiagram(
				diagram(
					[node("a"), node("b"), node("c"), node("lost"), node("dropped")],
					[
						{ source: "a", target: "b", value: 4 },
						{ source: "b", target: "c", value: 2 },
						{ source: "a", target: "lost", value: 1 },
						{ source: "b", target: "lost", value: 1 },
						{ source: "a", target: "dropped", value: 1 },
					],
				),
			),
		);
		expect(Object.fromEntries(sinks)).toEqual({ a: 0, b: 1, c: 2, lost: 2, dropped: 1 });
	});

	it("totals a node at the larger of its inflow and outflow", () => {
		const totals = sankeyNodeTotals(
			parseSankeyDiagram(
				diagram(
					[node("applied"), node("screened"), node("hired")],
					[
						{ source: "applied", target: "screened", value: 0.1 },
						{ source: "applied", target: "hired", value: 0.2 },
						{ source: "screened", target: "hired", value: 0.05 },
					],
				),
			),
		);
		expect(totals.get("applied")).toEqual({ inflow: 0, outflow: 0.3, total: 0.3 });
		expect(totals.get("screened")).toEqual({ inflow: 0.1, outflow: 0.05, total: 0.1 });
		expect(totals.get("hired")).toEqual({ inflow: 0.25, outflow: 0, total: 0.25 });
		expect(sankeySum([1_200, 340.5, 0.25])).toBe(1_540.75);
	});

	it("keeps every authored digit of small and precise totals", () => {
		expect(sankeySum([1e-13])).toBe(1e-13);
		expect(sankeySum([1e-13, 2e-13])).toBe(3e-13);
		expect(sankeySum([0.1234567890123])).toBe(0.1234567890123);
		expect(sankeySum([0.1, 0.2])).toBe(0.3);
		expect(sankeySum([1e-150, 2e-150])).toBe(3e-150);
		const totals = sankeyNodeTotals(
			parseSankeyDiagram(
				diagram([node("a"), node("b")], [{ source: "a", target: "b", value: 1e-13 }]),
			),
		);
		expect(totals.get("a")?.total).toBe(1e-13);
	});

	it.each([
		[
			"a cycle",
			[node("a"), node("b"), node("c")],
			[
				{ source: "a", target: "b", value: 1 },
				{ source: "b", target: "c", value: 1 },
				{ source: "c", target: "a", value: 1 },
			],
			"sankey_cycle",
		],
		[
			"a self-link",
			[node("a"), node("b")],
			[
				{ source: "a", target: "b", value: 1 },
				{ source: "b", target: "b", value: 1 },
			],
			"sankey_self_link",
		],
		[
			"an unknown target",
			[node("a"), node("b")],
			[{ source: "a", target: "z", value: 1 }],
			"unknown_sankey_node",
		],
		[
			"a repeated node id",
			[node("a"), node("a"), node("b")],
			[{ source: "a", target: "b", value: 1 }],
			"duplicate_sankey_node_id",
		],
		[
			"a colon in an id",
			[node("a:1"), node("b")],
			[{ source: "a:1", target: "b", value: 1 }],
			"invalid_sankey_node_id",
		],
		[
			"a repeated link",
			[node("a"), node("b")],
			[
				{ source: "a", target: "b", value: 1 },
				{ source: "a", target: "b", value: 2 },
			],
			"duplicate_sankey_link",
		],
		[
			"a zero flow",
			[node("a"), node("b")],
			[{ source: "a", target: "b", value: 0 }],
			"invalid_sankey_value",
		],
		[
			"a negative flow",
			[node("a"), node("b")],
			[{ source: "a", target: "b", value: -3 }],
			"invalid_sankey_value",
		],
		[
			"a node with no flow",
			[node("a"), node("b"), node("c")],
			[{ source: "a", target: "b", value: 1 }],
			"unlinked_sankey_node",
		],
		[
			"a long label",
			[{ id: "a", label: "A".repeat(49) }, node("b")],
			[{ source: "a", target: "b", value: 1 }],
			"sankey_text_too_long",
		],
	])("rejects %s with a repair hint", (_name, nodes, links, code) => {
		const issues = issuesOf(diagram(nodes, links));
		expect(issues.map((issue) => issue.code)).toContain(code);
		for (const issue of issues) expect(issue.hint.length).toBeGreaterThan(10);
	});

	it("names the cycle in flow order and the link that closes it", () => {
		const [issue] = issuesOf(
			diagram(
				[node("visit"), node("cart"), node("checkout")],
				[
					{ source: "visit", target: "cart", value: 5 },
					{ source: "cart", target: "checkout", value: 3 },
					{ source: "checkout", target: "cart", value: 1 },
				],
			),
		);
		expect(issue).toMatchObject({
			code: "sankey_cycle",
			path: "links.[2]",
			message: "Flows run in a cycle: cart → checkout → cart.",
		});
		expect(issue?.hint).toContain('"cart (returning)"');
		expect(sankeyCycle([{ source: "a", target: "b" }])).toBeUndefined();
	});

	it("tells a negative flow to swap its ends", () => {
		const [issue] = issuesOf(
			diagram([node("a"), node("b")], [{ source: "a", target: "b", value: -3 }]),
		);
		expect(issue?.hint).toContain("Swap source and target");
	});

	it("caps nodes and columns", () => {
		const many = Array.from({ length: SANKEY_MAX_NODES + 1 }, (_, index) => node(`n${index}`));
		expect(
			codes(
				diagram(
					many,
					many.slice(1).map((entry) => ({ source: "n0", target: entry.id, value: 1 })),
				),
			),
		).toContain("sankey_too_large");
		const chain = Array.from({ length: SANKEY_MAX_COLUMNS + 1 }, (_, index) => node(`s${index}`));
		const deep = diagram(
			chain,
			chain.slice(1).map((entry, index) => ({ source: `s${index}`, target: entry.id, value: 1 })),
		);
		expect(issuesOf(deep)[0]?.message).toContain(`${SANKEY_MAX_COLUMNS + 1} stages`);
		expect(
			codes({
				...deep,
				nodes: chain.slice(1),
				links: (deep["links"] as unknown[]).slice(1),
			}),
		).toEqual([]);
	});

	it("rejects a color that is not a hex code", () => {
		expect(() =>
			parseSankeyDiagram(
				diagram(
					[{ ...node("a"), color: "red" }, node("b")],
					[{ source: "a", target: "b", value: 1 }],
				),
			),
		).toThrow("color");
	});
});

describe("Sankey edge inputs", () => {
	it("keeps an authored newline in a label and rejects a blank one", () => {
		const parsed = parseSankeyDiagram(
			diagram(
				[{ id: "a", label: "Data\nScience" }, node("b")],
				[{ source: "a", target: "b", value: 1, label: "via\nreferral" }],
			),
		);
		expect(parsed.nodes[0]?.label).toBe("Data\nScience");
		expect(
			codes(
				diagram([{ id: "a", label: " \n " }, node("b")], [{ source: "a", target: "b", value: 1 }]),
			),
		).toEqual(["blank_sankey_label"]);
		expect(
			codes(diagram([node("a"), node("b")], [{ source: "a", target: "b", value: 1, label: "\n" }])),
		).toEqual(["blank_sankey_label"]);
	});

	it("tells a zero flow apart from a missing one", () => {
		expect(
			codes(diagram([node("a"), node("b")], [{ source: "a", target: "b", value: 0 }])),
		).toEqual(["invalid_sankey_value"]);
		expect(
			codes(
				resolveSankeyShorthand(
					diagram([node("a"), node("b")], [{ from: "a", to: "b", amount: "0" }]),
				),
			),
		).toEqual(["invalid_sankey_value"]);
		expect(() =>
			parseSankeyDiagram(diagram([node("a"), node("b")], [{ source: "a", target: "b" }])),
		).toThrow("value");
	});

	it("handles ids and labels that name Object members", () => {
		const parsed = parseSankeyDiagram(
			diagram(
				[
					{ id: "__proto__", label: "constructor" },
					{ id: "constructor", label: "toString" },
					node("hasOwnProperty"),
				],
				[
					{ source: "__proto__", target: "constructor", value: 2 },
					{ source: "constructor", target: "hasOwnProperty", value: 1 },
				],
			),
		);
		expect(Object.fromEntries(sankeyColumns(parsed))).toEqual({
			["__proto__"]: 0,
			constructor: 1,
			hasOwnProperty: 2,
		});
		expect(sankeyNodeTotals(parsed).get("constructor")).toEqual({
			inflow: 2,
			outflow: 1,
			total: 2,
		});
		const resolved = resolveSankeyShorthand({
			id: "flow",
			title: "Flow",
			type: sankeyDiagramType,
			links: [{ from: "constructor", to: "__proto__", value: 3 }],
		}) as { nodes: { id: string; label: string }[] };
		expect(resolved.nodes.map((entry) => entry.label)).toEqual(["constructor", "__proto__"]);
		expect(codes(resolved)).toEqual([]);
	});
});

describe("Sankey shorthand", () => {
	it.each([
		["null", null],
		["an object", { a: "A" }],
		["a name", "Engineering"],
	])("leaves nodes written as %s for the decoder to reject", (_name, nodes) => {
		const resolved = resolveSankeyShorthand({
			...diagram([], []),
			nodes,
			flows: [{ from: "Engineering", to: "Compute", amount: 5 }],
		}) as Record<string, unknown>;
		expect(resolved["nodes"]).toEqual(nodes);
		expect(() => parseSankeyDiagram(resolved)).toThrow("nodes");
	});

	it.each([
		["null", null],
		["an object", { source: "a", target: "b", value: 1 }],
	])("leaves links written as %s for the decoder to reject", (_name, links) => {
		const resolved = resolveSankeyShorthand({ ...diagram([node("a"), node("b")], []), links });
		expect((resolved as Record<string, unknown>)["links"]).toEqual(links);
		expect(() => parseSankeyDiagram(resolved)).toThrow("links");
	});

	it("leaves an end written as an object without a name for the decoder to reject", () => {
		const resolved = resolveSankeyShorthand(
			diagram([node("a"), node("b")], [{ source: { kind: "a" }, target: "b", value: 1 }]),
		) as { links: { source: unknown }[] };
		expect(resolved.links[0]?.source).toEqual({ kind: "a" });
		expect(() => parseSankeyDiagram(resolved)).toThrow("source");
	});

	it("reads flows with from, to and amount, and nodes from their names", () => {
		const parsed = parseSankeyDiagram(
			resolveSankeyShorthand({
				id: "traffic",
				title: "Traffic",
				type: "sankey",
				flows: [
					{ from: "Organic search", to: "Pricing page", amount: "1,200" },
					{ from: "Organic search", to: "Blog", weight: 300 },
					{ from: "Pricing page", to: "Signed up", count: 240, label: "trial" },
				],
			}),
		);
		expect(parsed.nodes).toEqual([
			{ id: "organic-search", label: "Organic search" },
			{ id: "pricing-page", label: "Pricing page" },
			{ id: "blog", label: "Blog" },
			{ id: "signed-up", label: "Signed up" },
		]);
		expect(parsed.links).toEqual([
			{ source: "organic-search", target: "pricing-page", value: 1_200 },
			{ source: "organic-search", target: "blog", value: 300 },
			{ source: "pricing-page", target: "signed-up", value: 240, label: "trial" },
		]);
	});

	it("reads nodes written as names and links that name nodes by label", () => {
		const parsed = parseSankeyDiagram(
			resolveSankeyShorthand({
				id: "budget",
				title: "Budget",
				type: "sankey",
				nodes: [
					"Engineering",
					{ name: "Compute", color: "#2a78d6" },
					{ id: "db", label: "Databases" },
				],
				links: [
					{ source: "Engineering", target: "compute", value: 5 },
					{ source: "engineering", target: "Databases", value: 2 },
				],
			}),
		);
		expect(parsed.nodes.map((entry) => entry.id)).toEqual(["engineering", "compute", "db"]);
		expect(parsed.nodes[1]).toEqual({ id: "compute", label: "Compute", color: "#2a78d6" });
		expect(parsed.links.map((link) => `${link.source}>${link.target}`)).toEqual([
			"engineering>compute",
			"engineering>db",
		]);
	});

	it("resolves an end to the node with that exact id before any label alias", () => {
		const parsed = parseSankeyDiagram(
			resolveSankeyShorthand(
				diagram(
					[
						{ id: "a", label: "b" },
						{ id: "b", label: "Second" },
					],
					[{ source: "a", target: "b", value: 1 }],
				),
			),
		);
		expect(parsed.links).toEqual([{ source: "a", target: "b", value: 1 }]);
		// A label still resolves when no id matches it.
		const byLabel = parseSankeyDiagram(
			resolveSankeyShorthand(
				diagram(
					[
						{ id: "a", label: "b" },
						{ id: "c", label: "Second" },
					],
					[{ source: "second", target: "b", value: 1 }],
				),
			),
		);
		expect(byLabel.links).toEqual([{ source: "c", target: "a", value: 1 }]);
	});

	it("leaves an unknown end for validation when nodes are listed", () => {
		const resolved = resolveSankeyShorthand(
			diagram([node("a"), node("b")], [{ from: "a", to: "ghost", value: 1 }]),
		);
		expect(codes(resolved)).toContain("unknown_sankey_node");
	});
});
