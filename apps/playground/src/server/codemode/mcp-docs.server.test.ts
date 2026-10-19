import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import ts from "typescript";
import { catalog } from "./mcp-docs/catalog";
import { CODE_MODE_OPERATIONS, generateCodeModeTypes, jsonSchemaType } from "./mcp-docs/types";
import { DIAGRAM_PATCH_OPERATION_NAMES } from "@sketchi/diagram-agent";
import {
	getCodeModeDocs,
	searchCodeModeDocs,
	SKETCHI_CODE_MODE_TYPES,
	SKETCHI_CODE_MODE_VERSION,
	SKETCHI_EXECUTE_CODE_DESCRIPTION,
	SKETCHI_EXECUTE_DESCRIPTION,
	EXECUTE_DESCRIPTION_LEGACY_WINDOW,
	EXECUTE_DESCRIPTION_WINDOW,
} from "./mcp-docs.server";

// Hang guard for the full schema walk, not a speed budget.
describe("Code Mode MCP docs", { timeout: 60_000 }, () => {
	it("does not advertise palette inputs in docs, examples, or search", () => {
		for (const entry of catalog) {
			const docs = getCodeModeDocs({ topic: entry.topic });
			const search = searchCodeModeDocs({ query: entry.id, limit: 20 });
			const prose = docs.content
				.split("\n")
				.filter((line) => !line.startsWith("type "))
				.join("\n");
			expect(JSON.stringify({ prose, examples: docs.examples, search })).not.toMatch(
				/optional style|top-level style|style:\s*\{\s*accentColor/,
			);
		}
		for (const topic of ["buildFlowchart", "buildMindmap", "buildSequenceDiagram"] as const) {
			expect(getCodeModeDocs({ topic }).content).toContain("fixed Sketchi palette");
		}
	});

	it("documents the harness-first execute contract", () => {
		const docs = getCodeModeDocs({ topic: "execute" });

		expect(docs.content).toContain("typed host tools");
		expect(docs.content).toContain("sketchi.buildFlowchart");
		expect(docs.content).toContain("sketchi.buildMindmap");
		expect(docs.content).toContain("sketchi.buildSequenceDiagram");
		expect(docs.content).toContain("sketchi.getArtifact");
		expect(docs.content).toContain("sketchi.applyDiagramPatch");
		expect(docs.content).toContain("Excalidraw and PNG URLs");
		expect(docs.content).toContain("artifactDelivery");
		expect(docs.content).toContain("finalResponseText");
		expect(docs.content).toContain("Do not synthesize a Mermaid");
		expect(docs.content).toContain("Do not call file/create/artifact tools");
		expect(docs.examples.map((example) => example.code)).not.toEqual(
			expect.arrayContaining([expect.stringMatching(/};\s*$/)]),
		);
		expect(docs.examples).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					title: "Accepted graph followed by visual patch",
				}),
			]),
		);
	});

	it("emits a complete semantic-builder public type contract", () => {
		expect(SKETCHI_CODE_MODE_VERSION).toBe("2026-09-04");
		for (const operation of [
			"BuildFlowchart",
			"BuildMindmap",
			"BuildSequenceDiagram",
			"CreateCanvas",
			"GetArtifact",
			"ApplyDiagramPatch",
		]) {
			expect(SKETCHI_CODE_MODE_TYPES).toContain(`type ${operation}Request =`);
			expect(SKETCHI_CODE_MODE_TYPES).toContain(`type ${operation}Result =`);
		}
		for (const issueCode of ["nonterminating_node", "flowchart_too_large", "request_too_large"]) {
			expect(SKETCHI_CODE_MODE_TYPES).toContain(`"${issueCode}"`);
		}
		for (const operation of [
			"buildFlowchart",
			"buildMindmap",
			"buildSequenceDiagram",
			"createCanvas",
			"getArtifact",
			"applyDiagramPatch",
		]) {
			expect(SKETCHI_CODE_MODE_TYPES).toContain(`${operation}(`);
			expect(getCodeModeDocs({ topic: "overview" }).content).toContain(operation);
			expect(getCodeModeDocs({ topic: "execute" }).content).toContain(operation);
		}
		expect(getCodeModeDocs({ topic: "buildMindmap" }).content).toContain(
			"Do not supply coordinates, edges, or Excalidraw JSON",
		);
		expect(getCodeModeDocs({ topic: "buildMindmap" }).content).toContain(
			"intentional output formats",
		);
		const sequenceDocs = getCodeModeDocs({ topic: "buildSequenceDiagram" });
		expect(sequenceDocs.content).toContain("preserved left-to-right");
		expect(sequenceDocs.content).toContain("preserved top-to-bottom");
		expect(sequenceDocs.content).toContain("Self-referential messages");
		expect(sequenceDocs.examples[0]?.code).toContain("sketchi.buildSequenceDiagram");
		const canvasDocs = getCodeModeDocs({ topic: "createCanvas" });
		expect(canvasDocs.content).toContain("never raw Excalidraw JSON");
		expect(canvasDocs.examples[0]?.code).toContain("sketchi.createCanvas");
	});

	it("pins every generated field, optionality, literal and recursive reference to the package schemas", async () => {
		const generated = generateCodeModeTypes();
		expect(SKETCHI_CODE_MODE_TYPES).toBe(generated);
		await expect(generated).toMatchFileSnapshot(
			`${process.cwd()}/apps/playground/src/server/codemode/mcp-docs/code-mode-types.generated.txt`,
		);
		const source = ts.createSourceFile(
			"code-mode-types.ts",
			`${generated}
        type Assert<T extends true> = T;
        type Same<A, B> = [A] extends [B] ? [B] extends [A] ? true : false : false;
        type OptionalKeys<T> = {
          [K in keyof T]-?: {} extends Pick<T, K> ? K : never
        }[keyof T];
        type FlowchartRequestDefaults = Assert<
          "edges" | "layout" extends OptionalKeys<BuildFlowchartRequest["spec"]> ? true : false
        >;
        type FlowchartResultDefaults = Assert<
          Extract<OptionalKeys<Extract<BuildFlowchartResult, { ok: true }>["normalizedSpec"]>, "edges" | "layout" | "style"> extends never ? true : false
        >;
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

	it("reflects field-level schema changes and rejects unsupported shapes", () => {
		expect(
			jsonSchemaType(
				{
					type: "object",
					additionalProperties: false,
					properties: { label: { type: "string" } },
					required: ["label"],
				},
				"Test",
			),
		).toBe("{ label: string; }");
		expect(
			jsonSchemaType(
				{
					type: "object",
					additionalProperties: false,
					properties: { label: { type: "number" }, "data-id": { type: "string" } },
				},
				"Test",
			),
		).toBe('{ label?: number; "data-id"?: string; }');
		// JSON spells non-finite numbers as strings; sandbox values are plain numbers.
		expect(
			jsonSchemaType(
				{ anyOf: [{ type: "number" }, { type: "string", enum: ["NaN", "Infinity", "-Infinity"] }] },
				"Test",
			),
		).toBe("number");
		const shared = new Map([['{"type":"string"}', "Label"]]);
		expect(
			jsonSchemaType(
				{
					type: "object",
					additionalProperties: false,
					properties: { label: { type: "string" } },
					required: ["label"],
				},
				"Test",
				shared,
			),
		).toBe("{ label: Label; }");
		expect(() => jsonSchemaType({ type: "future" }, "Test")).toThrow(
			"Unsupported Code Mode JSON Schema type",
		);
	});

	it("keeps the published catalog complete for bounded build failures", () => {
		const catalog = readFileSync("docs/mcp-tool-catalog.md", "utf8");
		for (const declaration of [
			"interface BuildMindmapRequest",
			"type BuildMindmapResult",
			"interface BuildSequenceDiagramRequest",
			"buildSequenceDiagram",
			"createCanvas",
			"CreateCanvasRequest",
			'"request_too_large"',
			'"nonterminating_node"',
			'"flowchart_too_large"',
			'"mindmap_too_deep"',
			'"mindmap_too_large"',
		]) {
			expect(catalog).toContain(declaration);
		}
		expect(catalog).toContain("arbitrary typed canvas artifact");
		expect(catalog).toContain("CanvasSpec v1");
		expect(catalog).toContain("24 nodes");
		expect(catalog).toContain("64 edges");
		expect(catalog).toContain("256 KiB");
	});

	it("searches operation guidance and non-goals", () => {
		const patchResults = searchCodeModeDocs({
			query: "purple diamond selector",
		});
		expect(patchResults.results.map((result) => result.id)).toContain("applyDiagramPatch");

		const logoResults = searchCodeModeDocs({ query: "brand logo" });
		expect(logoResults.results.map((result) => result.id)).toContain("searchIcons");
		expect(getCodeModeDocs({ topic: "buildFlowchart" }).content).toContain("sketchi.searchIcons");
		expect(SKETCHI_CODE_MODE_TYPES).toContain(
			"searchIcons(input: SearchIconsRequest): Promise<SearchIconsResult>;",
		);

		const managedResults = searchCodeModeDocs({
			query: "convex managed threads",
		});
		expect(managedResults.results.map((result) => result.id)).toContain("managed-thread-non-goal");

		const finalArtifactResults = searchCodeModeDocs({
			query: "do not create markdown mermaid final artifact url",
		});
		expect(finalArtifactResults.results.map((result) => result.id)).toContain(
			"no-mermaid-wrapper-non-goal",
		);

		const boundedFlowchartResults = searchCodeModeDocs({
			query: "nonterminating cycle 24 nodes 64 edges request_too_large",
		});
		expect(boundedFlowchartResults.results.map((result) => result.id)).toEqual(
			expect.arrayContaining(["buildFlowchart", "issues"]),
		);

		// Package and system interaction prompts are flowcharts, not hand-placed canvases.
		const architectureResults = searchCodeModeDocs({
			query: "architecture packages agent core renderer excalidraw hosted artifact response",
		});
		expect(architectureResults.results[0]?.id).toBe("buildFlowchart");
		expect(SKETCHI_EXECUTE_DESCRIPTION).toContain(
			"Use buildFlowchart for system/package interactions.",
		);
		expect(SKETCHI_EXECUTE_DESCRIPTION).toContain(
			"createCanvas is a last resort for layouts no builder covers.",
		);
		expect(SKETCHI_EXECUTE_CODE_DESCRIPTION).toMatch(
			/- buildFlowchart: [^\n]*systems or packages interact/,
		);
		expect(SKETCHI_EXECUTE_CODE_DESCRIPTION).toMatch(
			/- createCanvas: [^\n]*only for layouts no builder/,
		);

		const sequenceResults = searchCodeModeDocs({
			query: "chronological participant lifeline messages",
		});
		expect(sequenceResults.results.map((result) => result.id)).toContain("buildSequenceDiagram");
	});

	it("documents importable Excalidraw artifact URLs", () => {
		const docs = getCodeModeDocs({ topic: "getArtifact" });

		expect(docs.content).toContain("importable Excalidraw file JSON");
		expect(docs.content).toContain("url fields");
		expect(docs.content).toContain("format=excalidraw&raw=true");
		expect(docs.content).toContain("format=png&raw=true");
	});

	it("documents broad architecture prompt shaping", () => {
		const docs = getCodeModeDocs({ topic: "buildFlowchart" });

		expect(docs.content).toContain("broad or vague repo/system architecture");
		expect(docs.content).toContain("8-14 high-signal nodes");
		expect(docs.content).toContain("single readable spine");
		expect(docs.content).toContain("group related packages into layers");
		expect(docs.content).toContain("24 nodes");
		expect(docs.content).toContain("64 edges");
		expect(docs.content).toContain("nonterminating_node");
		// The 256 KiB limit applies to Studio HTTP requests, so it lives with the other issue hints.
		expect(getCodeModeDocs({ topic: "issues" }).content).toContain("request_too_large");
	});

	it("keeps tools/list small and serves each family's generated types on demand", () => {
		const declarations = SKETCHI_CODE_MODE_TYPES.split("\n\n");
		const declaration = (name: string) => {
			const found = declarations.find((block) => block.startsWith(`type ${name} = `));
			if (!found) throw new Error(`Missing generated declaration ${name}`);
			return found.trim();
		};
		// Claude Code cuts upfront-loaded tool descriptions at 4096 characters (2048 before v2.1.296)
		// but not parameter descriptions. The description is a head that fits the older window; the
		// code parameter carries each builder's spec and rules once, so no client pays for them twice.
		expect(EXECUTE_DESCRIPTION_WINDOW).toBe(4096);
		expect(EXECUTE_DESCRIPTION_LEGACY_WINDOW).toBe(2048);
		expect(SKETCHI_EXECUTE_DESCRIPTION.length).toBeLessThanOrEqual(1_600);
		expect(SKETCHI_EXECUTE_DESCRIPTION).toContain(
			'The code parameter gives each one\'s spec and rules, so only createCanvas needs docs({ topic: "createCanvas" }) first',
		);
		expect(SKETCHI_EXECUTE_DESCRIPTION).not.toMatch(/^type \w+/m);
		expect(SKETCHI_EXECUTE_DESCRIPTION).not.toContain("spec: {");
		// The code parameter carries the buildFlowchart topic verbatim, its generated request type and
		// no other family's types.
		const flowchartDocs = getCodeModeDocs({ topic: "buildFlowchart" }).content;
		expect(SKETCHI_EXECUTE_CODE_DESCRIPTION).toContain(`buildFlowchart:\n${flowchartDocs}\n`);
		for (const name of ["BuildFlowchartRequest", "BuildOptions"]) {
			expect(SKETCHI_EXECUTE_CODE_DESCRIPTION).toContain(`\n${declaration(name)}`);
		}
		expect(SKETCHI_EXECUTE_CODE_DESCRIPTION.match(/^type \w+/gm)).toEqual([
			"type BuildFlowchartRequest",
			"type BuildOptions",
		]);
		// Every other builder but createCanvas skips the docs turn on one compact line, not its topic.
		const codeLine = (operation: string) =>
			SKETCHI_EXECUTE_CODE_DESCRIPTION.split("\n").find((line) =>
				line.startsWith(`- ${operation}: spec: `),
			);
		expect(codeLine("buildChart")).toBe(
			'- buildChart: spec: { title, kind: "bar" | "line" | "pie", categories: string[], series: [{ name?, values: number[] }], unit? ("$M", "%"), categoryAxisTitle?, valueAxisTitle?, stacked? (bar), donut? (pie), orientation? ("horizontal", bar) }. Give every series exactly one value per category, in category order, and name every series when there are several. A pie has one series of non-negative values, at most 8 slices and no axis titles. Copy every number, category, series name, unit and axis title from the prompt; invent none.',
		);
		expect(codeLine("buildTimeline")).toBe(
			'- buildTimeline: spec: { title, events: [{ id, label, date?, end?, order?, kind?: "milestone", lane? }], lanes?: string[], today? }. Dates keep the prompt\'s precision (YYYY, YYYY-MM, YYYY-MM-DD or ISO time); without dates, give every event a numeric order. end draws a phase, lane a labeled track; today only when given. Invent no events or dates.',
		);
		expect(codeLine("buildSequenceDiagram")).toBe(
			'- buildSequenceDiagram: spec: { title, participants: [{ id, label, icon?: { slug } }], messages: [{ source, target, label, type?: "return", style?: "dashed" }] }. Order is kept. Every reply the prompt states, including a redirect back to the caller, is its own type: "return" message from the callee back to its caller; it answers the latest open call between them, and calls nobody answers draw no bar. source and target are distinct participant ids, so an action inside one participant ("the user logs in") is a message from the participant that triggers it.',
		);
		expect(codeLine("buildStateMachine")).toBe(
			'- buildStateMachine: spec: { title, initial, states: [{ id, label?, kind?: "final" | "choice", parent?: compositeId, initial?: substateId }], transitions: [{ source, target, event?, guard?, action? }] }. A regular state label defaults to its id verbatim. spec.initial is the top-level start state. A state named as parent is a composite: set initial on the composite itself to its first substate id; composites do not nest. Every outgoing transition of a choice has a guard, without brackets; one may be "else". kind "final" (label optional) ends the machine and nothing leaves it. A state that ends the machine but has other outgoing transitions also gets a transition to a final state.',
		);
		expect(codeLine("buildMindmap")).toBe(
			'- buildMindmap: spec: { title, root: { label, children?: [{ label, children? }] }, layout?: { direction: "LR" | "RL" } }. Children keep their order.',
		);
		expect(codeLine("buildGantt")).toBe(
			'- buildGantt: spec: { title, tasks: [{ id, label, start: "YYYY-MM-DD", end? (last day) | duration? (days), milestone?: true, phase?, dependsOn?: [ids finishing first], progress?: % }], phases?, today? }. Pass a stated duration as duration, not a computed end. Copy every task, date, dependency, milestone and phase from the prompt; invent none.',
		);
		expect(codeLine("buildErDiagram")).toBe(
			'- buildErDiagram: spec: { title, entities: [{ id, fields: ["id uuid PK", "customer_id uuid FK", "email text UK", "note text?"] }], relationships: [{ from: "orders.customer_id", to: "customers.id", fromCardinality: "zero-or-many", toCardinality: "one", label? }] }. Cardinalities: "one", "zero-or-one", "many", "one-or-many", "zero-or-many", each how many rows of its end match one row of the other. Copy every table, field, type, key and cardinality stated.',
		);
		expect(codeLine("buildClassDiagram")).toBe(
			'- buildClassDiagram: spec: { title, classes: [{ id, kind?: "abstract" | "interface" | "enum", attributes?: ["- id: UUID"], methods?: ["+ area(): double {abstract}"] }], relationships: [{ kind, from, to, fromMultiplicity?, toMultiplicity?, fromRole?, toRole?, navigable?, label? }] }. kind "inheritance" or "realization": from extends or implements to; "composition" or "aggregation": from is the whole; "association"; "dependency": from uses to. Multiplicities ("1", "0..*") and roles go on compositions, aggregations and associations only. Copy every class, member and relationship stated.',
		);
		const classDocs = getCodeModeDocs({ topic: "buildClassDiagram" }).content;
		expect(SKETCHI_EXECUTE_CODE_DESCRIPTION).not.toContain(classDocs.split("\n\n")[0]);
		expect(classDocs.split("Request type:")[0]).toContain(
			'A member is one string as UML writes it: attributes "- radius: double"',
		);
		// Org charts add a builder name to the head and one compact line here (+385 characters).
		expect(codeLine("buildOrgChart")).toBe(
			"- buildOrgChart: spec: { title, people: [{ id, name, title?, department?, manager?, assistant?: true }], dottedLines?: [{ report, manager, label?: stated scope }], groupByDepartment? }. manager is the id they report to; only the top person has none (forest: true for several). Copy every person, title, department and line stated.",
		);
		const orgChartDocs = getCodeModeDocs({ topic: "buildOrgChart" }).content;
		expect(SKETCHI_EXECUTE_CODE_DESCRIPTION).not.toContain(orgChartDocs.split("\n\n")[0]);
		expect(orgChartDocs.split("Request type:")[0]).toContain(
			"A dotted line joins report to a second manager outside the solid line",
		);
		expect(codeLine("createCanvas")).toBeUndefined();
		for (const topic of ["buildMindmap", "buildSequenceDiagram", "buildTimeline"] as const) {
			const guidance = getCodeModeDocs({ topic }).content.split("\n")[0]!;
			expect(SKETCHI_EXECUTE_CODE_DESCRIPTION, topic).not.toContain(guidance);
		}
		const chartDocs = getCodeModeDocs({ topic: "buildChart" }).content;
		const stateMachineDocs = getCodeModeDocs({ topic: "buildStateMachine" }).content;
		const ganttDocs = getCodeModeDocs({ topic: "buildGantt" }).content;
		expect(SKETCHI_EXECUTE_CODE_DESCRIPTION).not.toContain(ganttDocs.split("\n\n")[0]);
		const erDocs = getCodeModeDocs({ topic: "buildErDiagram" }).content;
		expect(SKETCHI_EXECUTE_CODE_DESCRIPTION).not.toContain(erDocs.split("\n\n")[0]);
		expect(erDocs.split("Request type:")[0]).toContain(
			'An order has one customer and a customer zero or many orders: from "orders.customer_id", fromCardinality "zero-or-many", to "customers.id", toCardinality "one".',
		);
		expect(SKETCHI_EXECUTE_CODE_DESCRIPTION).not.toContain(chartDocs.split("\n\n")[0]);
		expect(SKETCHI_EXECUTE_CODE_DESCRIPTION).not.toContain(stateMachineDocs.split("\n\n")[0]);
		// Models that still call docs get the same guidance.
		expect(chartDocs.split("Request type:")[0]).toMatchInlineSnapshot(`
			"buildChart accepts { spec: { id?, title, kind, categories, series: [{ name?, values }], unit?, categoryAxisTitle?, valueAxisTitle?, stacked?, donut?, orientation? }, options? }. The renderer owns layout: nice ticks, value labels, legend and pie leader lines.

			kind "bar" compares categories (stacked: true stacks the series; long names turn bars horizontal, or set orientation), "line" shows change across ordered categories, "pie" splits one whole (donut: true for a ring).

			Give every series exactly one value per category, in category order, and name every series when there are several. A pie has one series of non-negative values and at most 8 slices; bars and lines take negatives, up to 40 categories and 6 series.

			Copy every number, category, series name, unit and axis title from the prompt; invent none. unit labels ticks and values: currency symbols lead ("$", "$M"), others follow ("%", "ms", "k").

			"
		`);
		expect(stateMachineDocs.split("Request type:")[0]).toMatchInlineSnapshot(`
			"buildStateMachine accepts { spec: { id?, title, initial, states: [{ id, label?, kind?, parent?, initial? }], transitions: [{ id?, source, target, event?, guard?, action? }], layout?: { direction } }, options? }. Omit layout to let the renderer pick LR or TB.

			A regular state label defaults to its id verbatim; an explicit blank label is invalid. initial is the top-level state the machine starts in. kind "final" ends the machine: name it when it is a named outcome (for example Failed); generic ends need no name; kind "choice" is a diamond whose outgoing transitions each carry a guard; one may be "else". States other states name as parent form a composite, drawn as a frame around them: give it initial, its first substate. Composites do not nest.

			A transition is drawn event [guard] / action; write the guard without brackets. It may leave or enter a composite, or return to its own state. Every state must be reachable from initial, and final states have no outgoing transitions. A state that ends the machine but has other outgoing transitions also gets a transition to a final state.

			"
		`);
		expect(ganttDocs.split("Request type:")[0]).toMatchInlineSnapshot(`
			"buildGantt accepts { spec: { id?, title, tasks: [{ id, label, start, end?, duration?, milestone?, phase?, dependsOn?, progress? }], phases?, today? }, options? }. The renderer owns layout: a to-scale date axis, one row per task under phase headers, and dependency arrows.

			start and end are YYYY-MM-DD; end is the last day, inclusive. Give end or duration (calendar days counting start), not both. milestone: true draws a diamond on start. dependsOn lists finish-to-start predecessor ids, without cycles. Give every task a phase or none (phases sets their order). progress is percent done; today only when stated. Up to 60 tasks and 12 phases.

			Pass a stated duration as duration, not a computed end. Copy every task, date, dependency, milestone and phase from the prompt; invent none. A task that starts before a predecessor finishes still builds, with a gantt_schedule_conflict warning.

			"
		`);
		// Family summaries now live beside the specs, outside the truncated head.
		// Nested zones, infrastructure shapes and their logo rule add spec fields and docs (#476).
		expect(SKETCHI_EXECUTE_CODE_DESCRIPTION.length).toBeLessThan(10_650);
		const overview = getCodeModeDocs({ topic: "overview" }).content;
		for (const line of overview
			.split("\n")
			.filter((line) => /^- (build\w+|createCanvas):/.test(line))) {
			expect(SKETCHI_EXECUTE_CODE_DESCRIPTION).toContain(line);
		}
		expect(overview).toContain(`${CODE_MODE_OPERATIONS.length} operations:`);
		for (const operation of CODE_MODE_OPERATIONS) {
			expect(SKETCHI_EXECUTE_DESCRIPTION).toContain(operation);
			expect(overview).toContain(operation);
		}
		for (const [topic, types] of [
			["buildFlowchart", ["BuildFlowchartRequest", "BuildOptions"]],
			["buildMindmap", ["BuildMindmapRequest", "BuildMindmapRequest___schema0"]],
			["buildSequenceDiagram", ["BuildSequenceDiagramRequest"]],
			["buildTimeline", ["BuildTimelineRequest"]],
			["buildGantt", ["BuildGanttRequest"]],
			["buildErDiagram", ["BuildErDiagramRequest"]],
			["buildClassDiagram", ["BuildClassDiagramRequest"]],
			["buildOrgChart", ["BuildOrgChartRequest"]],
			["createCanvas", ["CreateCanvasRequest", "CanvasSpecInput", "CanvasElement"]],
			["getArtifact", ["GetArtifactRequest"]],
			["applyDiagramPatch", ["ApplyDiagramPatchRequest", "DiagramSelector"]],
			["issues", ["Issue", "IssueCode", "IssueRef"]],
		] as const) {
			const content = getCodeModeDocs({ topic }).content;
			for (const name of types) expect(content, `${topic} ${name}`).toContain(declaration(name));
		}
		expect(getCodeModeDocs({ topic: "execute" }).content).toContain(SKETCHI_CODE_MODE_TYPES);
		// Guidance comes first so models weigh it before the reference types.
		for (const topic of ["buildFlowchart", "buildSequenceDiagram", "createCanvas"] as const) {
			const [guidance] = getCodeModeDocs({ topic }).content.split("Request type:");
			expect(guidance?.trim(), topic).not.toBe("");
		}
		// Inline exports are paid for on every later turn; examples deliver URLs instead.
		for (const entry of catalog) {
			for (const example of entry.examples ?? []) {
				expect(example.code, example.title).not.toMatch(/inlineArtifacts: \[\s*"/);
			}
		}
	});

	it("documents patch envelopes and operation names for harness discovery", () => {
		const docs = getCodeModeDocs({ topic: "applyDiagramPatch" });

		expect(docs.content).toContain("source: { artifactId");
		expect(docs.content).toContain("Supported operation names");
		expect(docs.content).toContain("replaceText");
		expect(docs.content).toContain("strokeColor");
		expect(docs.content).toContain("type ApplyDiagramPatchRequest =");
		expect(docs.content).toContain('"png"');
		expect(docs.content).toContain("hosted visual proof");
		expect(docs.content).not.toContain("{ excalidraw: unknown }");
		expect(docs.content).not.toContain('format?: "scene" | "excalidraw"');
		expect(docs.examples).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: expect.stringContaining('op: "replaceText"'),
				}),
			]),
		);

		const operationResults = searchCodeModeDocs({
			query: "setText setLabel rename label operation",
		});
		expect(operationResults.results.map((result) => result.id)).toContain("patchOperations");

		const operationDocs = getCodeModeDocs({ topic: "patchOperations" });
		for (const operationName of DIAGRAM_PATCH_OPERATION_NAMES) {
			expect(operationDocs.content).toContain(operationName);
			expect(operationDocs.examples.map((example) => example.code).join("\n")).toContain(
				operationName,
			);
		}
	});
});
