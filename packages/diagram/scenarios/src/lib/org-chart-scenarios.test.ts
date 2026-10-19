import { describe, expect, it } from "vitest";
import type { OrgChartDiagram } from "@sketchi/diagram-core";
import { renderDiagram } from "@sketchi/diagram-renderer";

import { evaluateScenarioDiagram } from "./evaluate.js";
import { DiagramGenerationClient } from "@sketchi/diagram-generation";
import { Effect } from "effect";

import { FixtureGenerationClientLayer } from "./fixture-client.js";
import { toDiagramGenerationPrompt } from "./prompt.js";
import { candidateFromMcpResult } from "./mcp-results.js";
import {
	orgChartDrawnCheck,
	orgChartLayoutCheck,
	orgChartScenarios,
} from "./org-chart-scenarios.js";

const scenario = (id: string) => orgChartScenarios.find((entry) => entry.id === id)!;
const failed = (id: string, diagram: OrgChartDiagram) =>
	evaluateScenarioDiagram(scenario(id), diagram)
		.checks.filter((check) => !check.passed)
		.map((check) => check.id);
const startup = scenario("startup-team-org-chart").expectedDiagram;
const leadership = scenario("leadership-dotted-line-org-chart").expectedDiagram;
const regions = scenario("sales-regions-org-chart").expectedDiagram;
const withPerson = (
	diagram: OrgChartDiagram,
	id: string,
	change: (person: OrgChartDiagram["people"][number]) => OrgChartDiagram["people"][number],
): OrgChartDiagram => ({
	...diagram,
	people: diagram.people.map((person) => (person.id === id ? change(person) : person)),
});

describe("prompt-grounded org chart scenarios", () => {
	it("covers a startup, a wide department, an assistant, a dotted line and regions", () => {
		const diagrams = orgChartScenarios.map((entry) => entry.expectedDiagram);
		expect(orgChartScenarios.length).toBeGreaterThanOrEqual(3);
		expect(startup.people).toHaveLength(12);
		const department = scenario("engineering-department-org-chart").expectedDiagram;
		expect(department.people).toHaveLength(25);
		expect(
			Math.max(
				...department.people.map(
					(person) => department.people.filter((other) => other.manager === person.id).length,
				),
			),
		).toBe(8);
		expect(diagrams.some((diagram) => diagram.people.some((person) => person.assistant))).toBe(
			true,
		);
		expect(diagrams.some((diagram) => diagram.dottedLines.length > 0)).toBe(true);
		expect(diagrams.some((diagram) => diagram.groupByDepartment)).toBe(true);
	});

	it("passes its own expected diagram, including what the scene draws and its layout", () => {
		for (const entry of orgChartScenarios)
			expect(failed(entry.id, entry.expectedDiagram), entry.id).toEqual([]);
	});

	it("accepts a stated title in its other form and names written with other ids", () => {
		const renamed: OrgChartDiagram = {
			...startup,
			people: startup.people.map((person) => ({
				...person,
				id: `person-${person.id}`,
				...(person.manager ? { manager: `person-${person.manager}` } : {}),
				...(person.id === "maya" ? { title: "Chief Executive Officer" } : {}),
			})),
		};
		expect(failed("startup-team-org-chart", renamed)).toEqual([]);
	});

	it.each([
		[
			"a report under the wrong manager",
			() => withPerson(startup, "casey", (person) => ({ ...person, manager: "sam" })),
			["manager:casey"],
		],
		[
			"a changed title",
			() => withPerson(startup, "jordan", (person) => ({ ...person, title: "VP Engineering" })),
			["title:jordan"],
		],
		[
			"a missing person",
			() => ({ ...startup, people: startup.people.filter((person) => person.id !== "avery") }),
			["person:avery", "manager:avery", "title:avery", "people-exact"],
		],
		[
			"an invented person",
			() => ({
				...startup,
				people: [...startup.people, { id: "x", name: "Extra Person", manager: "maya" }],
			}),
			["people-exact"],
		],
	])("fails %s on the stated check", (_, change, expected) => {
		expect(failed("startup-team-org-chart", change()).toSorted()).toEqual(expected.toSorted());
	});

	it("requires the stated assistant and dotted line, and no other", () => {
		expect(
			failed(
				"leadership-dotted-line-org-chart",
				withPerson(leadership, "daniel", ({ assistant: _assistant, ...person }) => person),
			),
		).toEqual(["assistant:daniel"]);
		expect(
			failed(
				"leadership-dotted-line-org-chart",
				withPerson(leadership, "victor", (person) => ({ ...person, assistant: true })),
			),
		).toEqual(["assistants-stated"]);
		expect(failed("leadership-dotted-line-org-chart", { ...leadership, dottedLines: [] })).toEqual([
			"dotted-line:1",
			"dotted-line-scope:1",
			"dotted-lines-exact",
		]);
		expect(
			failed("leadership-dotted-line-org-chart", {
				...leadership,
				dottedLines: [
					{ id: "reversed", report: "linda", manager: "nina", label: "clinical systems" },
				],
			}),
		).toEqual(["dotted-line:1", "dotted-line-scope:1"]);
	});

	it("requires the dotted line's stated scope as its label, in any wording that carries it", () => {
		const line = leadership.dottedLines[0]!;
		const labeled = (label?: string): OrgChartDiagram => {
			const { label: _label, ...rest } = line;
			return { ...leadership, dottedLines: [label === undefined ? rest : { ...rest, label }] };
		};
		expect(line.label).toBe("clinical systems");
		expect(failed("leadership-dotted-line-org-chart", labeled())).toEqual(["dotted-line-scope:1"]);
		expect(failed("leadership-dotted-line-org-chart", labeled("matrix"))).toEqual([
			"dotted-line-scope:1",
		]);
		expect(failed("leadership-dotted-line-org-chart", labeled("For Clinical Systems"))).toEqual([]);
	});

	it("requires departments as regions when the prompt asks", () => {
		const { groupByDepartment: _grouping, ...flat } = regions;
		expect(failed("sales-regions-org-chart", flat as OrgChartDiagram)).toEqual([
			"department-regions",
		]);
		expect(
			failed(
				"sales-regions-org-chart",
				withPerson(regions, "mia", (person) => ({ ...person, department: "Marketing" })),
			),
		).toContain("department:mia");
	});

	it("reads the drawing: a dropped line or a moved card fails the scene checks", () => {
		const scene = renderDiagram(leadership);
		expect(orgChartDrawnCheck(leadership, scene).passed).toBe(true);
		const dropped = {
			...scene,
			elements: scene.elements.filter((element) => element.id !== "edge:dotted:nina-dotted-linda"),
		};
		expect(orgChartDrawnCheck(leadership, dropped).passed).toBe(false);
		const unlabeled = {
			...scene,
			elements: scene.elements.filter((element) => element.id !== "text:dotted:nina-dotted-linda"),
		};
		expect(orgChartDrawnCheck(leadership, unlabeled).message).toContain("dotted line label");
		const moved = {
			...scene,
			elements: scene.elements.map((element) =>
				element.type === "node" && element.id === "node:grace"
					? { ...element, x: element.x + 40, y: element.y - 60 }
					: element,
			),
		};
		expect(orgChartLayoutCheck(moved).passed).toBe(false);
	});

	it("keeps the VP's four reports on one level, though two lead big teams", () => {
		const scene = renderDiagram(scenario("engineering-department-org-chart").expectedDiagram);
		const top = (id: string) => {
			const card = scene.elements.find((element) => element.id === `node:${id}`);
			if (card?.type !== "node") throw new Error(`No card "${id}".`);
			return card.y;
		};
		expect(new Set(["marcus", "aisha", "tomas", "wei"].map(top)).size).toBe(1);
		expect(orgChartLayoutCheck(scene).passed).toBe(true);
	});

	it("serves the fixture model's diagram, meeting its count and every named person", async () => {
		const candidate = await Effect.runPromise(
			Effect.gen(function* () {
				const client = yield* DiagramGenerationClient;
				return yield* client.generate({
					model: "fixture",
					prompt: toDiagramGenerationPrompt(scenario("startup-team-org-chart")),
				});
			}).pipe(Effect.provide(FixtureGenerationClientLayer)),
		);
		expect(candidate.error).toBeUndefined();
		expect(candidate.diagram).toEqual(startup);
	});

	it("grades a buildOrgChart receipt from an MCP execute", () => {
		const receipt = {
			ok: true,
			status: "accepted",
			operation: "buildOrgChart",
			buildId: "build-1",
			normalizedSpec: { ...startup, type: undefined },
			quality: { accepted: true },
		};
		const candidate = candidateFromMcpResult(
			{ ok: true, result: { ok: true, status: "accepted", buildId: "build-1" }, builds: [receipt] },
			"org-chart",
		);
		expect(candidate?.ok).toBe(true);
		if (!candidate?.ok) throw new Error("Expected the accepted receipt.");
		expect(failed("startup-team-org-chart", candidate.diagram as OrgChartDiagram)).toEqual([]);
	});
});
