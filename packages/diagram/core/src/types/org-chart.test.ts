import { describe, expect, it } from "vitest";

import { parseCanonicalDiagram } from "../diagram";
import { orgChartStressFixtures } from "../org-chart-fixtures";
import {
	getOrgChartValidationIssues,
	ORG_CHART_MAX_DEPTH,
	ORG_CHART_MAX_PEOPLE,
	orgChartDiagramType,
	orgChartFixture,
	orgChartReports,
	orgChartRoots,
	OrgChartValidationError,
	orgPersonInitials,
	parseOrgChartDiagram,
	resolveOrgChartShorthand,
} from "./org-chart";

const chart = (people: unknown[], extra: Record<string, unknown> = {}) => ({
	id: "team",
	title: "Team",
	type: orgChartDiagramType,
	people,
	...extra,
});

/** The issues a chart fails with, or [] when it is valid. */
function issuesOf(input: unknown) {
	try {
		parseOrgChartDiagram(input);
		return [];
	} catch (error) {
		if (!(error instanceof OrgChartValidationError)) throw error;
		return error.issues;
	}
}
const codes = (input: unknown) => issuesOf(input).map((issue) => issue.code);

const ceo = { id: "ceo", name: "Ada Lovelace", title: "CEO" };

describe("org chart contract", () => {
	it("has a typed fixture that satisfies the canonical diagram contract", () => {
		expect(orgChartFixture.type).toBe(orgChartDiagramType);
		expect(parseCanonicalDiagram(orgChartFixture)).toEqual(orgChartFixture);
		expect(orgChartRoots(orgChartFixture).map((person) => person.id)).toEqual(["ada"]);
		expect(
			orgChartReports(orgChartFixture)
				.get("ada")
				?.map((person) => person.id),
		).toEqual(["grace", "linus", "radia"]);
		for (const fixture of Object.values(orgChartStressFixtures))
			expect(getOrgChartValidationIssues(fixture)).toEqual([]);
		expect(orgChartStressFixtures.eighty.people).toHaveLength(80);
	});

	it("defaults dotted lines and the palette", () => {
		const parsed = parseOrgChartDiagram(chart([ceo]));
		expect(parsed.dottedLines).toEqual([]);
		expect(parsed.style).toMatchObject({ accentColor: expect.any(String) });
	});

	it.each([
		["an unknown manager", [ceo, { id: "a", name: "A", manager: "ghost" }], "unknown_manager"],
		["a person managing themselves", [ceo, { id: "a", name: "A", manager: "a" }], "self_manager"],
		[
			"a reporting cycle",
			[ceo, { id: "a", name: "A", manager: "b" }, { id: "b", name: "B", manager: "a" }],
			"reporting_cycle",
		],
		["two top people", [ceo, { id: "b", name: "Board" }], "multiple_roots"],
		["an assistant with no manager", [{ ...ceo, assistant: true }], "invalid_assistant"],
		[
			"an assistant with reports",
			[
				ceo,
				{ id: "ea", name: "E", manager: "ceo", assistant: true },
				{ id: "x", name: "X", manager: "ea" },
			],
			"invalid_assistant",
		],
		["a colon in an id", [{ ...ceo, id: "team:ceo" }], "invalid_person_id"],
		["a repeated id", [ceo, { id: "ceo", name: "Twin", manager: "ceo" }], "duplicate_person_id"],
		["an overlong name", [{ ...ceo, name: "N".repeat(61) }], "org_text_too_long"],
	])("rejects %s with a repair hint", (_, people, code) => {
		const found = issuesOf(chart(people)).find((issue) => issue.code === code);
		expect(found?.hint).toBeTruthy();
		expect(found?.path).toMatch(/^people\.\[\d\]/u);
	});

	it("reports repeated ids around a cycle instead of walking it", () => {
		const people = [
			{ id: "a", name: "A", manager: "b" },
			{ id: "b", name: "B", manager: "a" },
			{ id: "a", name: "Another A" },
		];
		expect(codes(chart(people))).toContain("duplicate_person_id");
	});

	it("draws several top people only as an explicit forest", () => {
		const people = [ceo, { id: "b", name: "Board chair" }];
		expect(codes(chart(people))).toEqual(["multiple_roots"]);
		expect(codes(chart(people, { forest: true }))).toEqual([]);
	});

	it("bounds people and depth", () => {
		const many = Array.from({ length: ORG_CHART_MAX_PEOPLE + 1 }, (_, index) => ({
			id: `p${index}`,
			name: `Person ${index}`,
			...(index === 0 ? {} : { manager: "p0" }),
		}));
		expect(codes(chart(many))).toContain("org_chart_too_large");
		const chain = Array.from({ length: ORG_CHART_MAX_DEPTH + 1 }, (_, index) => ({
			id: `p${index}`,
			name: `Person ${index}`,
			...(index === 0 ? {} : { manager: `p${index - 1}` }),
		}));
		expect(codes(chart(chain))).toContain("org_chart_too_large");
		expect(codes(chart(chain.slice(0, ORG_CHART_MAX_DEPTH)))).toEqual([]);
	});

	it.each([
		["an unknown person", { id: "d", report: "ghost", manager: "ceo" }],
		["a person to themselves", { id: "d", report: "a", manager: "a" }],
		["a copy of the solid line", { id: "d", report: "a", manager: "ceo" }],
	])("rejects a dotted line from %s", (_, line) => {
		const people = [ceo, { id: "a", name: "A", manager: "ceo" }];
		expect(codes(chart(people, { dottedLines: [line] }))).toContain("invalid_dotted_line");
	});

	it("rejects a repeated dotted line and its id", () => {
		const people = [
			ceo,
			{ id: "a", name: "A", manager: "ceo" },
			{ id: "b", name: "B", manager: "ceo" },
		];
		const line = { id: "d", report: "a", manager: "b" };
		expect(codes(chart(people, { dottedLines: [line, line] }))).toEqual([
			"duplicate_dotted_line_id",
			"invalid_dotted_line",
		]);
	});
});

describe("org chart shorthand", () => {
	it("reads manager, title and department aliases, assistants and listed reports", () => {
		const parsed = parseOrgChartDiagram(
			resolveOrgChartShorthand(
				chart([
					{ id: "ceo", name: "Ada", role: "CEO", directReports: ["cto"] },
					{ id: "cto", label: "Linus", position: "CTO", team: "Engineering" },
					{ id: "dev", name: "Ken", jobTitle: "Engineer", dept: "Engineering", reportsTo: "cto" },
					{ id: "ea", name: "Grace", kind: "assistant", managerId: "ceo" },
				]),
			),
		);
		expect(parsed.people).toEqual([
			{ id: "ceo", name: "Ada", title: "CEO" },
			{ id: "cto", name: "Linus", title: "CTO", department: "Engineering", manager: "ceo" },
			{ id: "dev", name: "Ken", title: "Engineer", department: "Engineering", manager: "cto" },
			{ id: "ea", name: "Grace", manager: "ceo", assistant: true },
		]);
	});

	it("reads explicit reporting lines and dotted lines written on a person or from/to", () => {
		const parsed = parseOrgChartDiagram(
			resolveOrgChartShorthand(
				chart(
					[
						ceo,
						{ id: "a", name: "A" },
						{ id: "b", name: "B", dottedLineTo: "a" },
						{ id: "c", name: "C" },
					],
					{
						reportingLines: [
							{ manager: "ceo", report: "a" },
							{ from: "ceo", to: "b" },
							{ from: "a", to: "c" },
							{ from: "b", to: "c", dotted: true },
						],
						dottedLines: [{ from: "a", to: "b" }],
					},
				),
			),
		);
		expect(parsed.people.map((person) => [person.id, person.manager])).toEqual([
			["ceo", undefined],
			["a", "ceo"],
			["b", "ceo"],
			["c", "a"],
		]);
		expect(parsed.dottedLines).toEqual([
			{ id: "a-dotted-b", report: "a", manager: "b" },
			{ id: "b-dotted-a", report: "b", manager: "a" },
			{ id: "c-dotted-b", report: "c", manager: "b" },
		]);
	});

	it("reads a single dotted line written as an object, never dropping it", () => {
		const people = [
			ceo,
			{ id: "a", name: "A", manager: "ceo" },
			{ id: "b", name: "B", manager: "ceo" },
		];
		const parsed = parseOrgChartDiagram(
			resolveOrgChartShorthand(
				chart(people, {
					dottedLines: { report: "a", manager: "b", label: "for clinical systems" },
				}),
			),
		);
		expect(parsed.dottedLines).toEqual([
			{ id: "a-dotted-b", report: "a", manager: "b", label: "for clinical systems" },
		]);
		expect(() =>
			parseOrgChartDiagram(resolveOrgChartShorthand(chart(people, { dottedLines: "a to b" }))),
		).toThrow(/dottedLines/u);
	});
});

describe("org chart initials", () => {
	it.each([
		["Ada Lovelace", "AL"],
		["grace brewster murray hopper", "GH"],
		["Linus", "L"],
		["Dr. Sarah Okafor", "SO"],
		["李雷", "李"],
		["  ", "?"],
	])("draws %s as %s", (name, initials) => {
		expect(orgPersonInitials(name)).toBe(initials);
	});
});
