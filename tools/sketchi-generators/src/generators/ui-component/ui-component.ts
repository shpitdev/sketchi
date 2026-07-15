import {
  formatFiles,
  generateFiles,
  joinPathFragments,
  names,
  type Tree,
} from "@nx/devkit";
import path from "node:path";

import type { UiComponentGeneratorSchema } from "./schema";

const DEFAULT_PROJECT_ROOT = "packages/diagram-studio-ui";
const DEFAULT_DIRECTORY = "components";

function appendExport(tree: Tree, indexPath: string, exportPath: string) {
  const exportLine = `export * from "${exportPath}";`;
  const existing = tree.exists(indexPath) ? tree.read(indexPath, "utf-8") : "";

  if (existing.includes(exportLine)) {
    return;
  }

  const nextContent = `${existing.trimEnd()}\n${exportLine}\n`;
  tree.write(indexPath, nextContent);
}

export async function uiComponentGenerator(
  tree: Tree,
  options: UiComponentGeneratorSchema,
) {
  const normalizedName = names(options.name);
  const projectRoot = options.projectRoot ?? DEFAULT_PROJECT_ROOT;
  const directory = options.directory ?? DEFAULT_DIRECTORY;
  const sourceRoot = joinPathFragments(projectRoot, "src");
  const componentRoot = joinPathFragments(
    sourceRoot,
    directory,
    normalizedName.fileName,
  );
  const componentPath = joinPathFragments(
    componentRoot,
    `${normalizedName.fileName}.tsx`,
  );
  const indexPath = joinPathFragments(sourceRoot, "index.ts");
  const exportPath = `./${directory}/${normalizedName.fileName}/index.js`;
  const storyTitle = `Diagram Studio/Components/${normalizedName.className}`;

  if (tree.exists(componentPath)) {
    throw new Error(`Component already exists at ${componentPath}.`);
  }

  generateFiles(tree, path.join(__dirname, "files"), componentRoot, {
    className: normalizedName.className,
    fileName: normalizedName.fileName,
    storyTitle,
  });
  appendExport(tree, indexPath, exportPath);

  if (!options.skipFormat) {
    await formatFiles(tree);
  }
}

export default uiComponentGenerator;
