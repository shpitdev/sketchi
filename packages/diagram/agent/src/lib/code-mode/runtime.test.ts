import { describe, expect, it } from "vitest";
import { Context, Effect, Schema, Result } from "effect";

import {
	CANVAS_LIMITS,
	type CanvasSpec,
	type CanvasShapeElement,
	FLOWCHART_MAX_EDGES,
	FLOWCHART_MAX_ISSUES,
	FLOWCHART_MAX_NODES,
	mindmapFixture,
	parseChartDiagram,
} from "@sketchi/diagram-core";
import {
	mindmapLayoutIssues,
	renderChartDiagram,
	renderMindmapDiagram,
	type RenderedDiagramScene,
} from "@sketchi/diagram-renderer";
import {
	CodeModeArtifactStorageError,
	CodeModeArtifactStorage,
	makeMemoryArtifactStorage,
	makeObjectBucketArtifactStorage,
	type CodeModeArtifactStorageShape,
	type CodeModeObjectBucket,
	type CodeModeObjectBucketObject,
} from "./artifacts";
import {
	CanvasSpecSchema,
	CreateCanvasRequestSchema,
	toCodeModeJsonSchema,
	RenderedDiagramSceneSchema,
	type ApplyDiagramPatchResult,
	type ArtifactFormat,
	type BuildFlowchartResult,
	type CreateCanvasResult,
	type GetArtifactResult,
} from "./contract";
import {
	applyDiagramPatch,
	buildFlowchart,
	editFlowchart,
	buildMindmap,
	buildSequenceDiagram,
	CodeModeRuntimeEnvironment,
	CodeModeArtifactRenderFailed,
	createCanvas,
	getArtifact,
	type CodeModeRuntimeOptions,
} from "./runtime";

function makeTestRuntime(
	options: CodeModeRuntimeOptions & {
		readonly store?: CodeModeArtifactStorageShape;
	} = {},
) {
	const storage = options.store ?? makeMemoryArtifactStorage();
	const environment: Context.Service.Shape<typeof CodeModeRuntimeEnvironment> = {
		createId: options.createId ?? ((prefix) => `${prefix}-test`),
		...(options.renderer ? { renderer: options.renderer } : {}),
		...(options.artifactUrl ? { artifactUrl: options.artifactUrl } : {}),
	};
	const run = <A>(
		program: Effect.Effect<A, never, CodeModeArtifactStorage | CodeModeRuntimeEnvironment>,
	) =>
		Effect.runPromise(
			program.pipe(
				Effect.provideService(CodeModeArtifactStorage, storage),
				Effect.provideService(CodeModeRuntimeEnvironment, environment),
			),
		);

	return {
		applyDiagramPatch: (input: unknown) => run(applyDiagramPatch(input)),
		buildFlowchart: (input: unknown) => run(buildFlowchart(input)),
		buildMindmap: (input: unknown) => run(buildMindmap(input)),
		buildSequenceDiagram: (input: unknown) => run(buildSequenceDiagram(input)),
		createCanvas: (input: unknown) => run(createCanvas(input)),
		editFlowchart: (input: unknown) => run(editFlowchart(input)),
		getArtifact: (input: unknown) => run(getArtifact(input)),
	};
}

function createTestRuntime() {
	let id = 0;
	return makeTestRuntime({
		store: makeMemoryArtifactStorage(),
		createId: (prefix) => `${prefix}-${(id += 1)}`,
	});
}

/**
 * The approval flowchart's drawing stored as a canvas. A flowchart is never patched, so the patch
 * engine's tests run on the same graph through a canvas artifact.
 */
async function approvalCanvas(
	runtime: ReturnType<typeof createTestRuntime>,
	inlineArtifacts: ("scene" | "excalidraw")[] = [],
) {
	const built = await runtime.buildFlowchart({
		spec: approvalSpec(),
		options: { inlineArtifacts: ["scene"] },
	});
	if (!built.ok) throw new Error("Expected the approval flowchart to build.");
	const scene = built.artifact.formats.find((format) => format.format === "scene")?.inline;
	return runtime.createCanvas({ spec: scene, options: { inlineArtifacts } });
}

function approvalSpec() {
	return {
		title: "Simple approval flow",
		direction: "TB",
		nodes: {
			request: "Request arrives",
			approve: "Approved?",
			done: "Done",
			revise: "Revise",
		},
		edges: [
			["request", "approve"],
			["approve", "done", "yes"],
			["approve", "revise", "no"],
		],
	};
}

function checkoutSequenceSpec() {
	return {
		title: "Checkout sequence",
		participants: [
			{ id: "customer", label: "Customer" },
			{ id: "store", label: "Store" },
			{ id: "payments", label: "Payments" },
		],
		messages: [
			{ source: "customer", target: "store", label: "Checkout" },
			{ source: "store", target: "payments", label: "Authorize" },
			{
				source: "payments",
				target: "customer",
				label: "Approved",
				type: "return",
			},
		],
	};
}

function crossingSequenceSpec() {
	return {
		title: "Crossing sequence",
		participants: [
			{ id: "a", label: "A" },
			{ id: "b", label: "B" },
			{ id: "c", label: "C" },
		],
		messages: [{ source: "a", target: "c", label: "Cross B" }],
	};
}

function spoofedInlineLifelineScene(options: { readonly useLifelineId: boolean }) {
	const middleNodeId = options.useLifelineId ? "middle:lifeline" : "middle";
	return {
		kind: "canvas",
		version: 1,
		diagramId: "spoofed-inline-lifeline",
		title: "Spoofed inline lifeline",
		width: 440,
		height: 180,
		accentColor: "#0f766e",
		backgroundColor: "#ffffff",
		elements: [
			{
				type: "arrow",
				id: "edge:start-end",
				edgeId: "start-end",
				sourceNodeId: "start",
				targetNodeId: "end",
				points: [
					{ x: 120, y: 90 },
					{ x: 320, y: 90 },
				],
			},
			{
				type: "node",
				id: "node:start",
				nodeId: "start",
				shape: "rectangle",
				x: 20,
				y: 60,
				width: 100,
				height: 60,
				label: "Start",
			},
			...(options.useLifelineId
				? [
						{
							type: "node",
							id: "node:middle",
							nodeId: "middle",
							shape: "rectangle",
							x: 130,
							y: -60,
							width: 180,
							height: 72,
							label: "Middle header",
						},
					]
				: []),
			{
				type: "node",
				id: `node:${middleNodeId}`,
				nodeId: middleNodeId,
				rendererRole: "sequence-lifeline",
				shape: "rectangle",
				x: 170,
				y: 60,
				width: 100,
				height: 60,
				label: "Middle",
			},
			{
				type: "node",
				id: "node:end",
				nodeId: "end",
				shape: "rectangle",
				x: 320,
				y: 60,
				width: 100,
				height: 60,
				label: "End",
			},
		],
		layers: [],
		layouts: [],
		zOrder: [
			"edge:start-end",
			"node:start",
			...(options.useLifelineId ? ["node:middle"] : []),
			`node:${middleNodeId}`,
			"node:end",
		],
	};
}

function linearFlowchartSpec(nodeCount: number) {
	const ids = Array.from({ length: nodeCount }, (_, index) => `node-${index}`);
	return {
		title: `Linear flow with ${nodeCount} nodes`,
		nodes: Object.fromEntries(ids.map((id, index) => [id, `Concrete operation ${index}`])),
		edges: ids.slice(0, -1).map((id, index) => [id, ids[index + 1] ?? id] as [string, string]),
	};
}

function denseAcyclicFlowchartSpec(edgeCount: number) {
	const spec = linearFlowchartSpec(FLOWCHART_MAX_NODES);
	const ids = Object.keys(spec.nodes);
	const chainKeys = new Set(spec.edges.map(([source, target]) => `${source}->${target}`));
	const extraEdges = ids.flatMap((source, sourceIndex) =>
		ids
			.slice(sourceIndex + 1)
			.flatMap((target) =>
				chainKeys.has(`${source}->${target}`) ? [] : [[source, target] as [string, string]],
			),
	);
	return {
		...spec,
		edges: [...spec.edges, ...extraEdges].slice(0, edgeCount),
	};
}

function whitespaceFlowchartCases(): Array<{
	name: string;
	path: string;
	spec: unknown;
}> {
	const base = linearFlowchartSpec(3);
	return [
		{ name: "title", path: "spec.title", spec: { ...base, title: "   " } },
		{
			name: "node label",
			path: "spec.nodes.node-1",
			spec: { ...base, nodes: { ...base.nodes, "node-1": "   " } },
		},
	];
}

function incidentEscalationOpsSpec() {
	return {
		id: "incident-escalation-ops",
		title: "Incident Escalation & Operations Response",
		direction: "TB",
		nodes: {
			alert_received: "Alert Received",
			triage: "Triage & Deduplicate",
			is_actionable: "Actionable Signal?",
			auto_close: "Auto-Close / Suppress",
			severity: "Assess Severity",
			sev1_page: "Page On-Call (SEV1)",
			sev2_assign: "Assign Owner (SEV2)",
			sev3_queue: "Queue Backlog (SEV3)",
			incident_bridge: "Open Incident Bridge",
			investigate: "Investigate Root Cause",
			mitigated: "Mitigated?",
			reassess: "Reassess Severity",
			comms: "Notify Stakeholders",
			monitor: "Stable After Monitoring?",
			postmortem: "Write Postmortem",
			resolved: "Incident Resolved",
		},
		edges: [
			["alert_received", "triage"],
			["triage", "is_actionable"],
			["is_actionable", "auto_close", "no"],
			["is_actionable", "severity", "yes"],
			["severity", "sev1_page", "SEV1"],
			["severity", "sev2_assign", "SEV2"],
			["severity", "sev3_queue", "SEV3"],
			["sev1_page", "incident_bridge"],
			["sev2_assign", "incident_bridge"],
			["incident_bridge", "investigate"],
			["sev3_queue", "investigate"],
			["investigate", "mitigated"],
			["mitigated", "comms", "yes"],
			["mitigated", "reassess", "no"],
			["reassess", "severity", "re-triage"],
			["comms", "monitor"],
			["monitor", "postmortem", "stable"],
			["monitor", "investigate", "regressed"],
			["postmortem", "resolved"],
		],
	};
}

function productionReleaseRollbackSpec() {
	return {
		id: "production-release-incident-response-rollback",
		title: "Production Release Incident Response Rollback Flow",
		direction: "TB",
		nodes: {
			start: "Start",
			ci_build: "CI Build",
			ci_gate: "CI Gate",
			security_scan: "Security Scan",
			scan_gate: "Scan Gate",
			vuln_gate: "Vuln Gate",
			deploy_staging: "Deploy Staging",
			smoke_staging: "Smoke Staging",
			staging_gate: "Staging Gate",
			fix_code: "Fix Code",
			canary_deploy: "Canary Deploy",
			canary_gate: "Canary Gate",
			full_rollout: "Full Rollout",
			monitor: "Monitor",
			incident_gate: "Incident Gate",
			severity_gate: "Severity Gate",
			page_oncall: "Page Oncall",
			mitigate: "Mitigate",
			mitigation_gate: "Mitigation Gate",
			rollback: "Rollback",
			rollback_gate: "Rollback Gate",
			manual_recovery: "Manual Recovery",
			postmortem: "Postmortem",
			done: "Done",
		},
		edges: [
			["start", "ci_build", "trigger"],
			["ci_build", "ci_gate", "tests done"],
			["ci_gate", "security_scan", "green"],
			["ci_gate", "fix_code", "red"],
			["fix_code", "ci_build", "rebuild"],
			["security_scan", "scan_gate", "scan"],
			["scan_gate", "deploy_staging", "clean"],
			["scan_gate", "vuln_gate", "vulns"],
			["vuln_gate", "done", "abort"],
			["vuln_gate", "fix_code", "patch"],
			["deploy_staging", "smoke_staging", "deploy"],
			["smoke_staging", "staging_gate", "verify"],
			["staging_gate", "canary_deploy", "healthy"],
			["staging_gate", "fix_code", "failed"],
			["canary_deploy", "canary_gate", "5 percent"],
			["canary_gate", "full_rollout", "ok"],
			["canary_gate", "rollback", "regression"],
			["full_rollout", "monitor", "observe"],
			["monitor", "incident_gate", "signals"],
			["incident_gate", "done", "stable"],
			["incident_gate", "severity_gate", "incident"],
			["severity_gate", "page_oncall", "sev1"],
			["severity_gate", "mitigate", "low sev"],
			["page_oncall", "mitigate", "triage"],
			["mitigate", "mitigation_gate", "mitigate"],
			["mitigation_gate", "monitor", "worked"],
			["mitigation_gate", "rollback", "missed SLA"],
			["rollback", "rollback_gate", "rollback"],
			["rollback_gate", "postmortem", "restored"],
			["rollback_gate", "manual_recovery", "still failing"],
			["manual_recovery", "rollback_gate", "re-verify"],
			["postmortem", "done", "closed"],
		],
	};
}

function expectBuildOk(
	result: BuildFlowchartResult,
): asserts result is Extract<BuildFlowchartResult, { ok: true }> {
	if (!result.ok) {
		throw new Error(`Expected build success: ${JSON.stringify(result.issues)}`);
	}
	expect(result.ok).toBe(true);
}

function expectBuildFailure(
	result: BuildFlowchartResult,
): asserts result is Extract<BuildFlowchartResult, { ok: false }> {
	expect(result.ok).toBe(false);
	if (result.ok) {
		throw new Error("Expected build failure.");
	}
}

function expectCanvasOk(
	result: CreateCanvasResult,
): asserts result is Extract<CreateCanvasResult, { ok: true }> {
	if (!result.ok) {
		throw new Error(`Expected canvas success: ${JSON.stringify(result.issues)}`);
	}
	expect(result.ok).toBe(true);
}

function expectGetOk(
	result: GetArtifactResult,
): asserts result is Extract<GetArtifactResult, { ok: true }> {
	expect(result.ok).toBe(true);
	if (!result.ok) {
		throw new Error(`Expected get success: ${JSON.stringify(result.issues)}`);
	}
}

function expectPatchOk(
	result: ApplyDiagramPatchResult,
): asserts result is Extract<ApplyDiagramPatchResult, { ok: true }> {
	if (!result.ok) {
		throw new Error(`Expected patch success: ${JSON.stringify(result.issues)}`);
	}
	expect(result.ok).toBe(true);
}

function expectPatchFailure(
	result: ApplyDiagramPatchResult,
): asserts result is Extract<ApplyDiagramPatchResult, { ok: false }> {
	expect(result.ok).toBe(false);
	if (result.ok) {
		throw new Error("Expected patch failure.");
	}
}

function throwingStore(): CodeModeArtifactStorageShape {
	const fail = (operation: "read" | "readManifest" | "write", message: string) =>
		Effect.fail(
			new CodeModeArtifactStorageError({
				cause: new Error(message),
				message,
				operation,
			}),
		);
	return {
		read: () => fail("read", "bucket read failed"),
		readManifest: () => fail("readManifest", "manifest read failed"),
		write: () => fail("write", "bucket write failed"),
	};
}

function parseInlineScene(value: unknown) {
	return Schema.decodeUnknownSync(RenderedDiagramSceneSchema, {
		errors: "all",
		reportInput: true,
	})(value);
}

class MemoryBucket implements CodeModeObjectBucket {
	readonly objects = new Map<string, string | Uint8Array>();

	async get(key: string): Promise<CodeModeObjectBucketObject | null> {
		const value = this.objects.get(key);
		if (!value) {
			return null;
		}
		const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
		return {
			size: bytes.byteLength,
			arrayBuffer: async () => toArrayBuffer(bytes),
			text: async () => (typeof value === "string" ? value : new TextDecoder().decode(value)),
		};
	}

	async put(key: string, value: string | ArrayBuffer | Uint8Array): Promise<unknown> {
		this.objects.set(key, typeof value === "string" ? value : new Uint8Array(value));
		return null;
	}
}

class FailingPngBucket extends MemoryBucket {
	override async put(key: string, value: string | ArrayBuffer | Uint8Array): Promise<unknown> {
		if (key.endsWith("/png.png")) {
			throw new Error("png write failed");
		}

		return super.put(key, value);
	}
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
	const buffer = new ArrayBuffer(bytes.byteLength);
	new Uint8Array(buffer).set(bytes);
	return buffer;
}

describe("Code Mode runtime", () => {
	it("builds a nested mindmap with deterministic hierarchy ids and exports", async () => {
		const runtime = createTestRuntime();
		const built = await runtime.buildMindmap({
			requestId: "mindmap-request",
			spec: {
				title: "Launch strategy",
				root: {
					label: "Launch",
					children: [
						{
							label: "Product",
							children: [{ label: "Scope" }, { label: "Quality" }],
						},
						{ label: "Go to market", children: [{ label: "Docs" }] },
					],
				},
			},
		});
		expect(built).toMatchObject({
			ok: true,
			status: "accepted",
			requestId: "mindmap-request",
			normalizedSpec: {
				id: "launch-strategy",
				root: {
					id: "topic-0",
					children: [
						{
							id: "topic-0-0",
							children: [{ id: "topic-0-0-0" }, { id: "topic-0-0-1" }],
						},
						{ id: "topic-0-1" },
					],
				},
			},
		});
		if (!built.ok) throw new Error("Expected accepted mindmap");
		expect(built.artifact.formats.map((format) => format.format)).toEqual(["excalidraw", "scene"]);
	});

	it("returns typed mindmap hierarchy failures", async () => {
		const result = await createTestRuntime().buildMindmap({
			spec: { title: "Empty", root: { label: "Only root" } },
		});
		expect(result).toMatchObject({
			ok: false,
			status: "invalid_mindmap",
			issues: [{ code: "disconnected_graph", stage: "mindmap" }],
		});
	});

	it("preflights extreme mindmap depth before recursive schema decoding", async () => {
		const root: { label: string; children?: unknown[] } = { label: "root" };
		let current = root;
		for (let depth = 0; depth < 2_000; depth += 1) {
			const child: { label: string; children?: unknown[] } = {
				label: `depth ${depth}`,
			};
			current.children = [child];
			current = child;
		}
		const result = await createTestRuntime().buildMindmap({
			spec: { title: "Deep", root },
		});
		expect(result).toMatchObject({
			ok: false,
			status: "invalid_mindmap",
			issues: [{ code: "mindmap_too_deep", stage: "mindmap" }],
		});
	});

	it("preflights overly wide mindmaps", async () => {
		const result = await createTestRuntime().buildMindmap({
			spec: {
				title: "Wide",
				root: {
					label: "root",
					children: Array.from({ length: 201 }, (_, index) => ({
						label: `topic ${index}`,
					})),
				},
			},
		});
		expect(result).toMatchObject({
			ok: false,
			status: "invalid_mindmap",
			issues: [{ code: "mindmap_too_large" }],
		});
	});

	it("counts malformed child slots and keeps extreme-width failures bounded", async () => {
		const result = await createTestRuntime().buildMindmap({
			spec: {
				title: "Malformed width",
				root: {
					label: "root",
					children: Array.from({ length: 100_000 }, () => null),
				},
			},
		});
		expect(result).toMatchObject({
			ok: false,
			status: "invalid_mindmap",
			issues: [{ code: "mindmap_too_large" }],
		});
		expect(result.issues).toHaveLength(1);
		expect(JSON.stringify(result).length).toBeLessThan(2_000);
	});

	it("caps schema issue amplification for every Code Mode operation", async () => {
		const result = await createTestRuntime().buildFlowchart({
			spec: {
				title: "Malformed",
				nodes: Object.fromEntries(Array.from({ length: 1_000 }, (_, index) => [`n${index}`, {}])),
				edges: [],
			},
		});
		expect(result).toMatchObject({ ok: false, status: "invalid_input" });
		expect(result.issues).toHaveLength(21);
		expect(result.issues.at(-1)?.message).toContain("additional input issues were omitted");
	});

	it.each([
		[
			"title",
			{ title: "  ", root: { label: "Root", children: [{ label: "Child" }] } },
			"spec.title",
		],
		[
			"topic",
			{ title: "Valid", root: { label: "Root", children: [{ label: "''" }] } },
			"spec.root.children.[0].label",
		],
		[
			"tool-cleaned topic",
			{
				title: "Valid",
				root: { label: "Root", children: [{ label: " , title:" }] },
			},
			"spec.root.children.[0].label",
		],
	])(
		"returns precise invalid_input paths for empty semantic %s strings",
		async (_name, spec, path) => {
			const result = await createTestRuntime().buildMindmap({ spec });
			expect(result).toMatchObject({
				ok: false,
				status: "invalid_input",
				issues: [{ stage: "input", ref: { path } }],
			});
		},
	);

	it("renders and exports right-to-left mindmaps", async () => {
		const result = await createTestRuntime().buildMindmap({
			spec: {
				title: "RTL hierarchy",
				layout: { direction: "RL" },
				root: {
					label: "Root",
					children: [{ label: "Child", children: [{ label: "Leaf" }] }],
				},
			},
			options: { inlineArtifacts: ["scene", "excalidraw"] },
		});
		expect(result).toMatchObject({
			ok: true,
			normalizedSpec: { layout: { direction: "RL" } },
		});
		if (!result.ok) throw new Error("Expected accepted RL mindmap");
		const scene = parseInlineScene(
			result.artifact.formats.find((format) => format.format === "scene")?.inline,
		);
		const nodes = scene.elements.filter((element) => element.type === "node");
		const root = nodes.find((node) => node.nodeId === "topic-0");
		const child = nodes.find((node) => node.nodeId === "topic-0-0");
		expect(root?.x).toBeGreaterThan(child?.x ?? Number.POSITIVE_INFINITY);
		expect(
			result.artifact.formats.find((format) => format.format === "excalidraw")?.inline,
		).toBeDefined();
	});

	it("round-trips a persisted mindmap through getArtifact and patch retrieval", async () => {
		const runtime = createTestRuntime();
		const built = await runtime.buildMindmap({
			spec: {
				title: "Roadmap",
				root: {
					label: "Roadmap",
					children: [{ label: "Now" }, { label: "Next" }],
				},
			},
		});
		if (!built.ok) throw new Error("Expected accepted mindmap");
		const persisted = await runtime.getArtifact({
			artifactId: built.artifact.artifactId,
			format: "scene",
			inline: true,
		});
		expect(persisted).toMatchObject({ ok: true, diagramId: "roadmap" });
		const patched = await runtime.applyDiagramPatch({
			source: { artifactId: built.artifact.artifactId },
			operations: [
				{
					op: "replaceText",
					selector: { nodeIds: ["topic-0-1"] },
					text: "Later",
				},
			],
		});
		if (!patched.ok) throw new Error("Expected accepted mindmap patch");
		const retrieved = await runtime.getArtifact({
			artifactId: patched.artifact.artifactId,
			format: "scene",
			inline: true,
		});
		expect(retrieved).toMatchObject({
			ok: true,
			provenance: { sourceArtifactId: built.artifact.artifactId },
		});
		expect(JSON.stringify(retrieved)).toContain("Later");
	});
	it("builds an accepted flowchart and retrieves stored formats", async () => {
		const runtime = createTestRuntime();
		const built = await runtime.buildFlowchart({
			requestId: "request-1",
			spec: approvalSpec(),
		});

		expectBuildOk(built);
		expect(built.status).toBe("accepted");
		expect(built.requestId).toBe("request-1");

		expect(built.artifact.formats.map((format) => format.format)).toEqual([
			"excalidraw",
			"scene",
			"document",
		]);

		const inlineScene = built.artifact.formats.find((format) => format.format === "scene")?.inline;
		expect(parseInlineScene(inlineScene).elements.length).toBeGreaterThan(0);
		expect(built.artifact).not.toHaveProperty("preview");

		const excalidraw = await runtime.getArtifact({
			artifactId: built.artifact.artifactId,
			format: "excalidraw",
		});

		expectGetOk(excalidraw);
		expect(excalidraw.mimeType).toBe("application/vnd.excalidraw+json");
		expect(excalidraw).not.toHaveProperty("inline");

		const inlineExcalidraw = await runtime.getArtifact({
			artifactId: built.artifact.artifactId,
			format: "excalidraw",
			inline: true,
		});

		expectGetOk(inlineExcalidraw);
		expect(inlineExcalidraw.inline).toMatchObject({
			type: "excalidraw",
			version: 2,
			source: "https://sketchi.app",
			appState: expect.any(Object),
			elements: expect.any(Array),
			files: {},
		});
	});

	it("adds raw artifact URLs when the runtime is configured with a URL builder", async () => {
		let id = 0;
		const runtime = makeTestRuntime({
			store: makeMemoryArtifactStorage(),
			createId: (prefix) => `${prefix}-${(id += 1)}`,
			artifactUrl: ({ artifactId, format }) =>
				`https://studio.test/api/v1/artifacts/${artifactId}?format=${format}&raw=true`,
		});

		const built = await runtime.buildFlowchart({
			spec: approvalSpec(),
			options: {
				artifactFormats: ["scene", "excalidraw"],
				inlineArtifacts: ["scene"],
			},
		});

		expectBuildOk(built);
		expect(built.artifact.formats).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					format: "scene",
					url: `https://studio.test/api/v1/artifacts/${built.artifact.artifactId}?format=scene&raw=true`,
				}),
				expect.objectContaining({
					format: "excalidraw",
					url: `https://studio.test/api/v1/artifacts/${built.artifact.artifactId}?format=excalidraw&raw=true`,
				}),
			]),
		);

		const excalidraw = await runtime.getArtifact({
			artifactId: built.artifact.artifactId,
			format: "excalidraw",
			inline: true,
		});

		expectGetOk(excalidraw);
		expect(excalidraw).toMatchObject({
			format: "excalidraw",
			url: `https://studio.test/api/v1/artifacts/${built.artifact.artifactId}?format=excalidraw&raw=true`,
			inline: {
				type: "excalidraw",
				version: 2,
				files: {},
			},
		});
	});

	it("exports dense incident feedback flows without edge-through-node routes", async () => {
		const runtime = createTestRuntime();
		const built = await runtime.buildFlowchart({
			spec: incidentEscalationOpsSpec(),
			options: {
				artifactFormats: ["scene", "excalidraw"],
				inlineArtifacts: ["scene", "excalidraw"],
			},
		});

		expectBuildOk(built);
		expect(built.quality.summary).toEqual({ nodeCount: 16, edgeCount: 19 });
		expect(built.artifact.formats.map((format) => format.format)).toEqual([
			"scene",
			"excalidraw",
			"document",
		]);
	});

	it("exports production release rollback flows without dense route collisions", async () => {
		const runtime = createTestRuntime();
		const built = await runtime.buildFlowchart({
			spec: productionReleaseRollbackSpec(),
			options: {
				artifactFormats: ["scene", "excalidraw"],
				inlineArtifacts: ["scene", "excalidraw"],
			},
		});

		expectBuildOk(built);
		expect(built.quality.summary).toEqual({ nodeCount: 24, edgeCount: 32 });
		expect(built.artifact.formats.map((format) => format.format)).toEqual([
			"scene",
			"excalidraw",
			"document",
		]);
	});

	it.each(whitespaceFlowchartCases())(
		"rejects whitespace-only $name after normalization as a bounded flowchart failure",
		async ({ spec, path }) => {
			const result = await createTestRuntime().buildFlowchart({ spec });
			expectBuildFailure(result);

			expect(result.status).toBe("invalid_flowchart");
			expect(result.issues.length).toBeLessThanOrEqual(FLOWCHART_MAX_ISSUES);
			expect(result.issues).toContainEqual(
				expect.objectContaining({
					stage: "flowchart",
					ref: expect.objectContaining({ path }),
				}),
			);
			expect(result.issues.map((entry) => entry.code)).not.toContain("render_failed");
		},
	);

	it("caps normalized flowchart schema failures deterministically", async () => {
		const base = linearFlowchartSpec(FLOWCHART_MAX_NODES);
		const spec = {
			...base,
			nodes: Object.fromEntries(Object.keys(base.nodes).map((id) => [id, "   "])),
		};
		const first = await createTestRuntime().buildFlowchart({ spec });
		const second = await createTestRuntime().buildFlowchart({ spec });
		expectBuildFailure(first);
		expectBuildFailure(second);

		expect(first.status).toBe("invalid_flowchart");
		expect(first.issues).toHaveLength(FLOWCHART_MAX_ISSUES);
		expect(second.issues).toEqual(first.issues);
	});

	it("rejects a reachable closed cycle with typed nonterminating nodes", async () => {
		const result = await createTestRuntime().buildFlowchart({
			spec: {
				title: "Closed retry cycle",
				nodes: {
					start: "Request arrives",
					route: "Ready?",
					done: "Completed",
					"retry-a": "Retry stage alpha",
					"retry-b": "Retry stage beta",
				},
				edges: [
					["start", "route"],
					["route", "done", "yes"],
					["route", "retry-a", "retry"],
					["retry-a", "retry-b"],
					["retry-b", "retry-a"],
				],
			},
		});

		expectBuildFailure(result);
		expect(result.status).toBe("invalid_flowchart");
		expect(
			result.issues
				.filter((issue) => issue.code === "nonterminating_node")
				.map((issue) => issue.ref?.id),
		).toEqual(["retry-a", "retry-b"]);
	});

	it("accepts retry loops that retain an eventual exit", async () => {
		const result = await createTestRuntime().buildFlowchart({
			spec: {
				title: "Retry with eventual exit",
				nodes: {
					start: "Start request",
					attempt: "Attempt operation",
					retry: "Succeeded?",
					done: "Complete request",
				},
				edges: [
					["start", "attempt"],
					["attempt", "retry"],
					["retry", "attempt", "retry"],
					["retry", "done", "yes"],
				],
			},
		});

		expectBuildOk(result);
	});

	it("rejects disconnected cycles from canonical start reachability", async () => {
		const result = await createTestRuntime().buildFlowchart({
			spec: {
				title: "Disconnected graph",
				nodes: {
					start: "Start request",
					done: "Complete request",
					"orphan-a": "Orphan alpha",
					"orphan-b": "Orphan beta",
				},
				edges: [
					["start", "done"],
					["orphan-a", "orphan-b"],
					["orphan-b", "orphan-a"],
				],
			},
		});

		expectBuildFailure(result);
		expect(
			result.issues
				.filter((issue) => issue.code === "unreachable_node")
				.map((issue) => issue.ref?.id),
		).toEqual(["orphan-a", "orphan-b"]);
	});

	it("rejects node and edge counts above the canonical limits", async () => {
		for (const spec of [
			linearFlowchartSpec(FLOWCHART_MAX_NODES + 1),
			denseAcyclicFlowchartSpec(FLOWCHART_MAX_EDGES + 1),
		]) {
			const result = await createTestRuntime().buildFlowchart({ spec });
			expectBuildFailure(result);
			expect(result.status).toBe("limit_exceeded");
			expect(result.issues).toContainEqual(
				expect.objectContaining({ code: "flowchart_too_large" }),
			);
		}
	});

	it("refuses two node ids that are one id once trimmed", async () => {
		const result = await createTestRuntime().buildFlowchart({
			spec: {
				title: "Trimmed ids",
				nodes: { a: "Start", " a ": "Start again", b: "Finish" },
				edges: [["a", "b"]],
			},
		});

		expectBuildFailure(result);
		expect(result.status).toBe("invalid_flowchart");
		expect(result.issues).toEqual([
			expect.objectContaining({
				code: "duplicate_node_id",
				ref: { kind: "node", id: "a", path: "spec.nodes. a " },
			}),
		]);
	});

	it("accepts a question with one stated way on", async () => {
		const result = await createTestRuntime().buildFlowchart({
			spec: {
				title: "Deploy check",
				nodes: { begin: "Begin", verify: "Verify deployment?", notify: "Notify team" },
				edges: [
					["begin", "verify"],
					["verify", "notify"],
				],
			},
		});

		expect(result).toMatchObject({ ok: true, status: "accepted" });
	});

	it("counts list-ended edges before expanding them", async () => {
		const ids = (prefix: string) => Array.from({ length: 300 }, (_, index) => `${prefix}${index}`);
		const result = await createTestRuntime().buildFlowchart({
			spec: {
				title: "Fan out",
				nodes: { a: "Start", b: "Finish" },
				edges: [[ids("from"), ids("to")]],
			},
		});

		expectBuildFailure(result);
		expect(result.status).toBe("limit_exceeded");
		// Only the count: no pair was expanded to report its unknown ends.
		expect(result.issues).toEqual([
			expect.objectContaining({
				code: "flowchart_too_large",
				message: "Flowchart draws 90000 edges; the supported maximum is 120.",
			}),
		]);
	});

	it("fails semantic limits before rendering or persisting artifacts", async () => {
		let renderCalls = 0;
		let writeCalls = 0;
		const store: CodeModeArtifactStorageShape = {
			read: () => Effect.succeed(null),
			readManifest: () => Effect.succeed(null),
			write: () => {
				writeCalls += 1;
				return Effect.fail(
					new CodeModeArtifactStorageError({
						cause: new Error("invalid flowchart must not persist"),
						message: "invalid flowchart must not persist",
						operation: "write",
					}),
				);
			},
		};
		const runtime = makeTestRuntime({
			store,
			renderer: {
				renderPng: () =>
					Effect.sync(() => {
						renderCalls += 1;
						return new Uint8Array([137, 80, 78, 71]);
					}),
			},
		});
		const result = await runtime.buildFlowchart({
			spec: linearFlowchartSpec(FLOWCHART_MAX_NODES + 1),
			options: { artifactFormats: ["png"] },
		});

		expectBuildFailure(result);
		expect(result.status).toBe("limit_exceeded");
		expect(renderCalls).toBe(0);
		expect(writeCalls).toBe(0);
	});

	it("caps canonical flowchart issue output deterministically", async () => {
		const spec = {
			title: "Bounded issue output",
			nodes: {
				start: "Start request",
				done: "Complete request",
				...Object.fromEntries(
					Array.from({ length: FLOWCHART_MAX_NODES - 2 }, (_, index) => [
						`orphan-${index}`,
						`Orphan operation ${index}`,
					]),
				),
			},
			edges: [["start", "done"]],
		};
		const first = await createTestRuntime().buildFlowchart({ spec });
		const second = await createTestRuntime().buildFlowchart({ spec });
		expectBuildFailure(first);
		expectBuildFailure(second);

		expect(first.issues).toHaveLength(FLOWCHART_MAX_ISSUES);
		expect(second.issues).toEqual(first.issues);
	});

	it("returns structured repair issues for invalid connectivity", async () => {
		const runtime = createTestRuntime();
		const built = await runtime.buildFlowchart({
			spec: {
				...approvalSpec(),
				edges: [
					["request", "approve"],
					["approve", "done"],
					["approve", "revise", "no"],
					["approve", "ghost", "maybe"],
				],
			},
		});

		expectBuildFailure(built);
		expect(built.status).toBe("invalid_flowchart");
		expect(built.issues).toContainEqual(
			expect.objectContaining({
				code: "missing_edge_target",
				ref: expect.objectContaining({ path: "spec.edges[3][1]" }),
			}),
		);
		expect(built.issues).toContainEqual(
			expect.objectContaining({
				code: "unlabeled_decision_branch",
				ref: expect.objectContaining({ id: "approve->done" }),
			}),
		);
	});

	it("returns invalid input issues for malformed artifact requests", async () => {
		const runtime = createTestRuntime();
		const result = await runtime.getArtifact({
			artifactId: "",
			format: "svg",
		});

		expect(result.ok).toBe(false);
		if (result.ok) {
			throw new Error("Expected get failure.");
		}
		expect(result.status).toBe("invalid_input");
		expect(result.issues).toContainEqual(expect.objectContaining({ stage: "input" }));
	});

	it("reports PNG export failure when no hosted renderer is configured", async () => {
		const runtime = createTestRuntime();
		const result = await runtime.buildFlowchart({
			spec: approvalSpec(),
			options: { artifactFormats: ["png"] },
		});

		expectBuildFailure(result);
		expect(result.status).toBe("export_failed");
		expect(result.issues).toContainEqual(
			expect.objectContaining({
				code: "render_failed",
				message: "PNG artifact rendering is not configured for this runtime.",
			}),
		);
	});

	it("stores PNG artifacts through a configured renderer without inlining binary data", async () => {
		let id = 0;
		const runtime = makeTestRuntime({
			store: makeMemoryArtifactStorage(),
			createId: (prefix) => `${prefix}-${(id += 1)}`,
			renderer: {
				renderPng: () => Effect.succeed(new Uint8Array([137, 80, 78, 71])),
			},
		});

		const built = await runtime.buildFlowchart({
			spec: approvalSpec(),
			options: {
				artifactFormats: ["scene", "png"],
				inlineArtifacts: ["scene"],
			},
		});

		expectBuildOk(built);
		expect(built.artifact.formats).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					format: "scene",
					inline: expect.any(Object),
				}),
				expect.objectContaining({
					format: "png",
					mimeType: "image/png",
					sizeBytes: 4,
				}),
			]),
		);
		expect(built.artifact.formats.find((format) => format.format === "png")).not.toHaveProperty(
			"inline",
		);

		const png = await runtime.getArtifact({
			artifactId: built.artifact.artifactId,
			format: "png",
		});

		expectGetOk(png);
		expect(png).toMatchObject({
			format: "png",
			mimeType: "image/png",
			sizeBytes: 4,
		});
		expect(png).not.toHaveProperty("inline");

		const explicitInlinePng = await runtime.getArtifact({
			artifactId: built.artifact.artifactId,
			format: "png",
			inline: true,
		});

		expectGetOk(explicitInlinePng);
		expect(explicitInlinePng).toMatchObject({
			format: "png",
			mimeType: "image/png",
			sizeBytes: 4,
		});
		expect(explicitInlinePng).not.toHaveProperty("inline");
	});

	it("rejects raw Excalidraw patch sources at the request contract", async () => {
		const runtime = createTestRuntime();
		const result = await runtime.applyDiagramPatch({
			source: { excalidraw: { appState: {}, elements: [] } },
			operations: [{ op: "rerouteEdges" }],
		});

		expectPatchFailure(result);
		expect(result.status).toBe("invalid_input");
		expect(result.issues).toContainEqual(
			expect.objectContaining({
				ref: expect.objectContaining({ path: "source" }),
			}),
		);
	});

	it("patches styling after the graph artifact is accepted", async () => {
		const runtime = createTestRuntime();
		const built = await approvalCanvas(runtime);
		expectCanvasOk(built);

		const patched = await runtime.applyDiagramPatch({
			source: { artifactId: built.artifact.artifactId },
			intent: "Make the approval decision purple after connectivity is accepted.",
			operations: [
				{
					op: "setStyle",
					selector: { nodeIds: ["approve"] },
					style: { strokeColor: "#7c3aed", fillColor: "#ede9fe" },
				},
				{
					op: "setShape",
					selector: { nodeIds: ["approve"] },
					shape: "diamond",
				},
			],
			options: { inlineArtifacts: ["scene"] },
		});

		expectPatchOk(patched);
		expect(patched.sourceArtifactId).toBe(built.artifact.artifactId);

		const patchedScene = patched.artifact.formats.find(
			(format) => format.format === "scene",
		)?.inline;
		const scene = parseInlineScene(patchedScene);
		const approvalNode = scene.elements.find(
			(element) => element.type === "node" && element.nodeId === "approve",
		);

		expect(approvalNode).toMatchObject({
			shape: "diamond",
			strokeColor: "#7c3aed",
			fillColor: "#ede9fe",
		});
		expect(
			scene.elements
				.filter((element) => element.type === "arrow")
				.map((arrow) => `${arrow.sourceNodeId}->${arrow.targetNodeId}`)
				.sort(),
		).toEqual(["approve->done", "approve->revise", "request->approve"]);
	});

	it("renders PNG artifacts after patch operations when a renderer is configured", async () => {
		let id = 0;
		const runtime = makeTestRuntime({
			store: makeMemoryArtifactStorage(),
			createId: (prefix) => `${prefix}-${(id += 1)}`,
			renderer: {
				renderPng: ({ scene }) =>
					Effect.succeed(new Uint8Array([137, 80, 78, 71, scene.elements.length])),
			},
		});
		const built = await approvalCanvas(runtime);
		expectCanvasOk(built);

		const patched = await runtime.applyDiagramPatch({
			source: { artifactId: built.artifact.artifactId },
			operations: [
				{
					op: "setShape",
					selector: { nodeIds: ["approve"] },
					shape: "diamond",
				},
			],
			options: {
				artifactFormats: ["scene", "png"],
				inlineArtifacts: ["scene"],
			},
		});

		expectPatchOk(patched);
		expect(patched.artifact.formats).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					format: "scene",
					inline: expect.any(Object),
				}),
				expect.objectContaining({
					format: "png",
					mimeType: "image/png",
					sizeBytes: 5,
				}),
			]),
		);
		expect(patched.artifact.formats.find((format) => format.format === "png")).not.toHaveProperty(
			"inline",
		);
	});

	it("keeps patch provenance consistent across the result and later format retrieval", async () => {
		let id = 0;
		const runtime = makeTestRuntime({
			store: makeMemoryArtifactStorage(),
			createId: (prefix) => `${prefix}-${(id += 1)}`,
			renderer: {
				renderPng: () => Effect.succeed(new Uint8Array([137, 80, 78, 71])),
			},
		});
		const built = await approvalCanvas(runtime);
		expectCanvasOk(built);

		expect(built.artifact).not.toHaveProperty("provenance");
		const rootScene = await runtime.getArtifact({
			artifactId: built.artifact.artifactId,
			format: "scene",
			inline: true,
		});
		expectGetOk(rootScene);
		expect(rootScene).not.toHaveProperty("provenance");

		const patched = await runtime.applyDiagramPatch({
			source: { artifactId: built.artifact.artifactId },
			operations: [
				{
					op: "setShape",
					selector: { nodeIds: ["approve"] },
					shape: "diamond",
				},
			],
			options: {
				artifactFormats: ["scene", "excalidraw", "png"],
				inlineArtifacts: ["scene"],
			},
		});
		expectPatchOk(patched);

		const provenance = {
			sourceArtifactId: built.artifact.artifactId,
		};
		expect(patched.sourceArtifactId).toBe(provenance.sourceArtifactId);
		expect(patched.artifact.provenance).toEqual(provenance);
		if (!patched.artifact.provenance) {
			throw new Error("Expected the patched artifact to include provenance.");
		}
		patched.artifact.provenance.sourceArtifactId = "artifact-mutated";

		const formats: ArtifactFormat[] = ["scene", "excalidraw", "png"];
		for (const format of formats) {
			const retrieved = await runtime.getArtifact({
				artifactId: patched.artifact.artifactId,
				format,
			});
			expectGetOk(retrieved);
			expect(retrieved.provenance).toEqual(provenance);
		}
	});

	it("keeps scoped edge style patches from recoloring node labels", async () => {
		const runtime = createTestRuntime();
		const built = await approvalCanvas(runtime);
		expectCanvasOk(built);

		const patched = await runtime.applyDiagramPatch({
			source: { artifactId: built.artifact.artifactId },
			operations: [
				{
					op: "setStyle",
					selector: { scope: "edges" },
					style: { strokeColor: "#7c3aed", textColor: "#7c3aed" },
				},
			],
			options: { inlineArtifacts: ["scene"] },
		});

		expectPatchOk(patched);
		const scene = parseInlineScene(
			patched.artifact.formats.find((format) => format.format === "scene")?.inline,
		);

		expect(
			scene.elements
				.filter((element) => element.type === "text")
				.filter((text) => text.containerId)
				.map((text) => text.textColor),
		).toEqual([undefined, undefined, undefined, undefined]);
		expect(
			scene.elements
				.filter((element) => element.type === "arrow")
				.map((arrow) => arrow.strokeColor),
		).toEqual(["#7c3aed", "#7c3aed", "#7c3aed"]);
	});

	it("keeps positioned branch labels associated through edge patches", async () => {
		const runtime = createTestRuntime();
		const built = await approvalCanvas(runtime, ["scene"]);
		expectCanvasOk(built);
		const patched = await runtime.applyDiagramPatch({
			source: { artifactId: built.artifact.artifactId },
			operations: [
				{
					op: "ungroup",
					ids: parseInlineScene(
						built.artifact.formats.find((format) => format.format === "scene")?.inline,
					).elements.map((e) => e.id),
				},
				{ op: "replaceText", selector: { labels: ["yes"], scope: "edges" }, text: "Approved" },
				{ op: "setStyle", selector: { scope: "edges" }, style: { textColor: "#7c3aed" } },
			],
			options: { inlineArtifacts: ["scene"] },
		});
		expectPatchOk(patched);
		const scene = parseInlineScene(
			patched.artifact.formats.find((format) => format.format === "scene")?.inline,
		);
		const arrow = scene.elements.find((e) => e.type === "arrow" && e.label === "Approved");
		expect(arrow).toBeDefined();
		expect(scene.elements.find((e) => e.id === `${arrow?.id}:label`)).toMatchObject({
			text: "Approved",
			textColor: "#7c3aed",
		});
		const removed = await runtime.applyDiagramPatch({
			source: { scene },
			operations: [{ op: "remove", selector: { ids: [arrow!.id] } }],
			options: { inlineArtifacts: ["scene"], preserveConnectivity: false },
		});
		expectPatchOk(removed);
		const remaining = parseInlineScene(
			removed.artifact.formats.find((format) => format.format === "scene")?.inline,
		);
		expect(remaining.elements.some((e) => e.id === `${arrow!.id}:label`)).toBe(false);
	});

	it("rejects patch selectors that do not match the accepted artifact", async () => {
		const runtime = createTestRuntime();
		const built = await approvalCanvas(runtime);
		expectCanvasOk(built);

		const patched = await runtime.applyDiagramPatch({
			source: { artifactId: built.artifact.artifactId },
			operations: [
				{
					op: "setStyle",
					selector: { nodeIds: ["missing-node"] },
					style: { strokeColor: "#7c3aed" },
				},
			],
		});

		expectPatchFailure(patched);
		expect(patched.status).toBe("target_not_found");
		expect(patched.issues).toContainEqual(
			expect.objectContaining({ code: "unknown_patch_target" }),
		);
	});

	it("enumerates supported patch operations when the op name is invalid", async () => {
		const runtime = createTestRuntime();
		const built = await runtime.buildFlowchart({ spec: approvalSpec() });
		expectBuildOk(built);

		const patched = await runtime.applyDiagramPatch({
			source: { artifactId: built.artifact.artifactId },
			operations: [
				{
					op: "setText",
					selector: { nodeIds: ["done"] },
					text: "Ship to production",
				},
			],
		});

		expectPatchFailure(patched);
		expect(patched.status).toBe("invalid_input");
		expect(patched.issues).toContainEqual(
			expect.objectContaining({
				code: "unsupported_patch_operation",
				ref: { kind: "request", path: "operations.[0].op" },
				hint: expect.stringContaining("replaceText"),
			}),
		);
	});

	it("uses replaceText to update accepted node labels", async () => {
		const runtime = createTestRuntime();
		const built = await approvalCanvas(runtime);
		expectCanvasOk(built);

		const patched = await runtime.applyDiagramPatch({
			source: { artifactId: built.artifact.artifactId },
			operations: [
				{
					op: "replaceText",
					selector: { nodeIds: ["done"] },
					text: "Ship to production",
				},
			],
			options: { inlineArtifacts: ["scene"] },
		});

		expectPatchOk(patched);
		const scene = parseInlineScene(
			patched.artifact.formats.find((format) => format.format === "scene")?.inline,
		);

		expect(scene.elements).toContainEqual(
			expect.objectContaining({
				type: "node",
				nodeId: "done",
				label: "Ship to production",
			}),
		);
		expect(scene.elements).toContainEqual(
			expect.objectContaining({
				type: "text",
				containerId: expect.stringContaining("done"),
				text: "Ship to production",
			}),
		);
	});

	it("returns structured storage failures when artifact reads throw", async () => {
		const runtime = makeTestRuntime({
			store: throwingStore(),
			createId: (prefix) => `${prefix}-1`,
		});

		const artifact = await runtime.getArtifact({
			artifactId: "artifact-1",
			format: "scene",
		});

		expect(artifact.ok).toBe(false);
		if (artifact.ok) {
			throw new Error("Expected get failure.");
		}
		expect(artifact.status).toBe("storage_failed");
		expect(artifact.issues).toContainEqual(
			expect.objectContaining({
				code: "storage_read_failed",
				message: "manifest read failed",
			}),
		);

		const patched = await runtime.applyDiagramPatch({
			source: { artifactId: "artifact-1" },
			operations: [{ op: "rerouteEdges" }],
		});

		expectPatchFailure(patched);
		expect(patched.status).toBe("storage_failed");
		expect(patched.issues).toContainEqual(
			expect.objectContaining({
				code: "storage_read_failed",
				message: "manifest read failed",
			}),
		);
	});

	it("stores and retrieves artifacts through an object-bucket adapter", async () => {
		const bucket = new MemoryBucket();
		let id = 0;
		const runtime = makeTestRuntime({
			store: makeObjectBucketArtifactStorage(bucket, {
				prefix: "codemode",
			}),
			createId: (prefix) => `${prefix}-${(id += 1)}`,
		});

		const built = await runtime.buildFlowchart({ spec: approvalSpec() });
		expectBuildOk(built);

		expect([...bucket.objects.keys()].sort()).toEqual([
			"codemode/artifact-2/document.json",
			"codemode/artifact-2/excalidraw.json",
			"codemode/artifact-2/manifest.json",
			"codemode/artifact-2/scene.json",
		]);

		const scene = await runtime.getArtifact({
			artifactId: built.artifact.artifactId,
			format: "scene",
			inline: true,
		});

		expectGetOk(scene);
		expect(parseInlineScene(scene.inline).diagramId).toBe("simple-approval-flow");
	});

	it("rejects an object-store scene whose source manifest was not published", async () => {
		const sourceRuntime = createTestRuntime();
		const built = await sourceRuntime.buildFlowchart({
			spec: approvalSpec(),
			options: { inlineArtifacts: ["scene"] },
		});
		expectBuildOk(built);
		const sourceScene = parseInlineScene(
			built.artifact.formats.find((format) => format.format === "scene")?.inline,
		);

		const bucket = new MemoryBucket();
		await bucket.put("codemode/artifact-partial/scene.json", JSON.stringify(sourceScene));
		let id = 0;
		const runtime = makeTestRuntime({
			store: makeObjectBucketArtifactStorage(bucket, { prefix: "codemode" }),
			createId: (prefix) => `${prefix}-${(id += 1)}`,
		});

		const patched = await runtime.applyDiagramPatch({
			source: { artifactId: "artifact-partial" },
			operations: [{ op: "rerouteEdges" }],
		});

		expectPatchFailure(patched);
		expect(patched.status).toBe("source_unavailable");
		expect(patched.issues).toContainEqual(
			expect.objectContaining({
				code: "patch_source_unavailable",
				message: expect.stringContaining("valid source manifest"),
			}),
		);
		expect([...bucket.objects.keys()]).toEqual(["codemode/artifact-partial/scene.json"]);
	});

	it("persists PNG artifacts as binary object-bucket entries", async () => {
		const bucket = new MemoryBucket();
		let id = 0;
		const runtime = makeTestRuntime({
			store: makeObjectBucketArtifactStorage(bucket, {
				prefix: "codemode",
			}),
			createId: (prefix) => `${prefix}-${(id += 1)}`,
			renderer: {
				renderPng: () => Effect.succeed(new Uint8Array([137, 80, 78, 71])),
			},
		});

		const built = await runtime.buildFlowchart({
			spec: approvalSpec(),
			options: { artifactFormats: ["scene", "png"] },
		});
		expectBuildOk(built);

		expect([...bucket.objects.keys()].sort()).toEqual([
			"codemode/artifact-2/document.json",
			"codemode/artifact-2/manifest.json",
			"codemode/artifact-2/png.png",
			"codemode/artifact-2/scene.json",
		]);

		const png = await runtime.getArtifact({
			artifactId: built.artifact.artifactId,
			format: "png",
		});

		expectGetOk(png);
		expect(png).toMatchObject({
			format: "png",
			mimeType: "image/png",
			sizeBytes: 4,
		});
		expect(png).not.toHaveProperty("inline");
	});

	it("fails the build without exposing the artifact id when a format write fails", async () => {
		const bucket = new FailingPngBucket();
		let id = 0;
		const runtime = makeTestRuntime({
			store: makeObjectBucketArtifactStorage(bucket, {
				prefix: "codemode",
			}),
			createId: (prefix) => `${prefix}-${(id += 1)}`,
			renderer: {
				renderPng: () => Effect.succeed(new Uint8Array([137, 80, 78, 71])),
			},
		});

		const built = await runtime.buildFlowchart({
			spec: approvalSpec(),
			options: { artifactFormats: ["scene", "png"] },
		});

		expectBuildFailure(built);
		expect(built.status).toBe("storage_failed");
		expect(bucket.objects.has("codemode/artifact-2/png.png")).toBe(false);
		// The manifest goes up with its formats, so it can land beside a failed
		// format; the id never reaches a caller, so no reader can resolve it.
		expect(JSON.stringify(built)).not.toContain("artifact-2");
	});

	it("builds a native sequence scene and exports every requested artifact", async () => {
		const runtime = makeTestRuntime({
			renderer: {
				renderPng: () => Effect.succeed(new Uint8Array([137, 80, 78, 71])),
			},
		});
		const result = await runtime.buildSequenceDiagram({
			spec: checkoutSequenceSpec(),
			options: {
				artifactFormats: ["scene", "excalidraw", "png"],
				inlineArtifacts: ["excalidraw"],
			},
		});

		expect(result.issues).toEqual([]);
		expect(result).toMatchObject({ ok: true, status: "accepted" });
		if (!result.ok) throw new Error("Expected accepted sequence diagram.");
		expect(result.normalizedSpec.participants.map(({ id }) => id)).toEqual([
			"customer",
			"store",
			"payments",
		]);
		expect(result.normalizedSpec.messages.map(({ label }) => label)).toEqual([
			"Checkout",
			"Authorize",
			"Approved",
		]);
		expect(result.artifact.formats.map(({ format }) => format)).toEqual([
			"scene",
			"excalidraw",
			"png",
		]);
		const excalidraw = result.artifact.formats.find(({ format }) => format === "excalidraw");
		expect(excalidraw).toHaveProperty("inline");
		expect(excalidraw?.inline).toMatchObject({
			elements: expect.arrayContaining([
				expect.objectContaining({
					id: "arrow:message-3-payments-customer",
					strokeStyle: "dashed",
				}),
			]),
		});
	});

	it("round-trips a crossing sequence through a no-op inline-scene patch", async () => {
		const runtime = createTestRuntime();
		const built = await runtime.buildSequenceDiagram({
			spec: crossingSequenceSpec(),
			options: {
				artifactFormats: ["scene", "excalidraw"],
				inlineArtifacts: ["scene"],
			},
		});
		expect(built.ok).toBe(true);
		if (!built.ok) throw new Error("Expected accepted sequence diagram.");
		const sourceScene = built.artifact.formats.find(({ format }) => format === "scene")?.inline;
		expect(sourceScene).toBeDefined();

		const patched = await runtime.applyDiagramPatch({
			source: { scene: sourceScene },
			operations: [{ op: "setDefaultStyle", style: {} }],
			options: {
				artifactFormats: ["scene", "excalidraw"],
				inlineArtifacts: ["scene", "excalidraw"],
			},
		});

		expectPatchOk(patched);
		expect(
			patched.artifact.formats.find(({ format }) => format === "excalidraw")?.inline,
		).toMatchObject({
			elements: expect.arrayContaining([expect.objectContaining({ id: "arrow:message-1-a-c" })]),
		});
	});

	it("keeps activation bars and their bound messages through an inline-scene patch", async () => {
		const runtime = createTestRuntime();
		const spec = checkoutSequenceSpec();
		const built = await runtime.buildSequenceDiagram({
			spec: {
				...spec,
				messages: [
					...spec.messages.slice(0, 2),
					{ source: "payments", target: "store", label: "Approved", type: "return" },
					{ source: "store", target: "customer", label: "Receipt", type: "return" },
				],
			},
			options: { artifactFormats: ["scene", "excalidraw"], inlineArtifacts: ["scene"] },
		});
		if (!built.ok) throw new Error("Expected accepted sequence diagram.");
		const sourceScene = parseInlineScene(
			built.artifact.formats.find(({ format }) => format === "scene")?.inline,
		);
		const bars = (scene: typeof sourceScene) =>
			scene.elements.flatMap((element) =>
				element.type === "node" && element.rendererRole === "sequence-activation"
					? [element.nodeId]
					: [],
			);
		expect(bars(sourceScene)).toEqual([
			"store:lifeline:activation:message-1-customer-store",
			"payments:lifeline:activation:message-2-store-payments",
		]);

		const patched = await runtime.applyDiagramPatch({
			source: { scene: sourceScene },
			operations: [{ op: "setDefaultStyle", style: {} }],
			options: { artifactFormats: ["scene", "excalidraw"], inlineArtifacts: ["scene"] },
		});
		expectPatchOk(patched);
		const patchedScene = parseInlineScene(
			patched.artifact.formats.find(({ format }) => format === "scene")?.inline,
		);
		expect(bars(patchedScene)).toEqual(bars(sourceScene));
		expect(
			patchedScene.elements.find(
				(element) => element.type === "arrow" && element.edgeId === "message-1-customer-store",
			),
		).toMatchObject({ targetNodeId: "store:lifeline:activation:message-1-customer-store" });
	});

	it("keeps doubly nested activation bars through an inline-scene patch", async () => {
		const runtime = createTestRuntime();
		const built = await runtime.buildSequenceDiagram({
			spec: {
				title: "Deep nesting",
				participants: [
					{ id: "a", label: "A" },
					{ id: "b", label: "B" },
					{ id: "c", label: "C" },
				],
				messages: [
					{ id: "q1", source: "a", target: "b", label: "First" },
					{ id: "q2", source: "c", target: "b", label: "Second" },
					{ id: "q3", source: "a", target: "b", label: "Third" },
					{ id: "r3", source: "b", target: "a", label: "Third done", type: "return" },
					{ id: "r2", source: "b", target: "c", label: "Second done", type: "return" },
					{ id: "r1", source: "b", target: "a", label: "First done", type: "return" },
				],
			},
			options: { artifactFormats: ["scene", "excalidraw"], inlineArtifacts: ["scene"] },
		});
		if (!built.ok) throw new Error("Expected accepted sequence diagram.");
		const sourceScene = parseInlineScene(
			built.artifact.formats.find(({ format }) => format === "scene")?.inline,
		);

		const patched = await runtime.applyDiagramPatch({
			source: { scene: sourceScene },
			operations: [{ op: "setDefaultStyle", style: {} }],
			options: { artifactFormats: ["scene", "excalidraw"], inlineArtifacts: ["scene"] },
		});
		expectPatchOk(patched);
		expect(patched.issues).toEqual([]);
		const patchedScene = parseInlineScene(
			patched.artifact.formats.find(({ format }) => format === "scene")?.inline,
		);
		expect(
			patchedScene.elements.flatMap((element) =>
				element.type === "node" && element.nodeId.includes(":activation:")
					? [[element.nodeId, element.rendererRole]]
					: [],
			),
		).toEqual([
			["b:lifeline:activation:q1", "sequence-activation"],
			["b:lifeline:activation:q2", "sequence-activation"],
			["b:lifeline:activation:q3", "sequence-activation"],
		]);
	});

	it("styles a crossing sequence through an inline-scene patch", async () => {
		const runtime = createTestRuntime();
		const built = await runtime.buildSequenceDiagram({
			spec: crossingSequenceSpec(),
			options: {
				artifactFormats: ["scene"],
				inlineArtifacts: ["scene"],
			},
		});
		expect(built.ok).toBe(true);
		if (!built.ok) throw new Error("Expected accepted sequence diagram.");
		const sourceScene = built.artifact.formats.find(({ format }) => format === "scene")?.inline;

		const patched = await runtime.applyDiagramPatch({
			source: { scene: sourceScene },
			operations: [
				{
					op: "setStyle",
					selector: { nodeIds: ["b"] },
					style: { fillColor: "#ede9fe", strokeColor: "#7c3aed" },
				},
			],
			options: {
				artifactFormats: ["scene", "excalidraw"],
				inlineArtifacts: ["scene", "excalidraw"],
			},
		});

		expectPatchOk(patched);
		const patchedScene = parseInlineScene(
			patched.artifact.formats.find(({ format }) => format === "scene")?.inline,
		);
		expect(
			patchedScene.elements.find((element) => element.type === "node" && element.nodeId === "b"),
		).toMatchObject({ fillColor: "#ede9fe", strokeColor: "#7c3aed" });
		expect(
			patched.artifact.formats.find(({ format }) => format === "excalidraw")?.inline,
		).toMatchObject({ elements: expect.any(Array) });
	});

	it("preserves crossing-sequence lifeline roles after a fractional translate patch", async () => {
		const runtime = createTestRuntime();
		const built = await runtime.buildSequenceDiagram({
			spec: crossingSequenceSpec(),
			options: {
				artifactFormats: ["scene"],
				inlineArtifacts: ["scene"],
			},
		});
		expect(built.ok).toBe(true);
		if (!built.ok) throw new Error("Expected accepted sequence diagram.");
		const sourceScene = built.artifact.formats.find(({ format }) => format === "scene")?.inline;

		const patched = await runtime.applyDiagramPatch({
			source: { scene: sourceScene },
			operations: [
				{
					op: "translate",
					selector: { nodeIds: ["b:lifeline"] },
					dx: 0.0003,
					dy: -0.0003,
				},
			],
			options: {
				artifactFormats: ["scene", "excalidraw"],
				inlineArtifacts: ["scene", "excalidraw"],
			},
		});

		expectPatchOk(patched);
		const patchedScene = parseInlineScene(
			patched.artifact.formats.find(({ format }) => format === "scene")?.inline,
		);
		expect(
			patchedScene.elements.find(
				(element) => element.type === "node" && element.nodeId === "b:lifeline",
			),
		).toMatchObject({ rendererRole: "sequence-lifeline" });
		expect(
			patched.artifact.formats.find(({ format }) => format === "excalidraw")?.inline,
		).toMatchObject({
			elements: expect.arrayContaining([expect.objectContaining({ id: "arrow:message-1-a-c" })]),
		});
	});

	it("keeps chart marks unlabeled through a patch", async () => {
		const scene = renderChartDiagram(
			parseChartDiagram({
				id: "revenue",
				title: "Revenue",
				type: "chart",
				kind: "bar",
				categories: ["Q1", "Q2"],
				series: [{ name: "Revenue with a long series name", values: [4, 0.1] }],
			}),
		);
		const result = await createTestRuntime().applyDiagramPatch({
			source: { scene },
			operations: [
				{
					op: "setStyle",
					selector: { nodeIds: ["chart:bar:0:0"] },
					style: { fillColor: "#e34948" },
				},
			],
			options: {
				artifactFormats: ["scene", "excalidraw"],
				inlineArtifacts: ["scene", "excalidraw"],
			},
		});

		expectPatchOk(result);
		const patched = parseInlineScene(
			result.artifact.formats.find(({ format }) => format === "scene")?.inline,
		);
		const bars = patched.elements.filter(
			(element) => element.type === "node" && element.nodeId.startsWith("chart:bar:"),
		);
		expect(bars).toHaveLength(2);
		for (const bar of bars) expect(bar).toMatchObject({ rendererRole: "chart-mark" });
		expect(bars[0]).toMatchObject({ fillColor: "#e34948" });
		expect(
			JSON.stringify(result.artifact.formats.find(({ format }) => format === "excalidraw")?.inline),
		).not.toContain("__sketchi_node_label__");
	});

	it("strips a spoofed lifeline role from an ordinary inline node", async () => {
		const result = await createTestRuntime().applyDiagramPatch({
			source: {
				scene: spoofedInlineLifelineScene({ useLifelineId: false }),
			},
			operations: [{ op: "setDefaultStyle", style: {} }],
			options: {
				artifactFormats: ["excalidraw"],
				inlineArtifacts: ["excalidraw"],
			},
		});

		expectPatchOk(result);
		expect(JSON.stringify(result.artifact.formats[0]?.inline)).not.toContain("sketchiRendererRole");
	});

	it("does not trust a lifeline-style id without lifeline geometry", async () => {
		const result = await createTestRuntime().applyDiagramPatch({
			source: {
				scene: spoofedInlineLifelineScene({ useLifelineId: true }),
			},
			operations: [{ op: "setDefaultStyle", style: {} }],
			options: {
				artifactFormats: ["excalidraw"],
				inlineArtifacts: ["excalidraw"],
			},
		});

		expectPatchOk(result);
		expect(JSON.stringify(result.artifact.formats[0]?.inline)).not.toContain("sketchiRendererRole");
	});

	it("ignores renderer-owned lifeline roles in build specifications", async () => {
		const runtime = createTestRuntime();
		const flowchartSpec = approvalSpec();
		const flowchart = await runtime.buildFlowchart({
			spec: {
				...flowchartSpec,
				nodes: {
					...flowchartSpec.nodes,
					request: { label: flowchartSpec.nodes.request, rendererRole: "sequence-lifeline" },
				},
			},
			options: { artifactFormats: ["scene"], inlineArtifacts: ["scene"] },
		});
		expectBuildOk(flowchart);
		const flowchartScene = parseInlineScene(
			flowchart.artifact.formats.find(({ format }) => format === "scene")?.inline,
		);
		expect(
			flowchartScene.elements.find(
				(element) => element.type === "node" && element.nodeId === "request",
			),
		).not.toHaveProperty("rendererRole");

		const sequenceSpec = crossingSequenceSpec();
		const sequence = await runtime.buildSequenceDiagram({
			spec: {
				...sequenceSpec,
				participants: sequenceSpec.participants.map((participant, index) =>
					index === 1 ? { ...participant, rendererRole: "sequence-lifeline" } : participant,
				),
			},
			options: { artifactFormats: ["scene"], inlineArtifacts: ["scene"] },
		});
		expect(sequence.ok).toBe(true);
		if (!sequence.ok) throw new Error("Expected accepted sequence diagram.");
		const sequenceScene = parseInlineScene(
			sequence.artifact.formats.find(({ format }) => format === "scene")?.inline,
		);
		expect(
			sequenceScene.elements.find((element) => element.type === "node" && element.nodeId === "b"),
		).not.toHaveProperty("rendererRole");
		expect(
			sequenceScene.elements.filter(
				(element) => element.type === "node" && element.rendererRole === "sequence-lifeline",
			),
		).toHaveLength(3);
	});

	it("returns repairable issues for invalid participant references", async () => {
		const spec = checkoutSequenceSpec();
		const result = await createTestRuntime().buildSequenceDiagram({
			spec: {
				...spec,
				messages: [{ source: "missing", target: "store", label: "Unknown sender" }],
			},
		});

		expect(result).toMatchObject({
			ok: false,
			status: "invalid_sequence",
			issues: [
				expect.objectContaining({
					code: "missing_edge_source",
					ref: { kind: "request", path: "spec.messages.[0].source" },
					message: 'Message source "missing" is not a participant.',
					// Published Code Mode wording names the request field.
					hint: "Use the id of a participant declared in spec.participants.",
				}),
			],
		});
	});

	it("builds a self-message as a loop on its participant's lifeline", async () => {
		const spec = checkoutSequenceSpec();
		const result = await createTestRuntime().buildSequenceDiagram({
			spec: {
				...spec,
				messages: [
					...spec.messages,
					{ source: "store", target: "store", label: "Recalculate totals" },
				],
			},
		});

		expect(result).toMatchObject({ ok: true });
	});

	it("rejects oversized sequence diagrams with sequence_too_large", async () => {
		const result = await createTestRuntime().buildSequenceDiagram({
			spec: {
				title: "Too many participants",
				participants: Array.from({ length: 13 }, (_, index) => ({
					id: `p${index}`,
					label: `Participant ${index}`,
				})),
				messages: [{ source: "p0", target: "p1", label: "Hello" }],
			},
		});
		expect(result).toMatchObject({
			ok: false,
			status: "invalid_sequence",
			issues: [
				expect.objectContaining({
					code: "sequence_too_large",
					ref: { kind: "request", path: "spec.participants" },
				}),
			],
		});
	});

	it("returns a repairable issue for participant ids that collide with lifelines", async () => {
		const result = await createTestRuntime().buildSequenceDiagram({
			spec: {
				title: "Colliding participants",
				participants: [
					{ id: "api", label: "API" },
					{ id: "api:lifeline", label: "Worker" },
				],
				messages: [],
			},
		});

		expect(result).toMatchObject({
			ok: false,
			status: "invalid_sequence",
			issues: [
				expect.objectContaining({
					code: "duplicate_node_id",
					ref: { kind: "request", path: "spec.participants.[1].id" },
					hint: expect.stringContaining("Rename the participant"),
				}),
			],
		});
	});

	it("returns structured input issues for malformed sequence messages", async () => {
		const spec = checkoutSequenceSpec();
		const result = await createTestRuntime().buildSequenceDiagram({
			spec: {
				...spec,
				messages: [{ source: "customer", target: "store" }],
			},
		});

		expect(result).toMatchObject({
			ok: false,
			status: "invalid_input",
			issues: [
				expect.objectContaining({
					code: "invalid_type",
					ref: { kind: "request", path: expect.stringContaining("label") },
					hint: expect.any(String),
				}),
			],
		});
	});

	it("creates, renders, and persists a composed CanvasSpec artifact bundle", async () => {
		let id = 0;
		const runtime = makeTestRuntime({
			store: makeMemoryArtifactStorage(),
			createId: (prefix) => `${prefix}-${(id += 1)}`,
			renderer: {
				renderPng: () => Effect.succeed(new Uint8Array([137, 80, 78, 71])),
			},
		});
		const result = await runtime.createCanvas({
			requestId: "canvas-request",
			spec: {
				kind: "canvas",
				version: 1,
				diagramId: "universal-canvas",
				title: "Universal canvas",
				width: 900,
				height: 500,
				accentColor: "#1f2937",
				backgroundColor: "#ffffff",
				layers: [
					{ id: "background", name: "Background" },
					{ id: "content", name: "Content" },
				],
				elements: [
					{
						type: "frame",
						id: "frame",
						name: "System",
						x: 40,
						y: 40,
						width: 780,
						height: 360,
						layerId: "background",
					},
					{
						type: "node",
						id: "source",
						nodeId: "source",
						shape: "polygon",
						points: [
							{ x: 0, y: 50 },
							{ x: 50, y: 0 },
							{ x: 100, y: 50 },
							{ x: 50, y: 100 },
						],
						x: 100,
						y: 140,
						width: 100,
						height: 100,
						label: "Source",
						frameId: "frame",
						groupIds: ["pipeline"],
						layerId: "content",
					},
					{
						type: "node",
						id: "target",
						nodeId: "target",
						shape: "rectangle",
						x: 520,
						y: 140,
						width: 180,
						height: 100,
						label: "Target",
						frameId: "frame",
						groupIds: ["pipeline"],
						layerId: "content",
					},
					{
						type: "arrow",
						id: "connector",
						edgeId: "connector",
						sourceNodeId: "source",
						targetNodeId: "target",
						points: [
							{ x: 200, y: 190 },
							{ x: 520, y: 190 },
						],
						startArrowhead: "circle",
						endArrowhead: "triangle",
						label: "typed",
						layerId: "content",
					},
					{
						type: "line",
						id: "baseline",
						points: [
							{ x: 80, y: 310 },
							{ x: 740, y: 310 },
						],
						strokeStyle: "dashed",
						layerId: "content",
					},
					{
						type: "text",
						id: "caption",
						text: "Renderer-independent scene",
						x: 300,
						y: 330,
						fontSize: 24,
						textAlign: "center",
						layerId: "content",
					},
				],
				layouts: [
					{
						type: "row",
						ids: ["source", "target"],
						x: 100,
						y: 140,
						gap: 320,
					},
				],
				zOrder: ["frame", "baseline", "source", "target", "connector", "caption"],
			},
			options: {
				artifactFormats: ["scene", "excalidraw", "png"],
				inlineArtifacts: ["scene", "excalidraw"],
			},
		});

		expectCanvasOk(result);
		expect(result.requestId).toBe("canvas-request");
		expect(result.artifact.formats.map((format) => format.format)).toEqual([
			"scene",
			"excalidraw",
			"png",
		]);
		expect(result.normalizedSpec.elements).toHaveLength(6);
		expect(result.normalizedSpec.zOrder[0]).toBe("frame");
	});

	it("rejects an empty CanvasSpec as a typed invalid canvas", async () => {
		const result = await createTestRuntime().createCanvas({
			spec: {
				kind: "canvas",
				version: 1,
				diagramId: "empty-canvas",
				title: "Empty canvas",
				width: 400,
				height: 300,
				accentColor: "#111827",
				backgroundColor: "#ffffff",
				elements: [],
				layers: [],
				layouts: [],
				zOrder: [],
			},
		});

		expect(result).toMatchObject({
			ok: false,
			status: "invalid_canvas",
			issues: [
				expect.objectContaining({
					code: "invalid_canvas_geometry",
					stage: "canvas",
					ref: { kind: "diagram", path: "elements" },
				}),
			],
		});
	});

	it("accepts a dense 120-element CanvasSpec and applies deterministic grid layout", async () => {
		const elements = Array.from({ length: 120 }, (_, index) => ({
			type: "node",
			id: `cell-${index}`,
			nodeId: `cell-${index}`,
			shape: "rectangle",
			x: 0,
			y: 0,
			width: 80,
			height: 40,
			label: `Cell ${index}`,
		}));
		const result = await createTestRuntime().createCanvas({
			spec: {
				kind: "canvas",
				version: 1,
				diagramId: "dense-120",
				title: "Dense matrix",
				width: 1200,
				height: 800,
				accentColor: "#111827",
				backgroundColor: "#ffffff",
				elements,
				layers: [],
				layouts: [
					{
						type: "grid",
						ids: elements.map((element) => element.id),
						columns: 12,
						x: 20,
						y: 20,
						columnGap: 10,
						rowGap: 10,
					},
				],
				zOrder: elements.map((element) => element.id),
			},
			options: { artifactFormats: ["scene"], inlineArtifacts: ["scene"] },
		});

		expectCanvasOk(result);
		expect(result.normalizedSpec.elements).toHaveLength(120);
		expect(result.normalizedSpec.elements[119]).toMatchObject({
			x: 1010,
			y: 470,
		});
	});

	it("supports stable structural canvas patches", async () => {
		const runtime = createTestRuntime();
		const built = await runtime.createCanvas({
			spec: {
				kind: "canvas",
				version: 1,
				diagramId: "patchable-canvas",
				title: "Patchable canvas",
				width: 600,
				height: 300,
				accentColor: "#111827",
				backgroundColor: "#ffffff",
				elements: [
					{
						type: "node",
						id: "a",
						nodeId: "a",
						shape: "rectangle",
						x: 20,
						y: 20,
						width: 120,
						height: 60,
						label: "A",
					},
					{
						type: "node",
						id: "b",
						nodeId: "b",
						shape: "rectangle",
						x: 220,
						y: 20,
						width: 120,
						height: 60,
						label: "B",
					},
				],
				layers: [],
				layouts: [],
				zOrder: ["a", "b"],
			},
			options: { artifactFormats: ["scene"] },
		});
		expectCanvasOk(built);

		const patched = await runtime.applyDiagramPatch({
			source: { artifactId: built.artifact.artifactId },
			options: {
				preserveConnectivity: false,
				artifactFormats: ["scene"],
				inlineArtifacts: ["scene"],
			},
			operations: [
				{
					op: "insert",
					afterId: "a",
					elements: [
						{
							type: "node",
							id: "c",
							nodeId: "c",
							shape: "ellipse",
							x: 120,
							y: 140,
							width: 120,
							height: 60,
							label: "C",
						},
					],
				},
				{ op: "group", ids: ["a", "c"], groupId: "group-1" },
				{ op: "reorder", ids: ["b"], beforeId: "a" },
				{
					op: "replace",
					id: "c",
					element: {
						type: "node",
						id: "c",
						nodeId: "c",
						shape: "diamond",
						x: 120,
						y: 140,
						width: 140,
						height: 80,
						label: "C updated",
						groupIds: ["group-1"],
					},
				},
				{ op: "ungroup", ids: ["a"], groupId: "group-1" },
				{ op: "remove", selector: { ids: ["a"] } },
			],
		});

		expectPatchOk(patched);
		const scene = parseInlineScene(
			patched.artifact.formats.find((format) => format.format === "scene")?.inline,
		);
		expect(scene.zOrder).toEqual(["b", "c"]);
		expect(scene.elements).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					id: "c",
					label: "C updated",
					groupIds: ["group-1"],
				}),
			]),
		);
	});

	it("returns typed CanvasSpec structural and limit failures", async () => {
		const base = {
			kind: "canvas",
			version: 1,
			diagramId: "invalid-canvas",
			title: "Invalid canvas",
			width: 600,
			height: 300,
			accentColor: "#111827",
			backgroundColor: "#ffffff",
			layers: [],
			layouts: [],
		};
		const invalid = await createTestRuntime().createCanvas({
			spec: {
				...base,
				elements: [
					{
						type: "node",
						id: "same",
						nodeId: "a",
						shape: "rectangle",
						x: 20,
						y: 20,
						width: 120,
						height: 60,
						label: "A",
					},
					{
						type: "node",
						id: "same",
						nodeId: "b",
						shape: "rectangle",
						x: 220,
						y: 20,
						width: 120,
						height: 60,
						label: "B",
					},
					{
						type: "line",
						id: "line",
						points: [
							{ x: 0, y: 0 },
							{ x: 20, y: 20 },
						],
						endBinding: { elementId: "missing" },
					},
				],
				zOrder: ["same", "line"],
			},
		});
		expect(invalid).toMatchObject({
			ok: false,
			status: "invalid_canvas",
			issues: expect.arrayContaining([
				expect.objectContaining({
					code: "duplicate_element_id",
					stage: "canvas",
				}),
				expect.objectContaining({
					code: "invalid_canvas_binding",
					stage: "canvas",
				}),
			]),
		});

		const limited = await createTestRuntime().createCanvas({
			spec: {
				...base,
				width: 20_000,
				elements: [
					{
						type: "node",
						id: "a",
						nodeId: "a",
						shape: "rectangle",
						x: 20,
						y: 20,
						width: 120,
						height: 60,
						label: "A",
					},
				],
				zOrder: ["a"],
			},
		});
		expect(limited).toMatchObject({
			ok: false,
			status: "limit_exceeded",
			issues: [expect.objectContaining({ code: "canvas_limit_exceeded" })],
		});
	});
});

function geometryCanvas(elements: CanvasSpec["elements"] = []): CanvasSpec {
	return {
		kind: "canvas",
		version: 1,
		diagramId: "geometry",
		title: "Geometry",
		width: 600,
		height: 600,
		accentColor: "#111827",
		backgroundColor: "#ffffff",
		layers: [],
		layouts: [],
		elements,
		zOrder: elements.map(({ id }) => id),
	};
}

function geometryNode(id: string, x: number, y: number): CanvasShapeElement {
	return {
		type: "node",
		id,
		nodeId: id,
		shape: "rectangle",
		x,
		y,
		width: 100,
		height: 60,
		label: id,
	};
}

function densePointElements(count: number): CanvasSpec["elements"] {
	return Array.from({ length: count }, (_, index) => ({
		type: "line",
		id: `line-${index}`,
		points: [
			{ x: 0, y: 0 },
			{ x: 1, y: 1 },
			...Array.from({ length: 254 }, () => ({ x: 1, y: 1 })),
		],
	}));
}

describe("curved mindmap connectors", () => {
	const curves = (scene: RenderedDiagramScene) =>
		scene.elements.flatMap((element) =>
			element.type === "arrow" && element.curved ? [element] : [],
		);
	/** A returned scene, checked against the scene contract and typed as the renderer draws it. */
	const sceneOf = (value: unknown): RenderedDiagramScene => {
		parseInlineScene(value);
		return value as RenderedDiagramScene;
	};
	/** Every step of the route runs along an axis, as an orthogonal reroute does. */
	const orthogonal = (points: readonly { x: number; y: number }[]) =>
		points.every(
			(point, index) =>
				index === 0 || point.x === points[index - 1]!.x || point.y === points[index - 1]!.y,
		);

	it("keeps a mindmap's curves when its scene is reused as a canvas", async () => {
		const scene = renderMindmapDiagram(mindmapFixture);
		const result = await createTestRuntime().createCanvas({ spec: scene });
		if (!result.ok) throw new Error(`Expected accepted canvas: ${JSON.stringify(result.issues)}`);
		const canvas = sceneOf(result.normalizedSpec);
		expect(mindmapLayoutIssues(canvas)).toEqual([]);
		expect(curves(canvas).map((arrow) => arrow.points)).toEqual(
			curves(scene).map((arrow) => arrow.points),
		);
	});

	it("redraws the curves of a moved branch as curves clear of every topic", async () => {
		const scene = renderMindmapDiagram(mindmapFixture);
		const result = await createTestRuntime().applyDiagramPatch({
			source: { scene },
			operations: [
				{
					op: "translate",
					selector: { nodeIds: ["topic-0-1", "topic-0-1-0", "topic-0-1-1"] },
					dx: 0,
					dy: 80,
				},
			],
			options: { artifactFormats: ["scene"], inlineArtifacts: ["scene"] },
		});
		expectPatchOk(result);
		const patched = sceneOf(result.artifact.formats[0]?.inline);
		const moved = curves(patched).filter((arrow) =>
			["topic-0-1", "topic-0-1-0", "topic-0-1-1"].includes(arrow.targetNodeId),
		);
		expect(moved).toHaveLength(3);
		for (const arrow of moved) expect(orthogonal(arrow.points), arrow.id).toBe(false);
		expect(mindmapLayoutIssues(patched)).toEqual([]);
	});
});

describe("canvas geometry and input bounds", () => {
	it.each([
		{ x: 300, y: 0, start: { x: 100, y: 30 }, end: { x: 300, y: 30 } },
		{ x: 0, y: 300, start: { x: 50, y: 60 }, end: { x: 50, y: 300 } },
	])("reroutes to the near target edge for a pair at $x,$y", async ({ x, y, start, end }) => {
		const result = await createTestRuntime().applyDiagramPatch({
			source: {
				scene: geometryCanvas([
					geometryNode("a", 0, 0),
					geometryNode("b", x, y),
					{
						type: "arrow",
						id: "ab",
						edgeId: "ab",
						sourceNodeId: "a",
						targetNodeId: "b",
						points: [start, end],
					},
				]),
			},
			operations: [{ op: "rerouteEdges" }],
			options: { artifactFormats: ["scene"], inlineArtifacts: ["scene"] },
		});
		expectPatchOk(result);
		const scene = parseInlineScene(result.artifact.formats[0]?.inline);
		const arrow = scene.elements.find(({ id }) => id === "ab");
		if (!arrow || arrow.type !== "arrow") throw new Error("Expected ab arrow");
		expect(arrow.points[0]).toEqual(start);
		expect(arrow.points.at(-1)).toEqual(end);
	});

	it("cascades removal through an inserted label ordered before its arrow", async () => {
		const result = await createTestRuntime().applyDiagramPatch({
			source: {
				scene: geometryCanvas([geometryNode("a", 0, 0), geometryNode("b", 300, 0)]),
			},
			operations: [
				{
					op: "insert",
					elements: [
						{
							type: "text",
							id: "label-a2",
							containerId: "a2",
							x: 200,
							y: 30,
							text: "edge",
							fontSize: 13,
						},
						{
							type: "arrow",
							id: "a2",
							edgeId: "a2",
							sourceNodeId: "a",
							targetNodeId: "b",
							points: [
								{ x: 100, y: 30 },
								{ x: 300, y: 30 },
							],
						},
					],
				},
				{ op: "remove", selector: { ids: ["a"] } },
			],
			options: {
				preserveConnectivity: false,
				artifactFormats: ["scene"],
				inlineArtifacts: ["scene"],
			},
		});
		expectPatchOk(result);
		const scene = parseInlineScene(result.artifact.formats[0]?.inline);
		expect(scene.elements.map(({ id }) => id)).toEqual(["b"]);
		expect(scene.zOrder).toEqual(["b"]);
	});

	it("recomputes bounds after filling the canvas with 256-point lines", async () => {
		const result = await createTestRuntime().applyDiagramPatch({
			source: { scene: geometryCanvas([geometryNode("a", 0, 0)]) },
			operations: [
				{
					op: "insert",
					elements: densePointElements(CANVAS_LIMITS.maxElements - 1),
				},
				{ op: "translate", selector: { nodeIds: ["a"] }, dx: 10, dy: 10 },
			],
			options: {
				preserveConnectivity: false,
				artifactFormats: ["scene"],
				inlineArtifacts: ["scene"],
			},
		});
		expectPatchOk(result);
		const scene = parseInlineScene(result.artifact.formats[0]?.inline);
		expect(scene.elements).toHaveLength(CANVAS_LIMITS.maxElements);
		expect(scene).toMatchObject({ width: 648, height: 648 });
	}, 60_000);

	it("rejects a raw full canvas of 256-point lines before decode in both workflows", async () => {
		const scene = geometryCanvas(densePointElements(CANVAS_LIMITS.maxElements));
		const runtime = createTestRuntime();
		expect(await runtime.createCanvas({ spec: scene })).toMatchObject({
			ok: false,
			status: "limit_exceeded",
			issues: [
				expect.objectContaining({
					code: "canvas_limit_exceeded",
					ref: { kind: "request", path: "spec" },
				}),
			],
		});
		expect(
			await runtime.applyDiagramPatch({
				source: { scene },
				operations: [{ op: "translate", dx: 1, dy: 1 }],
			}),
		).toMatchObject({
			ok: false,
			status: "invalid_input",
			issues: [
				expect.objectContaining({
					code: "canvas_limit_exceeded",
					ref: { kind: "request", path: "source.scene" },
				}),
			],
		});
	});

	it("counts raw unknown fields and UTF-8 bytes before schema decoding", async () => {
		const scene = {
			...geometryCanvas([geometryNode("a", 0, 0)]),
			ignored: "💡".repeat(CANVAS_LIMITS.maxSerializedBytes / 4),
		};
		expect(await createTestRuntime().createCanvas({ spec: scene })).toMatchObject({
			ok: false,
			status: "limit_exceeded",
		});
		expect(
			await createTestRuntime().applyDiagramPatch({
				source: { scene },
				operations: [{ op: "setDefaultStyle", style: {} }],
			}),
		).toMatchObject({
			ok: false,
			status: "invalid_input",
			issues: [expect.objectContaining({ code: "canvas_limit_exceeded" })],
		});
	});

	it.each(["createCanvas", "applyDiagramPatch"])(
		"returns a typed rejection for deeply nested unknown fields in %s",
		async (operation) => {
			// A Date leaf selects the recursive serializer even with Node's fast path.
			let nested: unknown = new Date(0);
			for (let depth = 0; depth < 10_000; depth += 1) nested = [nested];
			const scene = {
				...geometryCanvas([geometryNode("a", 0, 0)]),
				ignored: nested,
			};
			const memory = makeMemoryArtifactStorage();
			let writes = 0;
			const store: CodeModeArtifactStorageShape = {
				...memory,
				write(input) {
					writes += 1;
					return memory.write(input);
				},
			};
			const runtime = makeTestRuntime({ store });
			const result =
				operation === "createCanvas"
					? await runtime.createCanvas({
							requestId: "deep-canvas-request",
							spec: scene,
						})
					: await runtime.applyDiagramPatch({
							source: { scene },
							operations: [{ op: "setDefaultStyle", style: {} }],
						});
			expect(result).toMatchObject({
				ok: false,
				status: "invalid_input",
				issues: [
					expect.objectContaining({
						code: "invalid_type",
						stage: "input",
						ref: {
							kind: "request",
							path: operation === "createCanvas" ? "spec" : "source.scene",
						},
					}),
				],
			});
			if (operation === "createCanvas") {
				expect(result).toMatchObject({
					buildId: "build-test",
					requestId: "deep-canvas-request",
				});
			}
			expect(writes).toBe(0);
		},
	);

	it("checks inline source limits before applying removal operations", async () => {
		const scene = {
			...geometryCanvas([geometryNode("a", 0, 0)]),
			width: 20000,
		};
		const result = await createTestRuntime().applyDiagramPatch({
			source: { scene },
			operations: [{ op: "remove", selector: { ids: ["a"] } }],
		});
		expect(result).toMatchObject({
			ok: false,
			status: "invalid_input",
			issues: expect.arrayContaining([expect.objectContaining({ code: "canvas_limit_exceeded" })]),
		});
	});

	it("rejects a tall authored label as invalid_canvas before export", async () => {
		const scene = geometryCanvas([
			{
				...geometryNode("a", 0, 0),
				width: 200,
				height: 30,
				label: "one\ntwo\nthree",
			},
		]);
		expect(await createTestRuntime().createCanvas({ spec: scene })).toMatchObject({
			ok: false,
			status: "invalid_canvas",
			issues: [
				expect.objectContaining({
					code: "invalid_canvas_geometry",
					ref: { kind: "element", id: "a", path: "elements[0].label" },
				}),
			],
		});
	});

	it.each([
		["elements", CANVAS_LIMITS.maxElements, () => geometryNode("a", 0, 0)],
		["layers", CANVAS_LIMITS.maxLayers, () => ({ id: "layer" })],
		["layouts", CANVAS_LIMITS.maxLayouts, () => ({ type: "row", ids: ["a"] })],
		["zOrder", CANVAS_LIMITS.maxZOrderEntries, () => "a"],
	])(
		"advertises the $0 limit while leaving count failures to the runtime",
		(field, limit, item) => {
			const scene = geometryCanvas([geometryNode("a", 0, 0)]);
			expect(
				Result.isSuccess(
					Schema.decodeUnknownResult(CanvasSpecSchema, {
						errors: "all",
						reportInput: true,
					})({
						...scene,
						[field]: Array.from({ length: limit + 1 }, () => item()),
					}),
				),
			).toBe(true);
			expect(
				Result.isSuccess(
					Schema.decodeUnknownResult(CanvasSpecSchema, {
						errors: "all",
						reportInput: true,
					})({
						...scene,
						[field]: Array.from({ length: limit }, () => item()),
					}),
				),
			).toBe(true);
			expect(toCodeModeJsonSchema(CreateCanvasRequestSchema)).toMatchObject({
				properties: {
					spec: {
						properties: {
							[field]: expect.objectContaining({ maxItems: limit }),
						},
					},
				},
			});
		},
	);

	it("advertises the groups-per-element limit while leaving count failures to the runtime", () => {
		const scene = geometryCanvas([
			{
				...geometryNode("a", 0, 0),
				groupIds: Array.from({ length: CANVAS_LIMITS.maxGroupsPerElement + 1 }, () => "g"),
			},
		]);
		expect(
			Result.isSuccess(
				Schema.decodeUnknownResult(CanvasSpecSchema, {
					errors: "all",
					reportInput: true,
				})(scene),
			),
		).toBe(true);
		expect(JSON.stringify(toCodeModeJsonSchema(CreateCanvasRequestSchema))).toContain(
			`"maxItems":${CANVAS_LIMITS.maxGroupsPerElement}`,
		);
	});
});

describe("reviewed label-fit regressions", () => {
	it("accepts a sequence build with a three-line participant label", async () => {
		const result = await createTestRuntime().buildSequenceDiagram({
			spec: {
				...checkoutSequenceSpec(),
				participants: [
					{ id: "customer", label: "one\ntwo\nthree" },
					{ id: "store", label: "Store" },
					{ id: "payments", label: "Payments" },
				],
			},
			options: {
				artifactFormats: ["scene", "excalidraw"],
				inlineArtifacts: ["scene"],
			},
		});
		expect(result).toMatchObject({ ok: true, status: "accepted", issues: [] });
		if (!result.ok) throw new Error("Expected accepted multiline sequence");
		const scene = parseInlineScene(
			result.artifact.formats.find(({ format }) => format === "scene")?.inline,
		);
		expect(scene.elements.find(({ id }) => id === "node:customer")).toMatchObject({ height: 75 });
	});

	it("creates a canvas with a hidden overflowing bound label without changing authored node geometry", async () => {
		const scene = geometryCanvas([
			{ ...geometryNode("a", 0, 0), label: "A" },
			{
				type: "text",
				id: "hidden-label",
				containerId: "a",
				x: 50,
				y: 30,
				fontSize: 20,
				text: "one\ntwo\nthree",
				layerId: "hidden",
			},
		]);
		const result = await createTestRuntime().createCanvas({
			spec: { ...scene, layers: [{ id: "hidden", visible: false }] },
			options: {
				artifactFormats: ["excalidraw"],
				inlineArtifacts: ["excalidraw"],
			},
		});
		expectCanvasOk(result);
		expect(result.normalizedSpec.elements.find(({ id }) => id === "a")).toMatchObject({
			width: 100,
			height: 60,
		});
		expect(result.artifact.formats[0]?.inline).toMatchObject({
			elements: expect.arrayContaining([
				expect.objectContaining({ id: "a", width: 100, height: 60 }),
				expect.objectContaining({ text: "A" }),
			]),
		});
		expect(result.artifact.formats[0]?.inline).toMatchObject({
			elements: expect.not.arrayContaining([expect.objectContaining({ id: "hidden-label" })]),
		});
	});
});

describe("bot-reviewed canvas limits and coincident routes", () => {
	it("checks oversized inline scene counts before removable malformed geometry can bypass validation", async () => {
		const elements: CanvasSpec["elements"] = Array.from(
			{ length: CANVAS_LIMITS.maxElements },
			(_, index) => ({
				type: "frame",
				id: `frame-${index}`,
				x: 0,
				y: 0,
				width: 10,
				height: 10,
			}),
		);
		const scene = {
			...geometryCanvas(elements),
			elements: [
				...elements,
				{
					...geometryNode("bad", 0, 0),
					shape: "polygon",
					points: [
						{ x: 0, y: 0 },
						{ x: 10, y: 10 },
					],
				},
			],
			zOrder: [...elements.map(({ id }) => id), "bad"],
		};
		const result = await createTestRuntime().applyDiagramPatch({
			source: { scene },
			operations: [{ op: "remove", selector: { ids: ["bad", "frame-0"] } }],
			options: { preserveConnectivity: false, artifactFormats: ["scene"] },
		});
		expect(result).toMatchObject({
			ok: false,
			status: "invalid_input",
			issues: expect.arrayContaining([expect.objectContaining({ code: "canvas_limit_exceeded" })]),
		});
	});

	it("keeps every accepted canvas within a share link's Excalidraw elements", async () => {
		const cylinders = (count: number) =>
			geometryCanvas(
				Array.from({ length: count }, (_, index) => ({
					...geometryNode(`db-${index}`, (index % 50) * 140, Math.floor(index / 50) * 120),
					shape: "cylinder" as const,
					width: 120,
					height: 100,
					label: "DB",
				})),
			);
		const one = await createTestRuntime().createCanvas({
			spec: cylinders(1),
			options: { artifactFormats: ["excalidraw"], inlineArtifacts: ["excalidraw"] },
		});
		expectCanvasOk(one);
		const inline = one.artifact.formats[0]?.inline as { readonly elements: readonly unknown[] };
		// A labelled cylinder composes several Excalidraw elements.
		const perCylinder = inline.elements.length;
		expect(perCylinder).toBeGreaterThan(2);
		const count = Math.floor(CANVAS_LIMITS.maxExportedElements / perCylinder) + 1;
		expect(count).toBeLessThanOrEqual(CANVAS_LIMITS.maxElements);

		const result = await createTestRuntime().createCanvas({
			spec: cylinders(count),
			options: { artifactFormats: ["scene"] },
		});
		expect(result).toMatchObject({
			ok: false,
			status: "limit_exceeded",
			issues: [
				expect.objectContaining({
					code: "canvas_limit_exceeded",
					message: `Canvas exports ${count * perCylinder} Excalidraw elements, more than the ${CANVAS_LIMITS.maxExportedElements} a share link holds.`,
				}),
			],
		});
	}, 60_000);

	it("returns limit_exceeded when a patch grows a scene past the element limit", async () => {
		const result = await createTestRuntime().applyDiagramPatch({
			source: { scene: geometryCanvas([geometryNode("a", 0, 0)]) },
			operations: [
				{
					op: "insert",
					elements: Array.from({ length: CANVAS_LIMITS.maxElements }, (_, index) => ({
						type: "frame",
						id: `frame-${index}`,
						x: 0,
						y: 0,
						width: 10,
						height: 10,
					})),
				},
			],
			options: { preserveConnectivity: false, artifactFormats: ["scene"] },
		});
		expect(result).toMatchObject({
			ok: false,
			status: "limit_exceeded",
			issues: [
				expect.objectContaining({
					code: "canvas_limit_exceeded",
					message: `Canvas has ${CANVAS_LIMITS.maxElements + 1} elements, more than the ${CANVAS_LIMITS.maxElements} it may hold.`,
				}),
			],
		});
	});

	it("returns limit_exceeded for one small element past the limit below the byte limit", async () => {
		const elements: CanvasSpec["elements"] = Array.from(
			{ length: CANVAS_LIMITS.maxElements + 1 },
			(_, index) => ({
				type: "frame",
				id: `frame-${index}`,
				x: 0,
				y: 0,
				width: 10,
				height: 10,
			}),
		);
		const scene = geometryCanvas(elements);
		expect(new TextEncoder().encode(JSON.stringify(scene)).byteLength).toBeLessThan(
			CANVAS_LIMITS.maxSerializedBytes,
		);
		const result = await createTestRuntime().createCanvas({ spec: scene });
		expect(result).toMatchObject({
			ok: false,
			status: "limit_exceeded",
			issues: expect.arrayContaining([
				expect.objectContaining({
					code: "canvas_limit_exceeded",
					stage: "canvas",
				}),
			]),
		});
		const boundary = await createTestRuntime().createCanvas({
			spec: geometryCanvas(elements.slice(0, CANVAS_LIMITS.maxElements)),
			options: { artifactFormats: ["scene"] },
		});
		expectCanvasOk(boundary);
	});

	it.each([
		{
			field: "layers",
			value: Array.from({ length: CANVAS_LIMITS.maxLayers + 1 }, (_, index) => ({
				id: `layer-${index}`,
			})),
		},
		{
			field: "layouts",
			value: Array.from({ length: CANVAS_LIMITS.maxLayouts + 1 }, () => ({
				type: "row",
				ids: ["a"],
			})),
		},
		{
			field: "zOrder",
			value: Array.from({ length: CANVAS_LIMITS.maxZOrderEntries + 1 }, () => "a"),
		},
	])("keeps the $field count failure limit-specific", async ({ field, value }) => {
		const scene = {
			...geometryCanvas([geometryNode("a", 0, 0)]),
			[field]: value,
		};
		expect(await createTestRuntime().createCanvas({ spec: scene })).toMatchObject({
			ok: false,
			status: "limit_exceeded",
			issues: expect.arrayContaining([
				expect.objectContaining({
					code: "canvas_limit_exceeded",
					ref: { kind: "diagram", path: field },
				}),
			]),
		});
	});

	it("keeps the groups-per-element count failure limit-specific", async () => {
		const scene = geometryCanvas([
			{
				...geometryNode("a", 0, 0),
				groupIds: Array.from(
					{ length: CANVAS_LIMITS.maxGroupsPerElement + 1 },
					(_, index) => `group-${index}`,
				),
			},
		]);
		expect(await createTestRuntime().createCanvas({ spec: scene })).toMatchObject({
			ok: false,
			status: "limit_exceeded",
			issues: expect.arrayContaining([
				expect.objectContaining({
					code: "canvas_limit_exceeded",
					ref: { kind: "element", id: "a", path: "elements[0].groupIds" },
				}),
			]),
		});
	});

	it("still classifies malformed small canvas fields as invalid_input", async () => {
		const scene = {
			...geometryCanvas([geometryNode("a", 0, 0)]),
			layers: "not an array",
		};
		expect(await createTestRuntime().createCanvas({ spec: scene })).toMatchObject({
			ok: false,
			status: "invalid_input",
		});
	});

	it("reroutes coincident nodes to distinct source and target faces", async () => {
		const result = await createTestRuntime().applyDiagramPatch({
			source: {
				scene: geometryCanvas([
					geometryNode("a", 0, 0),
					geometryNode("b", 0, 0),
					{
						type: "arrow",
						id: "ab",
						edgeId: "ab",
						sourceNodeId: "a",
						targetNodeId: "b",
						points: [
							{ x: 50, y: 60 },
							{ x: 50, y: 0 },
						],
					},
				]),
			},
			operations: [{ op: "rerouteEdges" }],
			options: {
				artifactFormats: ["scene", "excalidraw"],
				inlineArtifacts: ["scene", "excalidraw"],
			},
		});
		expectPatchOk(result);
		const scene = parseInlineScene(
			result.artifact.formats.find(({ format }) => format === "scene")?.inline,
		);
		const arrow = scene.elements.find(({ id }) => id === "ab");
		if (!arrow || arrow.type !== "arrow") throw new Error("Expected ab arrow");
		expect(arrow.points[0]).toEqual({ x: 50, y: 60 });
		expect(arrow.points.at(-1)).toEqual({ x: 50, y: 0 });
		expect(new Set(arrow.points.map(({ x, y }) => `${x},${y}`)).size).toBeGreaterThan(1);
	});
});

describe("final-review correlation and sequence canvas bounds", () => {
	it("preserves buildId and requestId on raw-byte canvas limit failures", async () => {
		const scene = geometryCanvas(densePointElements(CANVAS_LIMITS.maxElements));
		expect(new TextEncoder().encode(JSON.stringify(scene)).byteLength).toBeGreaterThan(
			CANVAS_LIMITS.maxSerializedBytes,
		);
		const result = await createTestRuntime().createCanvas({
			requestId: "oversized-canvas-request",
			spec: scene,
		});
		expect(result).toMatchObject({
			ok: false,
			status: "limit_exceeded",
			buildId: "build-1",
			requestId: "oversized-canvas-request",
			issues: [expect.objectContaining({ code: "canvas_limit_exceeded" })],
		});
	});

	it.each([
		{ lines: 854, accepted: true },
		{ lines: 855, accepted: false },
	])(
		"enforces canvas bounds for a sequence with $lines participant label lines",
		async ({ lines, accepted }) => {
			const memory = makeMemoryArtifactStorage();
			let writes = 0;
			const store: CodeModeArtifactStorageShape = {
				...memory,
				write(input) {
					writes += 1;
					return memory.write(input);
				},
			};
			const label = Array.from({ length: lines }, () => "x").join("\n");
			const result = await makeTestRuntime({ store }).buildSequenceDiagram({
				requestId: "sequence-bounds-request",
				spec: {
					title: "Sequence canvas bounds",
					participants: [
						{ id: "a", label },
						{ id: "b", label: "B" },
					],
					messages: [{ source: "a", target: "b", label: "Continue" }],
				},
				options: { artifactFormats: ["scene"], inlineArtifacts: ["scene"] },
			});
			if (accepted) {
				expect(result).toMatchObject({ ok: true, status: "accepted" });
				if (!result.ok) throw new Error("Expected within-bounds sequence");
				const scene = parseInlineScene(result.artifact.formats[0]?.inline);
				expect(scene.height).toBeLessThanOrEqual(CANVAS_LIMITS.maxDimension);
				expect(writes).toBe(1);
			} else {
				expect(result).toMatchObject({
					ok: false,
					// Too tall for a canvas: a limit the caller meets by splitting, not a render defect.
					status: "limit_exceeded",
					buildId: "build-test",
					requestId: "sequence-bounds-request",
					normalizedSpec: {
						participants: [expect.objectContaining({ label }), expect.anything()],
					},
					issues: expect.arrayContaining([
						expect.objectContaining({
							code: "canvas_limit_exceeded",
							stage: "canvas",
							message: expect.stringContaining(String(CANVAS_LIMITS.maxDimension)),
						}),
					]),
				});
				expect(writes).toBe(0);
			}
		},
	);
});

describe("shared artifact export-and-store boundary", () => {
	const operations = [
		"buildFlowchart",
		"buildMindmap",
		"buildSequenceDiagram",
		"createCanvas",
		"applyDiagramPatch",
	] as const;
	function request(operation: (typeof operations)[number], formats: ArtifactFormat[]) {
		const options = { artifactFormats: formats };
		const canvas = geometryCanvas([geometryNode("box", 20, 20)]);
		switch (operation) {
			case "buildFlowchart":
				return { requestId: "shared-tail", spec: approvalSpec(), options };
			case "buildMindmap":
				return {
					requestId: "shared-tail",
					spec: {
						title: "Mindmap",
						root: { label: "Root", children: [{ label: "Child" }] },
					},
					options,
				};
			case "buildSequenceDiagram":
				return {
					requestId: "shared-tail",
					spec: checkoutSequenceSpec(),
					options,
				};
			case "createCanvas":
				return { requestId: "shared-tail", spec: canvas, options };
			case "applyDiagramPatch":
				return {
					requestId: "shared-tail",
					source: { scene: canvas },
					operations: [
						{
							op: "setStyle",
							selector: { ids: ["box"] },
							style: { strokeColor: "#111111" },
						},
					],
					options,
				};
		}
	}

	it.each(operations)(
		"preserves %s storage-failure context and correlation ids",
		async (operation) => {
			let writeCalls = 0;
			const runtime = makeTestRuntime({
				store: {
					read: () => Effect.succeed(null),
					readManifest: () => Effect.succeed(null),
					write: () => {
						writeCalls += 1;
						return Effect.fail(
							new CodeModeArtifactStorageError({
								cause: new Error("storage unavailable"),
								message: "storage unavailable",
								operation: "write",
							}),
						);
					},
				},
			});
			const result = await runtime[operation](request(operation, ["scene"]));
			expect(result.ok).toBe(false);
			if (result.ok) throw new Error("Expected storage failure.");
			expect(result).toMatchObject({
				status: "storage_failed",
				requestId: "shared-tail",
				issues: [
					{
						code: "storage_write_failed",
						stage: "storage",
						message: "storage unavailable",
					},
				],
			});
			expect(writeCalls).toBe(1);
			if (operation === "buildMindmap")
				expect(result).toHaveProperty("partial", {
					diagramId: expect.any(String),
				});
			else if (operation === "createCanvas")
				expect(result).toHaveProperty("partial.formats.0.inline");
			else expect(result).not.toHaveProperty("partial");
			expect(result).toHaveProperty(operation === "applyDiagramPatch" ? "patchId" : "buildId");
		},
	);

	it.each(operations)(
		"maps %s tagged renderer failures without writing artifacts",
		async (operation) => {
			let writeCalls = 0;
			const runtime = makeTestRuntime({
				renderer: {
					renderPng: () =>
						Effect.fail(
							new CodeModeArtifactRenderFailed({
								cause: new Error("PNG failed"),
								message: "PNG failed",
							}),
						),
				},
				store: {
					read: () => Effect.succeed(null),
					readManifest: () => Effect.succeed(null),
					write: () => {
						writeCalls += 1;
						return Effect.die("Export failure must not write.");
					},
				},
			});
			const result = await runtime[operation](request(operation, ["png"]));
			expect(result).toMatchObject({
				ok: false,
				status: "export_failed",
				requestId: "shared-tail",
				issues: [
					{
						code: "render_failed",
						severity: "error",
						stage: "export",
						message: "PNG failed",
						hint: "Retry the request; if it keeps failing, inspect the configured renderer.",
					},
				],
			});
			if (result.ok) throw new Error("Expected export failure.");
			expect(result.issues[0]).not.toHaveProperty("ref");
			expect(result).toHaveProperty("partial.formats.0.inline");
			expect(writeCalls).toBe(0);
		},
	);
});

describe("editFlowchart", () => {
	it("changes a built flowchart by id and builds the edit as a new artifact", async () => {
		const runtime = createTestRuntime();
		const built = await runtime.buildFlowchart({ spec: approvalSpec() });
		if (!built.ok) throw new Error("Expected the base to build.");
		const document = await runtime.getArtifact({
			artifactId: built.artifact.artifactId,
			format: "document",
			inline: true,
		});
		expect(document).toMatchObject({ ok: true });

		const edited = await runtime.editFlowchart({
			artifactId: built.artifact.artifactId,
			edits: [
				{ op: "insert", node: { notify: "Notify requester" }, between: ["approve", "revise"] },
				{ op: "set", nodes: { done: { color: "green" } } },
			],
		});

		expect(edited).toMatchObject({ ok: true, status: "accepted" });
		if (!edited.ok) return;
		expect(edited.artifact.artifactId).not.toBe(built.artifact.artifactId);
		expect(edited.normalizedSpec.nodes).toMatchObject({
			done: { label: "Done", color: "green" },
			notify: "Notify requester",
		});
		expect(edited.normalizedSpec.edges).toEqual([
			["request", "approve"],
			["approve", "done", "yes"],
			["approve", "notify", "no"],
			["notify", "revise"],
		]);
		const scene = edited.artifact.formats.find((format) => format.format === "scene")?.inline as {
			elements: { id: string; strokeColor?: string; fillColor?: string }[];
		};
		expect(scene.elements.find((element) => element.id === "node:done")).toMatchObject({
			strokeColor: "#16a34a",
			fillColor: "#dcfce7",
		});

		expect(edited).toMatchObject({
			artifact: { provenance: { sourceArtifactId: built.artifact.artifactId } },
			edits: [
				{ op: "insert", node: { notify: "Notify requester" }, between: ["approve", "revise"] },
				{ op: "set", nodes: { done: { color: "green" } } },
			],
		});

		// The edit is itself editable.
		const again = await runtime.editFlowchart({
			artifactId: edited.artifact.artifactId,
			edits: [{ op: "set", nodes: { done: { color: null } } }],
		});
		expect(again.ok && again.normalizedSpec.nodes["done"]).toBe("Done");
	});

	it("reads the stored document inline and edits it by label in one call", async () => {
		const runtime = createTestRuntime();
		const built = await runtime.buildFlowchart({ spec: approvalSpec() });
		if (!built.ok) throw new Error("Expected the base to build.");
		const read = await runtime.getArtifact({
			artifactId: built.artifact.artifactId,
			format: "document",
		});
		expect(read).toMatchObject({
			ok: true,
			format: "document",
			inline: { type: "flowchart", spec: { nodes: approvalSpec().nodes } },
		});

		const edited = await runtime.editFlowchart({
			artifactId: built.artifact.artifactId,
			edits: [
				{ op: "insert", node: { log: "Log request" }, between: ["Request arrives", "Approved?"] },
				{ op: "set", nodes: { Revise: { color: "red" } } },
			],
		});
		if (!edited.ok) throw new Error(JSON.stringify(edited.issues));
		expect(edited.normalizedSpec.edges).toContainEqual(["request", "log"]);
		expect(edited.normalizedSpec.edges).toContainEqual(["log", "approve"]);
		expect(edited.normalizedSpec.nodes["revise"]).toEqual({ label: "Revise", color: "red" });
		expect(
			edited.issues
				.filter((entry) => entry.code === "reference_resolved")
				.map((entry) => entry.message),
		).toEqual([
			'edits[0].between[0]: resolved "Request arrives" to the node labeled it, "request".',
			'edits[0].between[1]: resolved "Approved?" to the node labeled it, "approve".',
			'edits[1].nodes.Revise: resolved "Revise" to the node labeled it, "revise".',
		]);
	});

	it("stores nothing when the edited flowchart does not build", async () => {
		const runtime = createTestRuntime();
		const built = await runtime.buildFlowchart({ spec: approvalSpec() });
		if (!built.ok) throw new Error("Expected the base to build.");

		const result = await runtime.editFlowchart({
			artifactId: built.artifact.artifactId,
			edits: [{ op: "disconnect", edges: [["approve", "revise"]] }],
		});

		expect(result).toMatchObject({ ok: false, status: "invalid_flowchart" });
		expect(result.ok ? undefined : result.partial?.artifactId).toBeUndefined();
	});

	it("refuses to patch a flowchart, which changes by edits", async () => {
		const runtime = createTestRuntime();
		const built = await runtime.buildFlowchart({ spec: approvalSpec() });
		if (!built.ok) throw new Error("Expected the base to build.");

		const patched = await runtime.applyDiagramPatch({
			source: { artifactId: built.artifact.artifactId },
			operations: [
				{ op: "setStyle", selector: { nodeIds: ["done"] }, style: { strokeColor: "#16a34a" } },
			],
		});

		expect(patched).toMatchObject({
			ok: false,
			status: "unsupported_operation",
			issues: [
				expect.objectContaining({
					code: "unsupported_patch_operation",
					hint: expect.stringContaining("sketchi.editFlowchart"),
				}),
			],
		});
	});

	it("names an edit that targets nothing and changes nothing", async () => {
		const runtime = createTestRuntime();
		const built = await runtime.buildFlowchart({ spec: approvalSpec() });
		if (!built.ok) throw new Error("Expected the base to build.");

		const result = await runtime.editFlowchart({
			artifactId: built.artifact.artifactId,
			edits: [{ op: "insert", node: { x: "X" }, between: ["aprove", "done"] }],
		});

		expect(result).toMatchObject({
			ok: false,
			status: "invalid_edit",
			issues: [
				expect.objectContaining({
					code: "unknown_edit_target",
					ref: { kind: "diagram", path: "edits[0].between[0]" },
				}),
			],
		});
	});

	it("reports an artifact it cannot edit", async () => {
		const runtime = createTestRuntime();
		const missing = await runtime.editFlowchart({
			artifactId: "artifact-missing",
			edits: [{ op: "set", title: "Renamed" }],
		});
		expect(missing).toMatchObject({
			ok: false,
			status: "not_found",
			issues: [expect.objectContaining({ message: 'Artifact "artifact-missing" was not found.' })],
		});

		const mindmap = await runtime.buildMindmap({
			spec: { title: "Launch", root: { label: "Launch", children: [{ label: "Scope" }] } },
		});
		if (!mindmap.ok) throw new Error("Expected the mindmap to build.");
		const noDocument = await runtime.editFlowchart({
			artifactId: mindmap.artifact.artifactId,
			edits: [{ op: "set", title: "Renamed" }],
		});
		expect(noDocument).toMatchObject({
			ok: false,
			status: "not_found",
			issues: [
				expect.objectContaining({
					message: expect.stringContaining("holds no flowchart document"),
				}),
			],
		});
	});
});
