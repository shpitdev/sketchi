import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const workspaceRoot = process.cwd();
const projectRoot = path.join(workspaceRoot, "packages", "diagram-studio-ui");
const storybookRoot = path.join(
  workspaceRoot,
  "dist",
  "storybook",
  "diagram-studio-ui"
);
const storyIndexPath = path.join(storybookRoot, "index.json");
const sourceStoryRoots = [
  path.join(projectRoot, "src", "components"),
  path.join(projectRoot, "src", "diagram-types"),
];

function listStoryFiles(root) {
  if (!existsSync(root)) {
    return [];
  }

  return readdirSync(root)
    .flatMap((entry) => {
      const entryPath = path.join(root, entry);

      if (statSync(entryPath).isDirectory()) {
        return listStoryFiles(entryPath);
      }

      return entryPath.endsWith(".stories.tsx") ? [entryPath] : [];
    })
    .sort();
}

function toStorybookImportPath(filePath) {
  const relativePath = path
    .relative(projectRoot, filePath)
    .split(path.sep)
    .join("/");

  return `./${relativePath}`;
}

function readStoryEntries() {
  if (!existsSync(storyIndexPath)) {
    throw new Error(
      `Missing Storybook index at ${storyIndexPath}. Run the build-storybook target first.`
    );
  }

  const storyIndex = JSON.parse(readFileSync(storyIndexPath, "utf-8"));

  return Object.values(storyIndex.entries ?? {}).filter(
    (entry) => entry.type === "story"
  );
}

const expectedStoryPaths = sourceStoryRoots
  .flatMap(listStoryFiles)
  .map((filePath) => ({
    filePath,
    importPath: toStorybookImportPath(filePath),
  }));
const storyEntries = readStoryEntries();
const indexedImportPaths = new Set(
  storyEntries.map((entry) => entry.importPath).filter(Boolean)
);
const missingStoryPaths = expectedStoryPaths.filter(
  ({ importPath }) => !indexedImportPaths.has(importPath)
);

if (missingStoryPaths.length > 0) {
  console.error("Storybook is missing source stories:");

  for (const { importPath } of missingStoryPaths) {
    console.error(`- ${importPath}`);
  }

  process.exit(1);
}

console.log(
  `Verified ${expectedStoryPaths.length} source story files across ${storyEntries.length} static Storybook stories.`
);
