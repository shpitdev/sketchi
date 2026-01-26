/**
 * TEST SCENARIO: Visual Grading with PNG Generation
 *
 * GIVEN: A natural language diagram prompt
 * WHEN: We generate the diagram and render it to PNG
 * THEN: The PNG is graded by an LLM for adherence to the original prompt
 */

import { readFile } from "node:fs/promises";
import { z } from "zod";
import { analyzeContent } from "../agents/content-analyzer";
import { generateDiagramDirect } from "../agents/diagram-generator";
import {
  generateObjectWithRetry,
  getModel,
  printTestResults,
  type TestResult,
} from "../lib/ai-utils";
import { createOutputSession, type OutputSession } from "../lib/output";
import { closeBrowser, renderDiagramToPng } from "../lib/render-png";

const AI_GATEWAY_API_KEY = process.env.AI_GATEWAY_API_KEY;
if (!AI_GATEWAY_API_KEY) {
  console.error("Missing AI_GATEWAY_API_KEY environment variable");
  process.exit(1);
}

const PNG_TIMEOUT_MS = 30_000;

const GradingResultSchema = z.object({
  score: z.number().min(0).max(100).describe("Overall adherence score 0-100"),
  componentScore: z
    .number()
    .min(0)
    .max(100)
    .describe("Are all requested components present?"),
  layoutScore: z
    .number()
    .min(0)
    .max(100)
    .describe("Is the layout clear and logical?"),
  connectionScore: z
    .number()
    .min(0)
    .max(100)
    .describe("Are connections/arrows correct?"),
  issues: z.array(z.string()).describe("List of specific issues found"),
  strengths: z.array(z.string()).describe("List of things done well"),
});

type GradingResult = z.infer<typeof GradingResultSchema>;

async function gradeDiagram(
  prompt: string,
  pngPath: string
): Promise<GradingResult> {
  const pngBuffer = await readFile(pngPath);
  const base64Png = pngBuffer.toString("base64");

  const result = await generateObjectWithRetry({
    model: getModel("google/gemini-3-flash"),
    schema: GradingResultSchema,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `You are a diagram quality evaluator. Grade this diagram for adherence to the original prompt.

Original prompt: "${prompt}"

Evaluate the diagram image and provide scores for:
1. componentScore: Are all requested components/nodes present? (0-100)
2. layoutScore: Is the layout clear, readable, and logical? (0-100)
3. connectionScore: Are the connections/arrows between components correct? (0-100)
4. score: Overall adherence to the prompt (0-100)

Also list specific issues and strengths.`,
          },
          {
            type: "image",
            image: base64Png,
          },
        ],
      },
    ],
    timeoutMs: 60_000,
    maxRetries: 2,
  });

  return result.object;
}

interface TestCase {
  name: string;
  prompt: string;
  minScore: number;
}

const TEST_CASES: TestCase[] = [
  {
    name: "Simple flowchart",
    prompt:
      "Create a flowchart with three steps: Start, Process, End. Connect them with arrows.",
    minScore: 70,
  },
  {
    name: "Architecture diagram",
    prompt:
      "Draw an architecture with: Frontend, API Gateway, Backend Service, Database. Show connections between each layer.",
    minScore: 70,
  },
  {
    name: "Decision tree",
    prompt:
      "Create a decision flowchart: User logs in -> Check credentials -> If valid: Show dashboard, If invalid: Show error",
    minScore: 60,
  },
];

async function runTestCase(
  testCase: TestCase,
  session: OutputSession
): Promise<TestResult> {
  const start = Date.now();
  const safeName = testCase.name.toLowerCase().replace(/\s+/g, "-");

  try {
    console.log("  Analyzing prompt...");
    const analysis = await analyzeContent(testCase.prompt);

    console.log("  Generating diagram...");
    const diagram = generateDiagramDirect(analysis.intermediate);

    await session.saveJson(`${safeName}-intermediate`, analysis.intermediate);
    await session.saveJson(`${safeName}-diagram`, diagram);

    console.log(`  Rendering PNG (timeout: ${PNG_TIMEOUT_MS}ms)...`);
    const renderStart = Date.now();

    const renderPromise = renderDiagramToPng(diagram);
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(
        () => reject(new Error(`PNG render timeout after ${PNG_TIMEOUT_MS}ms`)),
        PNG_TIMEOUT_MS
      );
    });

    const renderResult = await Promise.race([renderPromise, timeoutPromise]);
    const renderDuration = Date.now() - renderStart;

    if (renderDuration > PNG_TIMEOUT_MS) {
      throw new Error(
        `PNG render took too long: ${renderDuration}ms > ${PNG_TIMEOUT_MS}ms`
      );
    }

    const pngPath = await session.savePng(safeName, renderResult.png);
    console.log(`  PNG saved: ${pngPath} (${renderResult.durationMs}ms)`);

    console.log("  Grading with vision LLM...");
    const grading = await gradeDiagram(testCase.prompt, pngPath);

    await session.saveJson(`${safeName}-grading`, grading);

    const passed = grading.score >= testCase.minScore;

    return {
      name: testCase.name,
      success: passed,
      durationMs: Date.now() - start,
      metadata: {
        score: grading.score,
        componentScore: grading.componentScore,
        layoutScore: grading.layoutScore,
        connectionScore: grading.connectionScore,
        minScore: testCase.minScore,
        passed,
        renderDurationMs: renderResult.durationMs,
        issues: grading.issues,
        strengths: grading.strengths,
        pngPath,
      },
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    const isPngTimeout =
      errorMessage.includes("timeout") || errorMessage.includes("PNG render");

    return {
      name: testCase.name,
      success: false,
      durationMs: Date.now() - start,
      error: errorMessage,
      metadata: {
        failureType: isPngTimeout ? "png_timeout" : "other",
      },
    };
  }
}

async function runAllTests() {
  console.log("=== Visual Grading Test Suite ===\n");

  const session = await createOutputSession("visual-grading");
  console.log(`Output directory: ${session.dir}\n`);

  const results: TestResult[] = [];

  for (const testCase of TEST_CASES) {
    console.log(`Running: ${testCase.name}...`);
    const result = await runTestCase(testCase, session);
    results.push(result);
    console.log(
      `  ${result.success ? "PASS" : "FAIL"} (score: ${(result.metadata as Record<string, unknown>)?.score ?? "N/A"})\n`
    );
  }

  await closeBrowser();

  printTestResults(results);

  for (const result of results) {
    if (result.metadata) {
      console.log(`\n${result.name}:`);
      console.log(JSON.stringify(result.metadata, null, 2));
    }
  }

  await session.saveJson("summary", {
    timestamp: session.timestamp,
    results: results.map((r) => ({
      name: r.name,
      success: r.success,
      durationMs: r.durationMs,
      score: (r.metadata as Record<string, unknown>)?.score,
      error: r.error,
    })),
    passRate: `${results.filter((r) => r.success).length}/${results.length}`,
  });

  console.log(`\nResults saved to: ${session.dir}`);

  const allPassed = results.every((r) => r.success);
  return { success: allPassed, results };
}

runAllTests().then((result) => {
  process.exit(result.success ? 0 : 1);
});
