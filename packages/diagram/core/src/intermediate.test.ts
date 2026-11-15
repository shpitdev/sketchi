import { SKETCHI_DIAGRAM_PALETTE, SKETCHI_DIAGRAM_STYLE } from "@sketchi/drawing";
// Positive fixtures deliberately unwrap Results: failure here is invalid test/story data, not user input.
import { Result } from "effect";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
	DiagramValidationError,
	flowchartFixture,
	parseFlowchartDiagram,
	parseIntermediateDiagram,
} from "./index";

const themeCss = readFileSync(new URL("../../../editor/src/theme.css", import.meta.url), "utf8");

function themeToken(name: string): string {
	const value = new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`, "iu").exec(themeCss)?.[1];
	if (!value) {
		throw new Error(`Missing canonical --${name} token in editor/theme.css`);
	}
	return value.toLowerCase();
}

describe("parseIntermediateDiagram", () => {
	it("keeps the runtime palette synchronized with editor/theme.css", () => {
		expect(SKETCHI_DIAGRAM_PALETTE).toEqual({
			paper: themeToken("paper"),
			card: themeToken("card"),
			ink: themeToken("ink"),
			accent: themeToken("accent"),
		});
	});

	it("applies the Sketchi diagram style when generation omits styling", () => {
		expect(
			parseIntermediateDiagram({
				id: "brand-defaults",
				title: "Brand defaults",
				nodes: [{ id: "only", label: "Only node" }],
			}).pipe(Result.getOrThrow).style,
		).toEqual(SKETCHI_DIAGRAM_STYLE);
	});

	it("carries an optional icon reference on every diagram node family", () => {
		const diagram = parseIntermediateDiagram({
			id: "logos",
			title: "Logos",
			nodes: [
				{ id: "build", label: "Docker build", icon: { slug: "docker" } },
				{ id: "plain", label: "Plain step" },
			],
		}).pipe(Result.getOrThrow);
		expect(diagram.nodes[0]?.icon).toEqual({ slug: "docker" });
		expect(diagram.nodes[1]?.icon).toBeUndefined();
		expect(
			parseFlowchartDiagram({
				...flowchartFixture,
				nodes: flowchartFixture.nodes.map((node, index) =>
					index === 0 ? { ...node, icon: { slug: "github" } } : node,
				),
			}).pipe(Result.getOrThrow).nodes[0]?.icon,
		).toEqual({ slug: "github" });
	});

	it("accepts community icon slugs under their namespace", () => {
		const diagram = parseIntermediateDiagram({
			id: "logos",
			title: "Logos",
			nodes: [{ id: "queue", label: "Queue", icon: { slug: "community/ring-queue" } }],
		}).pipe(Result.getOrThrow);
		expect(diagram.nodes[0]?.icon?.slug).toBe("community/ring-queue");
	});

	it("rejects icon slugs that are not catalog-shaped", () => {
		for (const slug of [
			"Docker",
			"docker logo",
			"",
			"-docker",
			"a".repeat(65),
			"community/",
			"community/a/b",
			`community/${"a".repeat(65)}`,
			"other/docker",
		]) {
			expect(
				parseIntermediateDiagram({
					id: "logos",
					title: "Logos",
					nodes: [{ id: "build", label: "Build", icon: { slug } }],
				}),
			).toMatchObject({
				failure: { message: expect.stringContaining('at ["nodes"][0]["icon"]["slug"]') },
			});
		}
	});

	it("rejects duplicate node ids", () => {
		expect(
			parseIntermediateDiagram({
				...flowchartFixture,
				nodes: [...flowchartFixture.nodes, { id: "prompt", label: "Duplicate" }],
			}),
		).toMatchObject({ failure: expect.any(DiagramValidationError) });
	});

	it("keeps declared groups and rejects references to undeclared or duplicate ones", () => {
		const grouped = parseIntermediateDiagram({
			...flowchartFixture,
			groups: [{ id: "intake", label: "Intake" }],
			nodes: flowchartFixture.nodes.map((node, index) =>
				index < 2 ? { ...node, group: "intake" } : node,
			),
		}).pipe(Result.getOrThrow);
		expect(grouped.groups).toEqual([{ id: "intake", label: "Intake" }]);
		expect(grouped.nodes.filter((node) => node.group === "intake")).toHaveLength(2);
		expect(
			parseIntermediateDiagram(flowchartFixture).pipe(Result.getOrThrow).groups,
		).toBeUndefined();
		expect(
			parseIntermediateDiagram({
				...flowchartFixture,
				nodes: flowchartFixture.nodes.map((node) => ({ ...node, group: "intake" })),
			}),
		).toMatchObject({
			failure: {
				message: expect.stringContaining('Node "prompt" references missing group "intake".'),
			},
		});
		expect(
			parseIntermediateDiagram({
				...flowchartFixture,
				groups: [
					{ id: "intake", label: "Intake" },
					{ id: "intake", label: "Intake again" },
				],
			}),
		).toMatchObject({
			failure: { message: expect.stringContaining('Duplicate group id "intake" is not allowed.') },
		});
	});

	it("rejects edges that reference missing nodes", () => {
		expect(
			parseIntermediateDiagram({
				...flowchartFixture,
				edges: [
					...flowchartFixture.edges,
					{
						id: "missing-edge",
						source: "prompt",
						target: "missing",
						label: "bad",
					},
				],
			}),
		).toMatchObject({
			failure: {
				message: expect.stringContaining(
					'Edge "missing-edge" references missing target node "missing".',
				),
			},
		});
	});
});
