// Experiment 0.2: AI Generation Quality
// Run: AI_GATEWAY_API_KEY=xxx bun run packages/backend/experiments/ai-generation.ts

import { gateway } from "@ai-sdk/gateway";
import { generateText } from "ai";
import { repairJsonClosure } from "./json-repair";

const AI_GATEWAY_API_KEY = process.env.AI_GATEWAY_API_KEY;
if (!AI_GATEWAY_API_KEY) {
  console.error("Missing AI_GATEWAY_API_KEY environment variable");
  process.exit(1);
}

const MODELS = [
  { name: "gemini-3-flash", model: gateway("google/gemini-3-flash") },
];

const PROMPTS = [
  "Simple flowchart: Start -> Process -> End",
  "Architecture: Load balancer -> 3 API servers -> Database",
  "Data pipeline: S3 -> ETL -> Data Warehouse -> BI Dashboard",
];

const EXCALIDRAW_SYSTEM_PROMPT = `You generate Excalidraw diagram elements as JSON.

## Output Format
Return ONLY a JSON array of ExcalidrawElementSkeleton objects. No markdown, no explanation.

## Element Types
- Shapes (rectangle, ellipse, diamond): Required: type, id, x, y. Optional: width, height, backgroundColor, strokeColor, label: { text }
- Arrows: Required: type, id, x, y. Optional: start: { id }, end: { id }, label: { text }

## Rules
- Always include "id" on shapes so arrows can reference them
- Position elements logically left-to-right
- Leave 200+ pixels between elements

## Example
[
  { "type": "rectangle", "id": "a", "x": 0, "y": 0, "width": 120, "height": 60, "label": { "text": "Start" } },
  { "type": "rectangle", "id": "b", "x": 250, "y": 0, "width": 120, "height": 60, "label": { "text": "End" } },
  { "type": "arrow", "id": "arr1", "x": 120, "y": 30, "start": { "id": "a" }, "end": { "id": "b" } }
]`;

interface TestResult {
  prompt: string;
  model: string;
  success: boolean;
  elementCount: number;
  tokens: number;
  latencyMs: number;
  error?: string;
}

function validateElements(elements: unknown[]): boolean {
  if (!Array.isArray(elements)) {
    return false;
  }
  return elements.every(
    (e) => typeof e === "object" && e !== null && "id" in e && "type" in e
  );
}

async function testGeneration() {
  console.log("=== Experiment 0.2: AI Generation Quality ===\n");

  const results: TestResult[] = [];

  for (const modelConfig of MODELS) {
    console.log(`\nTesting model: ${modelConfig.name}`);
    console.log("-".repeat(50));

    for (const prompt of PROMPTS) {
      const start = Date.now();
      try {
        const { text, usage } = await generateText({
          model: modelConfig.model,
          prompt,
          system: EXCALIDRAW_SYSTEM_PROMPT,
        });

        const latencyMs = Date.now() - start;
        const repaired = repairJsonClosure(text);
        const elements = JSON.parse(repaired) as unknown[];
        const success = validateElements(elements);

        results.push({
          prompt,
          model: modelConfig.name,
          success,
          elementCount: elements.length,
          tokens: usage?.totalTokens ?? 0,
          latencyMs,
        });

        console.log(
          `${success ? "PASS" : "FAIL"} | ${prompt.slice(0, 35).padEnd(35)} | ${elements.length} elements | ${usage?.totalTokens ?? 0} tokens | ${latencyMs}ms`
        );
      } catch (e) {
        const latencyMs = Date.now() - start;
        const error = e instanceof Error ? e.message : String(e);
        results.push({
          prompt,
          model: modelConfig.name,
          success: false,
          elementCount: 0,
          tokens: 0,
          latencyMs,
          error,
        });
        console.log(
          `FAIL | ${prompt.slice(0, 35).padEnd(35)} | Error: ${error}`
        );
      }
    }
  }

  console.log(`\n${"=".repeat(60)}`);
  console.log("SUMMARY");
  console.log("=".repeat(60));

  for (const modelConfig of MODELS) {
    const modelResults = results.filter((r) => r.model === modelConfig.name);
    const passed = modelResults.filter((r) => r.success).length;
    const total = modelResults.length;
    const avgTokens = Math.round(
      modelResults.reduce((sum, r) => sum + r.tokens, 0) / total
    );
    const avgLatency = Math.round(
      modelResults.reduce((sum, r) => sum + r.latencyMs, 0) / total
    );

    console.log(
      `${modelConfig.name}: ${passed}/${total} passed (${Math.round((passed / total) * 100)}%) | avg ${avgTokens} tokens | avg ${avgLatency}ms`
    );
  }

  const allPassed = results.every((r) => r.success);
  console.log(`\n=== RESULT: ${allPassed ? "PASS" : "FAIL"} ===`);

  return { success: allPassed, results };
}

testGeneration().then((result) => {
  process.exit(result.success ? 0 : 1);
});
