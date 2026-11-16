// @vitest-environment node
import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { McpProtocol, McpServer, McpTest } from "effect/ai";
import ts from "typescript";

import {
	PlaygroundBindings,
	PlaygroundClockLive,
	PlaygroundIdsLive,
	PlaygroundRequestMetadata,
} from "../../../server/runtime/context.server";
import { StudioBuildHostLive } from "../../build/capabilities.server";
import { PlaygroundCodeModeUsageLive } from "../../build/usage-events.server";
import { generateCodeModeTypes } from "../mcp-docs/types";
import { SKETCHI_CODE_MODE_TYPES } from "../mcp-docs.server";
import { StudioMcpRegistrations } from "../mcp.server";
import { CodeModeSandbox } from "../sandbox.server";

const host = Layer.mergeAll(
	StudioBuildHostLive,
	PlaygroundClockLive,
	PlaygroundIdsLive,
	PlaygroundCodeModeUsageLive,
);
type HandlerServices =
	| Layer.Success<typeof host>
	| PlaygroundBindings
	| PlaygroundRequestMetadata
	| CodeModeSandbox;
/** The toolkit the Worker registers, served over the MCP protocol with discovery-only services. */
const registeredClient = McpTest.makeClient(
	StudioMcpRegistrations.pipe(
		Layer.provide(
			McpServer.middleware<{ provides: HandlerServices }>()((effect) =>
				effect.pipe(
					Effect.provide(host),
					Effect.provideService(PlaygroundBindings, {}),
					Effect.provideService(PlaygroundRequestMetadata, {
						request: new Request("https://studio.test/mcp"),
						origin: "https://studio.test",
						path: "/mcp",
						method: "POST",
						attemptId: "attempt-discovery",
						runId: "run-discovery",
						traceId: "trace-discovery",
					}),
					Effect.provideService(CodeModeSandbox, {
						execute: () => Effect.die("discovery does not execute code"),
					}),
				),
			).layer,
		),
	),
	{ name: "studio-discovery", version: "1", protocols: [McpProtocol.v2025_11_25] },
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
	it("keeps the consumed declarations fresh and compiles their structural contracts", () => {
		const generated = generateCodeModeTypes();
		expect(SKETCHI_CODE_MODE_TYPES).toBe(generated);
		const source = ts.createSourceFile(
			"code-mode-types.ts",
			`${SKETCHI_CODE_MODE_TYPES}
        type Assert<T extends true> = T;
        type Same<A, B> = [A] extends [B] ? [B] extends [A] ? true : false : false;
        type OptionalKeys<T> = {
          [K in keyof T]-?: {} extends Pick<T, K> ? K : never
        }[keyof T];
        type FlowchartRequestOptional = Assert<
          "direction" | "logos" | "groups" | "lanes" extends OptionalKeys<BuildFlowchartRequest["spec"]> ? true : false
        >;
        type FlowchartResultFilled = Assert<
          Extract<OptionalKeys<Extract<BuildFlowchartResult, { ok: true }>["normalizedSpec"]>, "id" | "direction" | "edges"> extends never ? true : false
        >;
        type FlowchartEdgeTuple = Assert<Same<BuildFlowchartRequest["spec"]["edges"][number], [string | Array<string>, string | Array<string>, string?]>>;
        type FlowchartPaletteNotAnInput = Assert<"style" extends keyof BuildFlowchartRequest["spec"] ? false : true>;
        type MindmapPaletteNotAnInput = Assert<"style" extends keyof BuildMindmapRequest["spec"] ? false : true>;
        type SequencePaletteNotAnInput = Assert<"style" extends keyof BuildSequenceDiagramRequest["spec"] ? false : true>;
        type SequenceMessageStyle = Assert<Same<NonNullable<BuildSequenceDiagramRequest["spec"]["messages"]>[number]["style"], "solid" | "dashed" | undefined>>;
        type CanvasRequestVersion = Assert<Same<CreateCanvasRequest["spec"]["version"], 1>>;
      `,
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
		"registers only docs, execute and search, keeps tools/list small, and serves each operation's types on demand",
		() =>
			Effect.gen(function* () {
				const client = yield* registeredClient;
				const tools = yield* client.listTools();
				expect(tools.tools.map((tool) => tool.name).sort()).toEqual(["docs", "execute", "search"]);
				// Every MCP session pays for discovery up front; per-family types come from docs on demand.
				expect(new TextEncoder().encode(JSON.stringify(tools)).byteLength).toBeLessThan(30_000);
				for (const [topic, types] of onDemandTypes) {
					const result = yield* client.callTool({ name: "docs", arguments: { topic } });
					const text = result.content.map((part) => ("text" in part ? part.text : "")).join("\n");
					for (const name of types) expect(text, `${topic} ${name}`).toContain(declaration(name));
				}
			}),
	);
});
