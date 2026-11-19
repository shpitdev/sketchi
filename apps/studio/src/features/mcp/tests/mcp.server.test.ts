// @vitest-environment node
import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { McpClient, McpProtocol } from "effect/ai";
import { FetchHttpClient } from "effect/http";
import ts from "typescript";
import { vi } from "vitest";

import { generateCodeModeTypes } from "../mcp-docs/types";
import { SKETCHI_CODE_MODE_TYPES } from "../mcp-docs.server";

/** A fresh module graph, as on a cold isolate: nothing from earlier requests survives. */
let worker: Promise<typeof import("../mcp.server")> | undefined;
const coldStart = Effect.sync(() => {
	vi.resetModules();
	worker = undefined;
});
const sessionHeaders: string[] = [];
const workerFetch = (input: RequestInfo | URL, init?: RequestInit) =>
	(worker ??= import("../mcp.server"))
		.then((module) => module.handleSketchiMcpRequest(new Request(input, init), {}, () => {}))
		.then((response) => {
			const session = response.headers.get("mcp-session-id");
			if (session !== null) sessionHeaders.push(session);
			return response;
		});
/** An unchanged 2025-11-25 client of the Worker's /mcp boundary. */
const workerClient = McpClient.layerHttp({
	name: "studio-continuity",
	version: "1",
	protocol: McpProtocol.v2025_11_25,
	url: "https://studio.test/mcp",
}).pipe(
	Layer.provide(FetchHttpClient.layer),
	Layer.provide(Layer.succeed(FetchHttpClient.Fetch, workerFetch)),
);

const declaration = (name: string) => {
	const found = SKETCHI_CODE_MODE_TYPES.split("\n\n").find((block) =>
		block.startsWith(`type ${name} = `),
	);
	if (!found) throw new Error(`Missing generated declaration ${name}`);
	return found.trim();
};
const onDemandTypes = [
	["buildFlowchart", ["BuildFlowchartRequest", "BuildOptions"]],
	["buildMindmap", ["BuildMindmapRequest", "BuildMindmapRequest_MindmapTopic"]],
	["buildSequenceDiagram", ["BuildSequenceDiagramRequest"]],
	["buildTimeline", ["BuildTimelineRequest"]],
	["buildGantt", ["BuildGanttRequest"]],
	["buildErDiagram", ["BuildErDiagramRequest"]],
	["buildClassDiagram", ["BuildClassDiagramRequest"]],
	["buildOrgChart", ["BuildOrgChartRequest"]],
	["buildVennDiagram", ["BuildVennDiagramRequest"]],
	["buildJourneyMap", ["BuildJourneyMapRequest"]],
	["buildSankey", ["BuildSankeyRequest"]],
	["buildQuadrantChart", ["BuildQuadrantChartRequest"]],
	["createCanvas", ["CreateCanvasRequest", "CanvasSpecInput", "CanvasElement"]],
	["getArtifact", ["GetArtifactRequest"]],
	["applyDiagramPatch", ["ApplyDiagramPatchRequest", "DiagramSelector"]],
	["issues", ["Issue", "IssueRef"]],
] as const;

// Hang guard for the full schema walk, not a speed budget.
describe("Code Mode MCP docs", { timeout: 60_000 }, () => {
	it("keeps the served declarations fresh and compilable", () => {
		const generated = generateCodeModeTypes();
		expect(SKETCHI_CODE_MODE_TYPES).toBe(generated);
		// Fixed palettes are not editable through these requests (#386).
		const consumer = `
			type Assert<T extends true> = T;
			type FixedPaletteInputs = keyof BuildMindmapRequest["spec"] | keyof BuildSequenceDiagramRequest["spec"];
			type NoPaletteInput = Assert<"style" extends FixedPaletteInputs ? false : true>;
		`;
		const source = ts.createSourceFile(
			"code-mode-types.ts",
			`${SKETCHI_CODE_MODE_TYPES}\n${consumer}`,
			ts.ScriptTarget.Latest,
			true,
		);
		const options: ts.CompilerOptions = {
			noEmit: true,
			types: [],
			skipLibCheck: true,
			target: ts.ScriptTarget.ESNext,
		};
		const host = ts.createCompilerHost(options);
		const getSourceFile = host.getSourceFile.bind(host);
		host.getSourceFile = (file, ...args) =>
			file === "code-mode-types.ts" ? source : getSourceFile(file, ...args);
		const program = ts.createProgram({
			rootNames: ["code-mode-types.ts"],
			options,
			host,
		});
		expect(
			ts
				.getPreEmitDiagnostics(program)
				.map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")),
		).toEqual([]);
	});

	it.effect(
		"serves docs, execute and search to a client that initialized once, across cold starts, without a session",
		() =>
			Effect.gen(function* () {
				yield* coldStart;
				const client = yield* McpClient.McpClient;
				const tools = yield* client.listTools();
				expect(tools.map((tool) => tool.name).sort()).toEqual(["docs", "execute", "search"]);
				// Every client pays for discovery up front; per-family types come from docs on demand.
				expect(new TextEncoder().encode(JSON.stringify(tools)).byteLength).toBeLessThan(30_000);
				const docs = tools.find((tool) => tool.name === "docs")!;
				for (const [topic, types] of onDemandTypes) {
					yield* coldStart;
					const result = yield* client.callTool({ tool: docs, arguments: { topic } });
					const text = result.content.map((part) => ("text" in part ? part.text : "")).join("\n");
					for (const name of types) expect(text, `${topic} ${name}`).toContain(declaration(name));
				}
				expect(sessionHeaders).toEqual([]);
			}).pipe(Effect.provide(workerClient)),
	);
});
