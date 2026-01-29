import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tool } from "@opencode-ai/plugin";
import { gradeByChartType } from "../../../packages/backend/experiments/lib/grading";
import {
  closeBrowser,
  renderDiagramToPng,
  validateExcalidrawImageDataUrls,
  validateExcalidrawSceneJson,
} from "../../../packages/backend/experiments/lib/render-png";
import {
  type Diagram,
  DiagramSchema,
} from "../../../packages/backend/lib/diagram-structure";

type ChartType = "flowchart" | "architecture" | "decision-tree" | "mindmap";
const CHART_TYPES: ChartType[] = [
  "flowchart",
  "architecture",
  "decision-tree",
  "mindmap",
];

function assertChartType(value: string): ChartType {
  if (CHART_TYPES.includes(value as ChartType)) {
    return value as ChartType;
  }
  throw new Error(
    `Invalid chartType: ${value}. Expected one of ${CHART_TYPES.join(", ")}`
  );
}

interface RenderResult {
  pngBase64: string;
  bytes: number;
  durationMs: number;
  outputPath?: string;
}

interface GradeResult {
  grading: Record<string, unknown>;
  tokens?: number;
  outputPath?: string;
}

interface ValidationResult {
  totalImages: number;
  failedImages: Array<{ id: string; label?: string | null }>;
  loadOk: boolean;
  loadError?: string | null;
  svgErrors: Array<{ id: string; label?: string | null; error: string }>;
  harnessErrors?: string[];
  harnessLogs?: string[];
  imageValidationMs: number;
  sceneValidationMs: number;
  outputPath?: string;
}

function resolveOutputPath(path: string): string {
  return resolve(process.cwd(), path);
}

async function ensureDir(path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
}

function parseDiagram(value: unknown): Diagram {
  const parsed = DiagramSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(
      `Invalid diagram input: ${parsed.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; ")}`
    );
  }
  return parsed.data;
}

function getImageLabels(scene: {
  elements?: Array<Record<string, unknown>>;
}): Map<string, string> {
  const elements = scene.elements ?? [];
  const labelsByGroup = new Map<string, string>();

  for (const element of elements) {
    if (element.type === "text" && Array.isArray(element.groupIds)) {
      const text = typeof element.text === "string" ? element.text : "";
      for (const groupId of element.groupIds) {
        if (!labelsByGroup.has(groupId) && text) {
          labelsByGroup.set(groupId, text);
        }
      }
    }
  }

  return labelsByGroup;
}

async function validateExcalidrawScene(
  scenePath: string,
  outputPath?: string
): Promise<ValidationResult> {
  const raw = await readFile(resolveOutputPath(scenePath), "utf-8");
  const scene = JSON.parse(raw) as {
    elements?: Array<Record<string, unknown>>;
    files?: Record<string, { id: string; dataURL: string }>;
  };

  const files = scene.files ?? {};
  const fileEntries = Object.values(files).map((file) => ({
    id: file.id,
    dataURL: file.dataURL,
  }));

  const labelsByGroup = getImageLabels(scene);
  const labelByFileId = new Map<string, string>();
  for (const element of scene.elements ?? []) {
    if (element.type === "image" && typeof element.fileId === "string") {
      const groupIds = Array.isArray(element.groupIds)
        ? (element.groupIds as string[])
        : [];
      const label = groupIds.find((id) => labelsByGroup.has(id))
        ? labelsByGroup.get(groupIds.find((id) => labelsByGroup.has(id))!)
        : undefined;
      if (label) {
        labelByFileId.set(element.fileId, label);
      }
    }
  }

  const imageValidation = await validateExcalidrawImageDataUrls(fileEntries);
  const sceneValidation = await validateExcalidrawSceneJson(raw);

  const failedImages = imageValidation.results
    .filter((result) => !result.ok)
    .map((result) => ({
      id: result.id,
      label: labelByFileId.get(result.id) ?? null,
    }));

  const svgErrors = sceneValidation.svgErrors.map((error) => ({
    id: error.id,
    label: labelByFileId.get(error.id) ?? null,
    error: error.error,
  }));

  let resolvedOutputPath: string | undefined;
  if (outputPath) {
    resolvedOutputPath = resolveOutputPath(outputPath);
    await ensureDir(resolvedOutputPath);
    await writeFile(
      resolvedOutputPath,
      JSON.stringify(
        {
          totalImages: fileEntries.length,
          failedImages,
          loadOk: sceneValidation.loadOk,
          loadError: sceneValidation.loadError,
          svgErrors,
          harnessErrors: sceneValidation.harnessErrors,
          harnessLogs: sceneValidation.harnessLogs,
          imageValidationMs: imageValidation.durationMs,
          sceneValidationMs: sceneValidation.durationMs,
        },
        null,
        2
      )
    );
  }

  return {
    totalImages: fileEntries.length,
    failedImages,
    loadOk: sceneValidation.loadOk,
    loadError: sceneValidation.loadError,
    svgErrors,
    harnessErrors: sceneValidation.harnessErrors,
    harnessLogs: sceneValidation.harnessLogs,
    imageValidationMs: imageValidation.durationMs,
    sceneValidationMs: sceneValidation.durationMs,
    outputPath: resolvedOutputPath,
  };
}

async function renderDiagram(
  diagram: Diagram,
  options: {
    chartType?: ChartType;
    scale?: number;
    padding?: number;
    background?: boolean;
    outputPath?: string;
  }
): Promise<RenderResult> {
  try {
    const result = await renderDiagramToPng(diagram, {
      chartType: options.chartType ?? "flowchart",
      scale: options.scale,
      padding: options.padding,
      background: options.background,
    });

    const pngBase64 = result.png.toString("base64");
    let outputPath: string | undefined;

    if (options.outputPath) {
      outputPath = resolveOutputPath(options.outputPath);
      await ensureDir(outputPath);
      await writeFile(outputPath, result.png);
    }

    return {
      pngBase64,
      bytes: result.png.length,
      durationMs: result.durationMs,
      outputPath,
    };
  } finally {
    await closeBrowser();
  }
}

async function gradeDiagram(options: {
  chartType: ChartType;
  prompt: string;
  pngPath?: string;
  pngBase64?: string;
  outputPath?: string;
}): Promise<GradeResult> {
  if (!process.env.AI_GATEWAY_API_KEY) {
    throw new Error("Missing AI_GATEWAY_API_KEY environment variable");
  }

  if (!(options.pngPath || options.pngBase64)) {
    throw new Error("Provide pngPath or pngBase64");
  }

  let tempPath: string | undefined;
  let pngPath = options.pngPath;

  if (!pngPath && options.pngBase64) {
    tempPath = resolve(tmpdir(), `sketchi-visual-grade-${Date.now()}.png`);
    await writeFile(tempPath, Buffer.from(options.pngBase64, "base64"));
    pngPath = tempPath;
  }

  try {
    const result = await gradeByChartType(
      options.chartType,
      options.prompt,
      pngPath
    );

    let outputPath: string | undefined;
    if (options.outputPath) {
      outputPath = resolveOutputPath(options.outputPath);
      await ensureDir(outputPath);
      await writeFile(
        outputPath,
        JSON.stringify(
          {
            chartType: options.chartType,
            prompt: options.prompt,
            grading: result.grading,
            tokens: result.tokens,
          },
          null,
          2
        )
      );
    }

    return {
      grading: result.grading,
      tokens: result.tokens,
      outputPath,
    };
  } finally {
    if (tempPath) {
      await rm(tempPath, { force: true });
    }
  }
}

export const ExcalidrawLocalPlugin = () => {
  return {
    tool: {
      excalidraw_png_local: tool({
        description:
          "Render a diagram to PNG locally using Excalidraw (returns base64).",
        args: {
          diagram: tool.schema
            .unknown()
            .describe("Diagram object with shapes/arrows"),
          chartType: tool.schema
            .enum(["flowchart", "architecture", "decision-tree", "mindmap"])
            .optional()
            .describe("Layout style for rendering"),
          scale: tool.schema
            .number()
            .optional()
            .describe("Export scale factor"),
          padding: tool.schema
            .number()
            .optional()
            .describe("Export padding in pixels"),
          background: tool.schema
            .boolean()
            .optional()
            .describe("Include white background"),
          outputPath: tool.schema
            .string()
            .optional()
            .describe("Optional path to write PNG"),
        },
        async execute(args) {
          const diagram = parseDiagram(args.diagram);
          const result = await renderDiagram(diagram, {
            chartType: args.chartType,
            scale: args.scale,
            padding: args.padding,
            background: args.background,
            outputPath: args.outputPath,
          });
          return JSON.stringify(result, null, 2);
        },
      }),
      visual_grade_local: tool({
        description:
          "Grade a PNG diagram locally with a vision model and return scores.",
        args: {
          chartType: tool.schema.enum([
            "flowchart",
            "architecture",
            "decision-tree",
            "mindmap",
          ]),
          prompt: tool.schema.string().describe("Original diagram prompt"),
          pngPath: tool.schema.string().optional().describe("Path to PNG file"),
          pngBase64: tool.schema
            .string()
            .optional()
            .describe("Base64-encoded PNG"),
          outputPath: tool.schema
            .string()
            .optional()
            .describe("Optional path to write grading JSON"),
        },
        async execute(args) {
          const result = await gradeDiagram({
            chartType: args.chartType,
            prompt: args.prompt,
            pngPath: args.pngPath,
            pngBase64: args.pngBase64,
            outputPath: args.outputPath,
          });
          return JSON.stringify(result, null, 2);
        },
      }),
      excalidraw_validate_local: tool({
        description:
          "Validate Excalidraw scene file (load + SVG normalize + image decode).",
        args: {
          scenePath: tool.schema
            .string()
            .describe("Path to .excalidraw scene JSON file"),
          outputPath: tool.schema
            .string()
            .optional()
            .describe("Optional path to write validation JSON"),
        },
        async execute(args) {
          const result = await validateExcalidrawScene(
            args.scenePath,
            args.outputPath
          );
          return JSON.stringify(result, null, 2);
        },
      }),
    },
  };
};

async function runCli() {
  const [command, ...rest] = process.argv.slice(2);

  if (!command || command === "--help" || command === "-h") {
    console.log(
      [
        "Usage:",
        "  bun run .opencode/plugins/sketchi/excalidraw-to-png-local.ts png <diagram.json> [output.png] [chartType]",
        "  bun run .opencode/plugins/sketchi/excalidraw-to-png-local.ts grade <chartType> <prompt.txt> <pngPath> [output.json]",
        "  bun run .opencode/plugins/sketchi/excalidraw-to-png-local.ts validate <scene.excalidraw> [output.json]",
        "",
      ].join("\n")
    );
    process.exit(0);
  }

  if (command === "png") {
    const [diagramPath, outputPath, chartType] = rest;
    if (!diagramPath) {
      throw new Error("Missing diagram.json path");
    }

    const raw = await readFile(resolveOutputPath(diagramPath), "utf-8");
    const diagram = parseDiagram(JSON.parse(raw));
    const output = outputPath
      ? resolveOutputPath(outputPath)
      : resolveOutputPath(diagramPath.replace(extname(diagramPath), ".png"));

    const result = await renderDiagram(diagram, {
      chartType: chartType ? assertChartType(chartType) : undefined,
      outputPath: output,
    });

    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === "grade") {
    const [chartType, promptPath, pngPath, outputPath] = rest;
    if (!(chartType && promptPath && pngPath)) {
      throw new Error("Usage: grade <chartType> <prompt.txt> <pngPath>");
    }

    const prompt = await readFile(resolveOutputPath(promptPath), "utf-8");
    const result = await gradeDiagram({
      chartType: assertChartType(chartType),
      prompt,
      pngPath: resolveOutputPath(pngPath),
      outputPath: outputPath ? resolveOutputPath(outputPath) : undefined,
    });

    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === "validate") {
    const [scenePath, outputPath] = rest;
    if (!scenePath) {
      throw new Error("Usage: validate <scene.excalidraw> [output.json]");
    }

    const result = await validateExcalidrawScene(scenePath, outputPath);
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

const isDirectRun =
  process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isDirectRun) {
  runCli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}

export default ExcalidrawLocalPlugin;
