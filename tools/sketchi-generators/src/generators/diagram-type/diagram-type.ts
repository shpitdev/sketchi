import path from "node:path";
import {
  formatFiles,
  generateFiles,
  joinPathFragments,
  names,
  type Tree,
} from "@nx/devkit";

import type { DiagramTypeGeneratorSchema } from "./schema";

const CORE_ROOT = "packages/diagram-core/src";
const RENDERER_ROOT = "packages/diagram-renderer/src";
const STUDIO_ROOT = "packages/diagram-studio-ui/src";
const CATALOG_ITEMS_MARKER = "] satisfies DiagramCatalogEntry[];";
const FIXTURE_MAP_MARKER = "} as const;";
const REGISTRY_TRAILING_VALUE_PATTERN = /(\S)(\s*)$/;

function appendExport(tree: Tree, indexPath: string, exportPath: string) {
  const exportLine = `export * from "${exportPath}";`;
  const existing = tree.exists(indexPath)
    ? (tree.read(indexPath, "utf-8") ?? "")
    : "";

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

  const registry = tree.read(registryPath, "utf-8") ?? "";

  if (registry.includes(`"${typeValue}"`)) {
    return;
  }

  const marker = "] as const;";
  const markerIndex = registry.indexOf(marker);

  if (markerIndex === -1) {
    throw new Error(
      `Could not update diagram type registry at ${registryPath}.`
    );
  }

  const beforeMarker = registry.slice(0, markerIndex);
  const afterMarker = registry.slice(markerIndex);
  const beforeInsertion = beforeMarker.trimEnd().endsWith(",")
    ? beforeMarker
    : beforeMarker.replace(REGISTRY_TRAILING_VALUE_PATTERN, "$1,$2");
  const nextRegistry = `${beforeInsertion}  "${typeValue}",\n${afterMarker}`;

  tree.write(registryPath, nextRegistry);
}

function prependImportIfMissing(
  tree: Tree,
  filePath: string,
  importLine: string
) {
  const existing = tree.exists(filePath)
    ? (tree.read(filePath, "utf-8") ?? "")
    : "";

  if (existing.includes(importLine)) {
    return existing;
  }

  const nextSource = `${importLine}\n${existing}`;
  tree.write(filePath, nextSource);

  return nextSource;
}

function insertBeforeMarker(
  tree: Tree,
  filePath: string,
  marker: string,
  content: string,
  alreadyPresentText: string
) {
  const source = tree.exists(filePath)
    ? (tree.read(filePath, "utf-8") ?? "")
    : "";

  if (source.includes(alreadyPresentText)) {
    return;
  }

  const markerIndex = source.indexOf(marker);

  if (markerIndex === -1) {
    throw new Error(`Could not update ${filePath}; missing marker ${marker}.`);
  }

  tree.write(
    filePath,
    `${source.slice(0, markerIndex)}${content}${source.slice(markerIndex)}`
  );
}

function addDiagramFixture(tree: Tree, typeValue: string, fixtureName: string) {
  const fixturesPath = joinPathFragments(CORE_ROOT, "fixtures.ts");

  if (!tree.exists(fixturesPath)) {
    throw new Error(`Missing fixture registry at ${fixturesPath}.`);
  }

  prependImportIfMissing(
    tree,
    fixturesPath,
    `import { ${fixtureName} } from "./diagram-types/${typeValue}";`
  );
  insertBeforeMarker(
    tree,
    fixturesPath,
    FIXTURE_MAP_MARKER,
    `  "${typeValue}": ${fixtureName},\n`,
    `"${typeValue}":`
  );
}

function addDiagramCatalogEntry(
  tree: Tree,
  options: {
    description: string;
    fixtureName: string;
    label: string;
    prompt: string;
    typeValue: string;
  }
) {
  const catalogPath = joinPathFragments(CORE_ROOT, "diagram-catalog.ts");

  if (!tree.exists(catalogPath)) {
    throw new Error(`Missing diagram catalog at ${catalogPath}.`);
  }

  prependImportIfMissing(
    tree,
    catalogPath,
    `import { ${options.fixtureName} } from "./diagram-types/${options.typeValue}";`
  );
  insertBeforeMarker(
    tree,
    catalogPath,
    CATALOG_ITEMS_MARKER,
    `  {
    description: ${JSON.stringify(options.description)},
    diagram: ${options.fixtureName},
    id: ${JSON.stringify(options.typeValue)},
    label: ${JSON.stringify(options.label)},
    prompt: ${JSON.stringify(options.prompt)},
  },
`,
    `id: ${JSON.stringify(options.typeValue)}`
  );
}

export async function diagramTypeGenerator(
  tree: Tree,
  options: DiagramTypeGeneratorSchema
) {
  const normalizedName = names(options.name);
  const typeValue = normalizedName.fileName;
  const title = options.title ?? `${normalizedName.className} diagram`;
  const label = options.label ?? normalizedName.className;
  const description = options.description ?? `Generated ${title} fixture`;
  const prompt = options.prompt ?? `Render the ${title} fixture.`;
  const fixtureName = `${normalizedName.propertyName}Fixture`;
  const coreFilePath = joinPathFragments(
    CORE_ROOT,
    "diagram-types",
    `${typeValue}.ts`
  );
  const templateContext = {
    className: normalizedName.className,
    description,
    fixtureName,
    label,
    prompt,
    propertyName: normalizedName.propertyName,
    title,
    typeValue,
  };

  if (tree.exists(coreFilePath)) {
    throw new Error(`Diagram type already exists at ${coreFilePath}.`);
  }

  addDiagramTypeToRegistry(tree, typeValue);
  addDiagramFixture(tree, typeValue, fixtureName);
  addDiagramCatalogEntry(tree, {
    description,
    fixtureName,
    label,
    prompt,
    typeValue,
  });
  generateFiles(
    tree,
    path.join(__dirname, "files", "core"),
    joinPathFragments(CORE_ROOT, "diagram-types"),
    templateContext
  );
  generateFiles(
    tree,
    path.join(__dirname, "files", "renderer"),
    joinPathFragments(RENDERER_ROOT, "diagram-types"),
    templateContext
  );
  generateFiles(
    tree,
    path.join(__dirname, "files", "studio"),
    joinPathFragments(STUDIO_ROOT, "diagram-types"),
    templateContext
  );

  appendExport(
    tree,
    joinPathFragments(CORE_ROOT, "index.ts"),
    `./diagram-types/${typeValue}`
  );

  if (!options.skipFormat) {
    await formatFiles(tree);
  }
}

export default diagramTypeGenerator;
