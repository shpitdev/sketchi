import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import {
	flowchartDiagramFromDocument,
	zoneRegionIssues,
	type CanvasSpec,
} from "@sketchi/diagram-core";
import { validateExcalidrawScene } from "@sketchi/diagram-excalidraw";

import { CodeModeArtifactStorage, makeMemoryArtifactStorage } from "./artifacts.js";
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
	direction: "LR",
	nodes: {
		users: "Users",
		alb: "Application Load Balancer",
		rds: { label: "RDS PostgreSQL", shape: "database" },
		s3: { label: "S3 bucket", shape: "document" },
	},
	edges: [
		["users", "alb"],
		["alb", "rds"],
		["alb", "s3"],
	],
	groups: {
		region: { label: " us-east-1 ", kind: "region", contains: [" vpc ", "s3"] },
		vpc: { label: "VPC", kind: "vpc", contains: ["public", "data"] },
		public: { label: "Public subnet", kind: "subnet", contains: ["alb"] },
		data: { label: "Database subnet", kind: "subnet", contains: ["rds"] },
	},
};

describe("Code Mode architecture zones", () => {
	it("builds nested zones and infrastructure shapes into an editable scene", async () => {
		const built = await build(spec);
		if (!built.ok) throw new Error(JSON.stringify(built.issues));
		expect(built.normalizedSpec.groups?.["region"]).toEqual({
			label: "us-east-1",
			kind: "region",
			contains: ["vpc", "s3"],
		});
		const drawn = flowchartDiagramFromDocument(built.normalizedSpec);
		if (!drawn.ok) throw new Error(JSON.stringify(drawn.issues));
		expect(drawn.diagram.groups?.map((group) => [group.id, group.parent])).toEqual([
			["region", undefined],
			["vpc", "region"],
			["public", "vpc"],
			["data", "vpc"],
		]);
		expect(drawn.diagram.nodes.map((node) => node.shape)).toEqual([
			undefined,
			undefined,
			"database",
			"document",
		]);
		const scene = built.artifact.formats.find((format) => format.format === "scene")
			?.inline as CanvasSpec;
		expect(zoneRegionIssues(scene, drawn.diagram)).toEqual([]);
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

	it("rejects an unknown member and a nesting loop with repair hints", async () => {
		const built = await build({
			...spec,
			groups: {
				region: { label: "us-east-1", contains: ["vpc", "s3"] },
				vpc: { label: "VPC", contains: ["region", "public", "data"] },
				public: { label: "Public subnet", contains: ["alb", "cloud"] },
				data: { label: "Database subnet", contains: ["rds"] },
			},
		});
		expect(built.ok).toBe(false);
		if (built.ok) return;
		expect(built.status).toBe("invalid_flowchart");
		expect(built.issues.map((issue) => [issue.code, issue.ref])).toEqual([
			["unknown_member", { kind: "group", id: "public", path: "spec.groups.public.contains[1]" }],
			["group_cycle", { kind: "group", id: "region", path: "spec.groups.region.contains" }],
			["group_cycle", { kind: "group", id: "vpc", path: "spec.groups.vpc.contains" }],
		]);
	});

	it("rejects an unknown zone kind or shape at the contract", async () => {
		const built = await build({
			...spec,
			groups: { ...spec.groups, region: { ...spec.groups.region, kind: "galaxy" } },
		});
		expect(built.ok).toBe(false);
		if (built.ok) return;
		expect(built.issues[0]).toMatchObject({ code: "invalid_enum" });
	});
});
