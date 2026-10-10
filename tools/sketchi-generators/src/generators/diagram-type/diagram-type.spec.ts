import { createTreeWithEmptyWorkspace } from "@nx/devkit/testing";
import type { Tree } from "@nx/devkit";
import { runInNewContext } from "node:vm";
import ts from "typescript";

import { diagramTypeGenerator } from "./diagram-type";
import type { DiagramTypeGeneratorSchema } from "./schema";

describe("diagram-type generator", () => {
	let tree: Tree;
	const options: DiagramTypeGeneratorSchema = {
		name: "mindmap",
		title: "Generated mindmap",
		skipFormat: true,
	};

	beforeEach(() => {
		tree = createTreeWithEmptyWorkspace();
		tree.write(
			"packages/diagram/core/src/types.ts",
			`export const DIAGRAM_TYPES = [
  "architecture",
  "flowchart"
] as const;
`,
		);
		tree.write("packages/diagram/core/src/index.ts", "");
	});

	it.each([
		"Generated mindmap",
		"Research & Development",
		"Say \"hello\" and 'goodbye'",
		String.raw`C:\new\diagram`,
		"Line one\nLine two",
	])("creates diagram contracts and round-trips title %j in valid TypeScript", async (title) => {
		await diagramTypeGenerator(tree, { ...options, title });

		expect(tree.read("packages/diagram/core/src/types.ts", "utf-8")).toContain('"mindmap"');
		expect(tree.exists("packages/diagram/core/src/types/mindmap.ts")).toBe(true);
		expect(tree.exists("packages/diagram/renderer/src/diagram-types/mindmap.test.ts")).toBe(true);
		expect(tree.exists("packages/diagram/ui/src/diagram-types/mindmap.stories.tsx")).toBe(true);
		expect(tree.read("packages/diagram/core/src/index.ts", "utf-8")).toContain(
			'export * from "./types/mindmap.js";',
		);

		const source = tree.read("packages/diagram/core/src/types/mindmap.ts", "utf-8");
		if (source === null) throw new Error("Missing generated module");
		const compiled = ts.transpileModule(source, {
			fileName: "mindmap.ts",
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
				expect(specifier).toBe("../intermediate.js");
				return { parseIntermediateDiagram: (diagram: unknown) => diagram };
			},
		});
		expect(generatedExports.mindmapFixture?.title).toBe(title);
	});

	it("does not duplicate a diagram type that is already in the registry", async () => {
		await diagramTypeGenerator(tree, {
			name: "flowchart",
			skipFormat: true,
		});

		const registry = tree.read("packages/diagram/core/src/types.ts", "utf-8");

		expect((registry ?? "").match(/"flowchart"/g)).toHaveLength(1);
		expect(tree.exists("packages/diagram/core/src/types/flowchart.ts")).toBe(true);
	});
});
