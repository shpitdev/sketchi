import { describe, expect, it } from "vitest";

import ts from "typescript";
import { catalog } from "../mcp-docs/catalog";
import { CODE_MODE_OPERATIONS, generateCodeModeTypes } from "../mcp-docs/types";
import {
	getCodeModeDocs,
	SKETCHI_CODE_MODE_TYPES,
	SKETCHI_EXECUTE_CODE_DESCRIPTION,
	SKETCHI_EXECUTE_DESCRIPTION,
	EXECUTE_DESCRIPTION_LEGACY_WINDOW,
	EXECUTE_DESCRIPTION_WINDOW,
} from "../mcp-docs.server";

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
		// Down from 1,600 once specs and rules no longer repeat between the head and the parameter;
		// editFlowchart and the document format add 96, still inside the 2,048 window. Routing and the
		// flowchart logo rule, which the code parameter states, leave it at 1,382. Naming drawIcon
		// beside searchIcons adds 32; its call and result ride on the code parameter.
		expect(SKETCHI_EXECUTE_DESCRIPTION.length).toBeLessThanOrEqual(1_414);
		expect(SKETCHI_EXECUTE_DESCRIPTION).toContain(
			'The code parameter gives each one\'s spec and rules, so only createCanvas needs docs({ topic: "createCanvas" }) first',
		);
		expect(SKETCHI_EXECUTE_DESCRIPTION).not.toMatch(/^type \w+/m);
		expect(SKETCHI_EXECUTE_DESCRIPTION).not.toContain("spec: {");
		// The code parameter carries a compact flowchart spec and every rule of the buildFlowchart
		// topic, which adds what a build needs only once it fails and the generated request type.
		const flowchartDocs = getCodeModeDocs({ topic: "buildFlowchart" }).content;
		const codeLines = SKETCHI_EXECUTE_CODE_DESCRIPTION.split("\n");
		const flowchartStart = codeLines.findIndex((line) => line.startsWith("buildFlowchart ("));
		const flowchartRules = codeLines.slice(
			flowchartStart + 1,
			codeLines.indexOf("", flowchartStart),
		);
		expect(flowchartRules.length).toBeGreaterThan(10);
		const topicLines = flowchartDocs.split("\n");
		for (const rule of flowchartRules)
			expect(
				topicLines.some((line) => line.startsWith(rule)),
				rule,
			).toBe(true);
		expect(flowchartDocs).toContain(declaration("BuildFlowchartRequest"));
		expect(SKETCHI_EXECUTE_CODE_DESCRIPTION).not.toMatch(/^type \w+/m);
		// Every builder but createCanvas skips the docs turn on one compact line, not its topic. A
		// builder whose name could route a prompt wrongly says what it draws.
		const codeLine = (operation: string) =>
			codeLines.find((line) => new RegExp(`^- ${operation}(?: \\([^)]*\\))?: spec: `).test(line));
		expect(codeLines[flowchartStart]).toMatch(
			/^buildFlowchart \(process steps and decisions[^)]*\): spec: \{ title, direction\?: "TB" \| "LR", curved\?: true, logos\?: true \| "exact", nodes: \{ \[id\]: label/,
		);
		expect(codeLine("buildChart")).toBe(
			'- buildChart: spec: { title, kind: "bar" | "line" | "pie", categories: string[], series: [{ name?, values: number[] }], unit? ("$M", "%"), categoryAxisTitle?, valueAxisTitle?, stacked? (bar), donut? (pie), orientation? ("horizontal", bar) }. Give every series exactly one value per category, in category order, and name every series when there are several. A pie has one series of non-negative values, at most 8 slices and no axis titles.',
		);
		expect(codeLine("buildTimeline")).toBe(
			'- buildTimeline (dated or ordered events): spec: { title, events: [{ id, label, date?, end?, order?, kind?: "milestone", lane? }], lanes?: string[], today? }. Dates keep the prompt\'s precision (YYYY, YYYY-MM, YYYY-MM-DD or ISO time); without dates, give every event a numeric order. end draws a phase, lane a labeled track; today only when given.',
		);
		expect(codeLine("buildSequenceDiagram")).toBe(
			'- buildSequenceDiagram (time-ordered messages): spec: { title, participants: [{ id, label, icon?: { slug } }], messages: [{ source, target, label, type?: "return", style?: "dashed" }] }. Order is kept. Every reply the prompt states, including a redirect back to the caller, is its own type: "return" message from the callee back to its caller; it answers the latest open call between them. A participant\'s own step (validating, retrying) is a self-message with source = target.',
		);
		expect(codeLine("buildStateMachine")).toBe(
			'- buildStateMachine: spec: { title, initial: top-level start state, states: [{ id, label? (defaults to id), kind?: "final" | "choice", parent?: compositeId, initial?: substateId }], transitions: [{ source, target, event?, guard?, action? }] }. A composite (a state named as parent) sets its own initial to its first substate; composites do not nest. Each transition out of a choice has a guard, without brackets: copy each guard the prompt states; use "else" only for a branch the prompt gives no condition. A state that ends the lifecycle is "final" even if something leaves it; Sketchi then draws its own end after it.',
		);
		expect(codeLine("buildMindmap")).toBe(
			'- buildMindmap: spec: { title, root: { label, children?: [{ label, children? }] }, layout?: { direction: "LR" | "RL" } }. Children keep their order.',
		);
		expect(codeLine("buildGantt")).toBe(
			'- buildGantt (project schedules): spec: { title, tasks: [{ id, label, start: "YYYY-MM-DD", end? (last day) | duration? (days), milestone?: true, phase?, dependsOn?: [ids finishing first], progress?: % }], phases?, today? }. Pass a stated duration as duration, not a computed end.',
		);
		expect(codeLine("buildErDiagram")).toBe(
			'- buildErDiagram (database schemas): spec: { title, entities: [{ id, fields: ["id uuid PK", "customer_id uuid FK", "email text UK", "note text?"] }], relationships: [{ from: "orders.customer_id", to: "customers.id", fromCardinality: "zero-or-many", toCardinality: "one", label? }] }. Each cardinality is "one", "zero-or-one", "many", "one-or-many" or "zero-or-many": how many rows of that end relate to one row of the other end.',
		);
		expect(codeLine("buildClassDiagram")).toBe(
			'- buildClassDiagram: spec: { title, classes: [{ id, kind?: "abstract" | "interface" | "enum", attributes?: ["- id: UUID"], methods?: ["+ area(): double {abstract}"] }], relationships: [{ kind, from, to, fromMultiplicity?, toMultiplicity?, fromRole?, toRole?, navigable?, label? }] }. kind "inheritance" or "realization": from extends or implements to; "composition" or "aggregation": from is the whole; "association"; "dependency": from uses to. Multiplicities ("1", "0..*") and roles go on compositions, aggregations and associations only.',
		);
		const classDocs = getCodeModeDocs({ topic: "buildClassDiagram" }).content;
		expect(SKETCHI_EXECUTE_CODE_DESCRIPTION).not.toContain(classDocs.split("\n\n")[0]);
		expect(classDocs.split("Request type:")[0]).toContain(
			'Write each member as UML does: attributes "- radius: double"',
		);
		// Org charts add a builder name to the head and one compact line here (+385 characters).
		expect(codeLine("buildOrgChart")).toBe(
			"- buildOrgChart: spec: { title, people: [{ id, name, title?, department?, manager?, assistant?: true }], dottedLines?: [{ report, manager, label?: stated scope }], groupByDepartment? }. manager is the id they report to; only the top person has none (forest: true for several).",
		);
		const orgChartDocs = getCodeModeDocs({ topic: "buildOrgChart" }).content;
		expect(SKETCHI_EXECUTE_CODE_DESCRIPTION).not.toContain(orgChartDocs.split("\n\n")[0]);
		expect(orgChartDocs.split("Request type:")[0]).toContain(
			"report also answers to manager, outside the solid line",
		);
		// Venn diagrams add a builder name to the head and one compact line here.
		expect(codeLine("buildVennDiagram")).toBe(
			'- buildVennDiagram: spec: { title, sets: [{ id, label }], regions: [{ sets: [ids], items?: string[], count? }] }. A region lies in exactly its sets: ["a"] is a only, ["a", "b"] is a and b but not c. Omit empty regions.',
		);
		const vennDocs = getCodeModeDocs({ topic: "buildVennDiagram" }).content;
		expect(SKETCHI_EXECUTE_CODE_DESCRIPTION).not.toContain(vennDocs.split("\n\n")[0]);
		expect(vennDocs.split("Request type:")[0]).toContain(
			"Give a region items (short phrases) or a count, never both.",
		);
		// Journey maps add a builder name to the head, an index line and one compact line here
		// (+367 characters, +94 o200k tokens).
		expect(codeLine("buildJourneyMap")).toBe(
			"- buildJourneyMap: spec: { title, persona?, stages: [{ name, steps: [{ label, score, actor?, touchpoint? }], painPoints?, opportunities? }] }. score is a whole number from 1 (very negative) to 5 (very positive); 3 is neutral.",
		);
		const journeyDocs = getCodeModeDocs({ topic: "buildJourneyMap" }).content;
		expect(SKETCHI_EXECUTE_CODE_DESCRIPTION).not.toContain(journeyDocs.split("\n\n")[0]);
		expect(journeyDocs.split("Request type:")[0]).toContain(
			"touchpoint is the channel (Email, Website, Phone)",
		);
		// Sankey diagrams add a builder name to the head and one compact line here (+304 characters).
		expect(codeLine("buildSankey")).toBe(
			'- buildSankey: spec: { title, nodes: [{ id, label }], links: [{ source, target, value, label? }], unit? ("$k", "visits") }. value is the stated amount (> 0); links run one way; add no balancing node.',
		);
		const sankeyDocs = getCodeModeDocs({ topic: "buildSankey" }).content;
		expect(SKETCHI_EXECUTE_CODE_DESCRIPTION).not.toContain(sankeyDocs.split("\n\n")[0]);
		expect(sankeyDocs.split("Request type:")[0]).toContain("A band under 3 px draws at 3 px");
		// Wireframes add a builder name to the head and one compact line here (+807 characters).
		expect(codeLine("buildWireframe")).toBe(
			'- buildWireframe (UI mockups): spec: { title, screens: [{ name, device: "desktop" | "tablet" | "mobile", children }] }. Containers (children, title?): header, footer (at the bottom), sidebar, main, section, card, modal, column, row (align?: "between" | "center" | "end"), grid (columns: n). Widgets: heading (text, level?), text (text or lines), badge (text), link (text, target?: screen id), button (text, variant?, target?), input, textarea, select, search (label?, placeholder?, value?), checkbox, radio, toggle (label, checked?), tabs, nav (items, active?), breadcrumbs, list (items), avatar, icon, image, chart (label?), table (columns: string[]), divider. Set variant "primary", checked and active as stated.',
		);
		const wireframeDocs = getCodeModeDocs({ topic: "buildWireframe" }).content;
		expect(SKETCHI_EXECUTE_CODE_DESCRIPTION).not.toContain(wireframeDocs.split("\n\n")[0]);
		expect(wireframeDocs.split("Request type:")[0]).toContain("A nav inside a sidebar stacks");
		// Quadrant charts add a builder name to the head and one compact line here (+508 characters).
		expect(codeLine("buildQuadrantChart")).toBe(
			"- buildQuadrantChart (2\u00d72 matrices): spec: { title, xAxis: { title, low, high }, yAxis: same, quadrants: { topLeft, topRight, bottomLeft, bottomRight }, points: [{ label, x, y, group? }] }. low and high are the axis end labels as stated (x left to right, y bottom up); name each quadrant by the corner its conditions describe; x and y run 0 (low end) to 1 (high end), so a score out of 100 is score / 100.",
		);
		const quadrantDocs = getCodeModeDocs({ topic: "buildQuadrantChart" }).content;
		expect(SKETCHI_EXECUTE_CODE_DESCRIPTION).not.toContain(quadrantDocs.split("\n\n")[0]);
		expect(quadrantDocs.split("Request type:")[0]).toContain(
			"An axis may run from Urgent to Not urgent when the prompt draws it that way",
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

			Return categories (x-axis labels, or pie slice names) and series: [{ name, values }] with exactly one value per category, in category order. Name every series when there are several. A pie has exactly one series of non-negative values and at most 8 slices. Bars and lines allow negative values, up to 40 categories and 6 series.

			Copy every number, category, series name, unit and axis title from the prompt; invent none. Never round data. unit labels ticks and values: currency symbols lead ("$", "$M"), others follow ("%", "ms", "k").

			"
		`);
		expect(stateMachineDocs.split("Request type:")[0]).toMatchInlineSnapshot(`
			"buildStateMachine accepts { spec: { id?, title, initial, states: [{ id, label?, kind?, parent?, initial? }], transitions: [{ id?, source, target, event?, guard?, action? }], layout?: { direction } }, options? }. Omit layout to let the renderer pick LR or TB.

			Every state has a unique id without ":". A regular state label defaults to its id verbatim; explicit labels must not be blank. initial is the top-level state the machine starts in. kind "final" ends the machine: name it when it is a named outcome (for example Failed); generic ends need no name; kind "choice" is a branch point whose outgoing transitions each carry a guard: copy each guard the prompt states; use "else" only for a branch the prompt gives no condition. A composite state is a state other states name as parent; give it initial, the substate it starts in. Composites do not nest.

			Every transition has a unique id, source, target, and optional event, guard (the condition, without brackets) and action. A transition may leave or enter a composite, or return to its own state. Every state must be reachable from initial. A state that ends the lifecycle is "final" even if something leaves it; Sketchi then draws its own end after it.

			"
		`);
		expect(ganttDocs.split("Request type:")[0]).toMatchInlineSnapshot(`
			"buildGantt accepts { spec: { id?, title, tasks: [{ id, label, start, end?, duration?, milestone?, phase?, dependsOn?, progress? }], phases?, today? }, options? }. The renderer owns layout: a to-scale date axis, one row per task under phase headers, and dependency arrows.

			Return tasks with unique id, label, start (YYYY-MM-DD), and end (last day, inclusive) or duration (calendar days counting start). A milestone is milestone: true with start only. Never supply coordinates. Optional: dependsOn lists the ids of tasks that must finish first; phase names a header for every task only when the prompt itself names phases; otherwise omit it (phases sets their order); progress is percent complete; today only when stated. Use 1–60 tasks, at most 12 phases, and no dependency cycles.

			Pass a stated duration as duration, not a computed end. Copy every task, date, dependency, milestone and phase from the prompt; invent none. A task that starts before a predecessor finishes still builds, with a gantt_schedule_conflict warning.

			"
		`);
		// Every request pays for this parameter on every turn. Five families took it from 10,548
		// characters to 12,976; a compact flowchart spec in place of its generated types, one shared
		// copy rule, no separate builder index and failure-only detail left to the topics take it to
		// 9,862, under where it stood before them. The flowchart label rule, needed once Sol pasted
		// prompt clauses as labels, and moving the copy rule onto the other builders add 190 (+46
		// o200k tokens). Node colors and the editFlowchart line add 712, so an edit takes one execute
		// and no docs turn. The label-scope rule and the two-product split add 331, for labels that
		// add conditions or drop their doer and entry steps that lose a logo. Merging rules that
		// repeat the spec or each other takes it from 11,084 to 10,427. The request line adds 89, so
		// a build can name the stated arrows and zones it misses. The drawIcon line adds 61, so an
		// agent can draw a logo the catalog lacks. Lower this budget; do not raise it.
		expect(SKETCHI_EXECUTE_CODE_DESCRIPTION.length).toBeLessThan(10_580);
		// The overview keeps every builder's summary; the code parameter names every builder once.
		const overview = getCodeModeDocs({ topic: "overview" }).content;
		for (const operation of CODE_MODE_OPERATIONS.filter((name) =>
			/^(build|createCanvas)/.test(name),
		)) {
			expect(overview).toMatch(new RegExp(`^- ${operation}: `, "m"));
			expect(
				codeLines.filter((line) => new RegExp(`^(- )?${operation}\\b`).test(line)),
				operation,
			).toHaveLength(1);
		}
		expect(overview).toContain(`${CODE_MODE_OPERATIONS.length} operations:`);
		for (const operation of CODE_MODE_OPERATIONS) {
			expect(SKETCHI_EXECUTE_DESCRIPTION).toContain(operation);
			expect(overview).toContain(operation);
		}
		for (const [topic, types] of [
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
});
