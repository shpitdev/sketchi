import {
	formatFiles,
	generateFiles,
	joinPathFragments,
	logger,
	names,
	type Tree,
} from "@nx/devkit";
import path from "node:path";

import type { DiagramTypeGeneratorSchema } from "./schema";

const CORE_ROOT = "packages/diagram/core/src";
const RENDERER_ROOT = "packages/diagram/renderer/src";
const UI_ROOT = "packages/diagram/ui/src";

function appendExport(tree: Tree, indexPath: string, exportPath: string) {
	const exportLine = `export * from "${exportPath}";`;
	const existing = tree.exists(indexPath) ? (tree.read(indexPath, "utf-8") ?? "") : "";

	if (existing.includes(exportLine)) {
		return;
	}

	tree.write(indexPath, `${existing.trimEnd()}\n${exportLine}\n`);
}

/** Append a literal to the `export const <registry> = [...] as const` array. */
function addToRegistryArray(registry: string, name: string, typeValue: string): string {
	const declaration = registry.indexOf(`export const ${name} = [`);
	if (declaration === -1) {
		throw new Error(`Could not find ${name} in the diagram type registry.`);
	}
	const markerIndex = registry.indexOf("]", declaration);
	const entries = registry.slice(declaration, markerIndex);
	if (entries.includes(`"${typeValue}"`)) {
		return registry;
	}
	const beforeMarker = registry.slice(0, markerIndex).trimEnd();
	const separator = beforeMarker.endsWith("[") || beforeMarker.endsWith(",") ? "" : ",";
	return `${beforeMarker}${separator}\n\t"${typeValue}",\n${registry.slice(markerIndex)}`;
}

/**
 * Register the family in DIAGRAM_TYPES and, because the scaffold is a node/edge
 * contract, in GRAPH_DIAGRAM_TYPES.
 */
function addDiagramTypeToRegistry(tree: Tree, typeValue: string) {
	const registryPath = joinPathFragments(CORE_ROOT, "types.ts");
	const registry = tree.exists(registryPath) ? tree.read(registryPath, "utf-8") : null;
	if (registry === null) {
		throw new Error(`Missing diagram type registry at ${registryPath}.`);
	}
	tree.write(
		registryPath,
		addToRegistryArray(
			addToRegistryArray(registry, "DIAGRAM_TYPES", typeValue),
			"GRAPH_DIAGRAM_TYPES",
			typeValue,
		),
	);
}

export async function diagramTypeGenerator(tree: Tree, options: DiagramTypeGeneratorSchema) {
	const normalizedName = names(options.name);
	const typeValue = normalizedName.fileName;
	const title = options.title ?? `${normalizedName.className} diagram`;
	const fixtureName = `${normalizedName.propertyName}Fixture`;
	const coreFilePath = joinPathFragments(CORE_ROOT, "types", `${typeValue}.ts`);
	const templateContext = {
		className: normalizedName.className,
		fixtureName,
		propertyName: normalizedName.propertyName,
		titleLiteral: JSON.stringify(title),
		typeValue,
	};

	if (tree.exists(coreFilePath)) {
		throw new Error(`Diagram type already exists at ${coreFilePath}.`);
	}

	addDiagramTypeToRegistry(tree, typeValue);
	generateFiles(
		tree,
		path.join(__dirname, "files", "core"),
		joinPathFragments(CORE_ROOT, "types"),
		templateContext,
	);
	generateFiles(
		tree,
		path.join(__dirname, "files", "renderer"),
		joinPathFragments(RENDERER_ROOT, "diagram-types"),
		templateContext,
	);
	generateFiles(
		tree,
		path.join(__dirname, "files", "ui"),
		joinPathFragments(UI_ROOT, "diagram-types"),
		templateContext,
	);

	appendExport(tree, joinPathFragments(CORE_ROOT, "index.ts"), `./types/${typeValue}.js`);

	if (!options.skipFormat) {
		await formatFiles(tree);
	}

	return () => {
		logger.info(
			[
				`Scaffolded the "${typeValue}" contract, its tests, and a Storybook story.`,
				"The compiler and tools/diagram-families.test.ts now fail until every pipeline stage exists:",
				"contract registry, renderer, Excalidraw conversion, generation prompt and parsing,",
				"Code Mode build, CLI dispatch, maintained scenarios, and Storybook.",
				"Follow docs/diagram-families.md.",
			].join("\n"),
		);
	};
}

export default diagramTypeGenerator;
