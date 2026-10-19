import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import { zoneFixtures, zoneRegionIssues, type CanvasSpec } from "@sketchi/diagram-core";
import { validateExcalidrawScene } from "@sketchi/diagram-excalidraw";

import { CodeModeArtifactStorage, makeMemoryArtifactStorage } from "./artifacts.js";
import { canonicalDocumentFromDiagram } from "./documents.js";
import { buildFlowchart, CodeModeRuntimeEnvironment } from "./runtime.js";

function build(spec: unknown) {
	return Effect.runPromise(
		buildFlowchart({
			spec,
			options: {
				inlineArtifacts: ["scene", "excalidraw"],
				artifactFormats: ["scene", "excalidraw"],
			},
		}).pipe(
			Effect.provideService(CodeModeRuntimeEnvironment, {
				createId: (prefix) => `${prefix}_zones`,
			}),
			Effect.provideService(CodeModeArtifactStorage, makeMemoryArtifactStorage()),
		),
	);
}

const spec = {
	title: "AWS three-tier app",
	layout: { direction: "LR" },
	groups: [
		{ id: "region", label: " us-east-1 ", kind: "region" },
		{ id: "vpc", label: "VPC", kind: "vpc", parent: " region " },
		{ id: "public", label: "Public subnet", kind: "subnet", parent: "vpc" },
		{ id: "data", label: "Database subnet", kind: "subnet", parent: "vpc" },
	],
	nodes: [
		{ id: "users", label: "Users", kind: "start" },
		{ id: "alb", label: "Application Load Balancer", kind: "process", group: "public" },
		{ id: "rds", label: "RDS PostgreSQL", kind: "end", shape: "database", group: "data" },
		{ id: "s3", label: "S3 bucket", kind: "end", shape: "document", group: "region" },
	],
	edges: [
		{ source: "users", target: "alb" },
		{ source: "alb", target: "rds" },
		{ source: "alb", target: "s3" },
	],
};

describe("Code Mode architecture zones", () => {
	it("builds nested zones and infrastructure shapes into an editable scene", async () => {
		const built = await build(spec);
		if (!built.ok) throw new Error(JSON.stringify(built.issues));
		expect(built.normalizedSpec.groups).toEqual([
			{ id: "region", label: "us-east-1", kind: "region" },
			{ id: "vpc", label: "VPC", parent: "region", kind: "vpc" },
			{ id: "public", label: "Public subnet", parent: "vpc", kind: "subnet" },
			{ id: "data", label: "Database subnet", parent: "vpc", kind: "subnet" },
		]);
		expect(built.normalizedSpec.nodes.map((node) => node.shape)).toEqual([
			undefined,
			undefined,
			"database",
			"document",
		]);
		const scene = built.artifact.formats.find((format) => format.format === "scene")
			?.inline as CanvasSpec;
		expect(zoneRegionIssues(scene, built.normalizedSpec)).toEqual([]);
		const excalidraw = built.artifact.formats.find((format) => format.format === "excalidraw")
			?.inline as Parameters<typeof validateExcalidrawScene>[0];
		expect(validateExcalidrawScene(excalidraw)).toEqual({ ok: true, issues: [] });
		expect(excalidraw.elements.some((element) => element.type === "frame")).toBe(false);
		expect(
			excalidraw.elements
				.filter((element) => element.id.startsWith("zone-label:"))
				.map((element) => element["text"]),
		).toEqual(["us-east-1", "VPC", "Public subnet", "Database subnet"]);
		expect(
			excalidraw.elements.find((element) => element.id === "node:rds")?.["customData"],
		).toEqual({ sketchiShape: "cylinder" });
	});

	it("rejects an undeclared parent, a nesting loop and a shaped decision with repair hints", async () => {
		const built = await build({
			...spec,
			groups: [
				{ id: "region", label: "us-east-1", parent: "vpc" },
				{ id: "vpc", label: "VPC", parent: "region" },
				{ id: "public", label: "Public subnet", parent: "cloud" },
				{ id: "data", label: "Database subnet", parent: "vpc" },
			],
			nodes: [
				...spec.nodes,
				{ id: "healthy", label: "Healthy?", kind: "decision", shape: "database" },
			],
			edges: [
				{ source: "users", target: "healthy" },
				{ source: "healthy", target: "alb", label: "yes" },
				{ source: "healthy", target: "rds", label: "no" },
				...spec.edges.slice(1),
			],
		});
		expect(built.ok).toBe(false);
		if (built.ok) return;
		expect(built.status).toBe("invalid_flowchart");
		expect(built.issues.map((issue) => [issue.code, issue.ref])).toEqual([
			["group_cycle", { kind: "group", id: "region", path: "spec.groups.parent" }],
			["group_cycle", { kind: "group", id: "vpc", path: "spec.groups.parent" }],
			["unknown_group_parent", { kind: "group", id: "public", path: "spec.groups.parent" }],
			["shaped_decision", { kind: "node", id: "healthy", path: "spec.nodes.shape" }],
		]);
		expect(built.issues[2]?.hint).toBe(
			'Set parent to the id of the declared group that encloses it ("region", "vpc", "public", "data"), or remove parent.',
		);
	});

	it("rejects an unknown zone kind or shape at the contract", async () => {
		const built = await build({
			...spec,
			groups: spec.groups.map((group, index) =>
				index === 0 ? { ...group, kind: "galaxy" } : group,
			),
		});
		expect(built.ok).toBe(false);
		if (built.ok) return;
		expect(built.issues[0]).toMatchObject({ code: "invalid_enum" });
	});

	it("keeps zones and shapes through the canonical document a generated diagram builds from", () => {
		const document = canonicalDocumentFromDiagram(zoneFixtures["hybrid-cloud"]);
		expect(document.type).toBe("flowchart");
		if (document.type !== "flowchart") return;
		expect(document.spec.groups?.find((group) => group.id === "corp")).toEqual({
			id: "corp",
			label: "Corporate network",
			parent: "onprem",
			kind: "zone",
		});
		expect(document.spec.nodes.find((node) => node.id === "orders")?.shape).toBe("queue");
	});
});
