import {
  formatFiles,
  generateFiles,
  joinPathFragments,
  names,
  type Tree,
} from "@nx/devkit";
import path from "node:path";

import type { DiagramTypeGeneratorSchema } from "./schema";

const CORE_ROOT = "packages/diagram-core/src";
const RENDERER_ROOT = "packages/diagram-renderer/src";
const STUDIO_ROOT = "packages/diagram-studio-ui/src";

function appendExport(tree: Tree, indexPath: string, exportPath: string) {
  const exportLine = `export * from "${exportPath}";`;
  const existing = tree.exists(indexPath) ? tree.read(indexPath, "utf-8") : "";

  if (existing.includes(exportLine)) {
    return;
  }

  tree.write(indexPath, `${existing.trimEnd()}\n${exportLine}\n`);
}

function addDiagramTypeToRegistry(tree: Tree, typeValue: string) {
  const registryPath = joinPathFragments(CORE_ROOT, "diagram-types.ts");

  if (!tree.exists(registryPath)) {
    throw new Error(`Missing diagram type registry at ${registryPath}.`);
  }

  const registry = tree.read(registryPath, "utf-8");

  if (registry.includes(`"${typeValue}"`)) {
    return;
  }

  const marker = "] as const;";
  const markerIndex = registry.indexOf(marker);

  if (markerIndex === -1) {
    throw new Error(
      `Could not update diagram type registry at ${registryPath}.`,
    );
  }

  const beforeMarker = registry.slice(0, markerIndex);
  const afterMarker = registry.slice(markerIndex);
  const beforeInsertion = beforeMarker.trimEnd().endsWith(",")
    ? beforeMarker
    : beforeMarker.replace(/(\S)(\s*)$/, "$1,$2");
  const nextRegistry = `${beforeInsertion}  "${typeValue}",\n${afterMarker}`;

  tree.write(registryPath, nextRegistry);
}

export async function diagramTypeGenerator(
  tree: Tree,
  options: DiagramTypeGeneratorSchema,
) {
  const normalizedName = names(options.name);
  const typeValue = normalizedName.fileName;
  const title = options.title ?? `${normalizedName.className} diagram`;
  const fixtureName = `${normalizedName.propertyName}Fixture`;
  const coreFilePath = joinPathFragments(
    CORE_ROOT,
    "diagram-types",
    `${typeValue}.ts`,
  );
  const templateContext = {
    className: normalizedName.className,
    fixtureName,
    propertyName: normalizedName.propertyName,
    title,
    typeValue,
  };

  if (tree.exists(coreFilePath)) {
    throw new Error(`Diagram type already exists at ${coreFilePath}.`);
  }

  addDiagramTypeToRegistry(tree, typeValue);
  generateFiles(
    tree,
    path.join(__dirname, "files", "core"),
    joinPathFragments(CORE_ROOT, "diagram-types"),
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
    path.join(__dirname, "files", "studio"),
    joinPathFragments(STUDIO_ROOT, "diagram-types"),
    templateContext,
  );

  appendExport(
    tree,
    joinPathFragments(CORE_ROOT, "index.ts"),
    `./diagram-types/${typeValue}.js`,
  );

  if (!options.skipFormat) {
    await formatFiles(tree);
  }
}

export default diagramTypeGenerator;
