import { createTreeWithEmptyWorkspace } from "@nx/devkit/testing";
import type { Tree } from "@nx/devkit";
import { runInNewContext } from "node:vm";
import ts from "typescript";

import { diagramTypeGenerator } from "./diagram-type";
import type { DiagramTypeGeneratorSchema } from "./schema";

describe("diagram-type generator", () => {
	let tree: Tree;
	const options: DiagramTypeGeneratorSchema = {
		name: "timeline",
		title: "Generated timeline",
		skipFormat: true,
	};

	beforeEach(() => {
		tree = createTreeWithEmptyWorkspace();
		tree.write(
			"packages/diagram/core/src/types.ts",
			`export const DIAGRAM_TYPES = ["flowchart", "mindmap", "sequence"] as const;

export type DiagramTypeValue = (typeof DIAGRAM_TYPES)[number];

export const GRAPH_DIAGRAM_TYPES = [
	"flowchart",
	"mindmap",
] as const satisfies readonly DiagramTypeValue[];
`,
		);
		tree.write("packages/diagram/core/src/index.ts", "");
	});

	function registry(name: string): string[] {
		const source = tree.read("packages/diagram/core/src/types.ts", "utf-8") ?? "";
		const start = source.indexOf(`export const ${name} = [`);
		const entries = source.slice(start, source.indexOf("]", start));
		return [...entries.matchAll(/"([^"]+)"/gu)].map((match) => match[1] ?? "");
	}

	function runGeneratedModule(source: string): Record<string, { title: string }> {
		const compiled = ts.transpileModule(source, {
			fileName: "timeline.ts",
			reportDiagnostics: true,
			compilerOptions: {
				module: ts.ModuleKind.CommonJS,
				target: ts.ScriptTarget.ES2022,
			},
		});
		expect(
			(compiled.diagnostics ?? []).map((diagnostic) =>
				ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
			),
		).toEqual([]);
		const generatedExports: Record<string, { title: string }> = {};
		runInNewContext(compiled.outputText, {
			exports: generatedExports,
			require: (specifier: string) => {
				if (specifier === "effect") {
					return {
						Schema: {
							Literal: (value: string) => value,
							decodeUnknownSync: () => (input: unknown) => input,
						},
					};
				}
				expect(specifier).toBe("../intermediate.js");
				return {
					IntermediateDiagram: { extend: () => () => class {} },
					validateIntermediateDiagram: (diagram: unknown) => diagram,
				};
			},
		});
		return generatedExports;
	}

	it.each([
		"Generated timeline",
		"Research & Development",
		"Say \"hello\" and 'goodbye'",
		String.raw`C:\new\diagram`,
		"Line one\nLine two",
	])("registers a compilable contract and round-trips title %j", async (title) => {
		const printChecklist = await diagramTypeGenerator(tree, { ...options, title });

		expect(registry("DIAGRAM_TYPES")).toEqual(["flowchart", "mindmap", "sequence", "timeline"]);
		expect(registry("GRAPH_DIAGRAM_TYPES")).toEqual(["flowchart", "mindmap", "timeline"]);
		expect(tree.exists("packages/diagram/core/src/types/timeline.test.ts")).toBe(true);
		expect(tree.exists("packages/diagram/renderer/src/diagram-types/timeline.test.ts")).toBe(true);
		expect(tree.exists("packages/diagram/ui/src/diagram-types/timeline.stories.tsx")).toBe(true);
		expect(tree.read("packages/diagram/core/src/index.ts", "utf-8")).toContain(
			'export * from "./types/timeline.js";',
		);

		const source = tree.read("packages/diagram/core/src/types/timeline.ts", "utf-8") ?? "";
		expect(source).toContain("export class TimelineDiagram extends IntermediateDiagram.extend");
		expect(runGeneratedModule(source).timelineFixture?.title).toBe(title);

		const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
		printChecklist();
		expect(info.mock.calls.flat().join("\n")).toContain("docs/diagram-families.md");
		info.mockRestore();
	});

	it("does not duplicate a diagram type that is already in the registry", async () => {
		tree.write(
			"packages/diagram/core/src/types.ts",
			`export const DIAGRAM_TYPES = ["flowchart", "timeline"] as const;
export const GRAPH_DIAGRAM_TYPES = ["flowchart", "timeline"] as const;
`,
		);
		await diagramTypeGenerator(tree, { name: "timeline", skipFormat: true });

		expect(registry("DIAGRAM_TYPES")).toEqual(["flowchart", "timeline"]);
		expect(registry("GRAPH_DIAGRAM_TYPES")).toEqual(["flowchart", "timeline"]);
	});
});
