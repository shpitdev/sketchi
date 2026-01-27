import { readdir, readFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const repoRoot = resolve(dirname(__filename), "..");
const svgDir = join(
  repoRoot,
  "packages",
  "backend",
  "seed",
  "palantir-icons",
  "svgs"
);
const entrypoint = join(
  repoRoot,
  "apps",
  "web",
  "src",
  "lib",
  "icon-library",
  "svg-to-excalidraw.ts"
);

const styleSettings = {
  strokeColor: "#1f2937",
  backgroundColor: "transparent",
  strokeWidth: 1,
  strokeStyle: "solid",
  fillStyle: "solid",
  roughness: 0,
  opacity: 100,
};

const buildResult = await Bun.build({
  entrypoints: [entrypoint],
  format: "cjs",
  minify: false,
});

if (!buildResult.success) {
  console.error("Failed to build svg-to-excalidraw module.");
  for (const log of buildResult.logs) {
    console.error(log.message);
  }
  process.exit(1);
}

const [output] = buildResult.outputs;
if (!output) {
  console.error("No build output generated.");
  process.exit(1);
}

const scriptContent = await output.text();
const wrappedScript = [
  "var module = { exports: {} };",
  "var exports = module.exports;",
  scriptContent,
  "window.SvgConversion = module.exports;",
].join("\n");

const entries = await readdir(svgDir, { withFileTypes: true });
const svgFiles = entries
  .filter((entry) => entry.isFile() && entry.name.endsWith(".svg"))
  .map((entry) => entry.name)
  .sort();

if (svgFiles.length === 0) {
  console.error(`No SVG files found in ${svgDir}`);
  process.exit(1);
}

const playwrightPath = join(
  repoRoot,
  "packages",
  "backend",
  "node_modules",
  "playwright",
  "index.js"
);
const playwright = await import(pathToFileURL(playwrightPath).href);
const { chromium } = playwright as typeof import("playwright");

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.setContent("<html><body></body></html>");
await page.addScriptTag({ content: wrappedScript });

const results: Array<{ file: string; elements: number; error?: string }> = [];

for (const file of svgFiles) {
  const filePath = join(svgDir, file);
  const svgText = await readFile(filePath, "utf-8");
  try {
    const elements = await page.evaluate(
      ({ svgText, styleSettings }) => {
        const converter = (
          window as typeof window & {
            SvgConversion?: {
              svgToExcalidrawElements: (
                svg: string,
                settings: typeof styleSettings
              ) => unknown[];
            };
          }
        ).SvgConversion;

        if (!converter) {
          throw new Error("SvgConversion not available.");
        }
        const output = converter.svgToExcalidrawElements(
          svgText,
          styleSettings
        );
        return Array.isArray(output) ? output.length : 0;
      },
      { svgText, styleSettings }
    );

    results.push({ file: basename(filePath), elements });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    results.push({ file: basename(filePath), elements: 0, error: message });
  }
}

await browser.close();

let hasErrors = false;
for (const result of results) {
  if (result.error) {
    hasErrors = true;
    console.log(`${result.file}: error ${result.error}`);
  } else {
    console.log(`${result.file}: ${result.elements} elements`);
  }
}

if (hasErrors) {
  process.exit(1);
}
