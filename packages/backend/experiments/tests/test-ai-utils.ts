/**
 * TEST SCENARIO: AI Utils - Timeout and Retry Logic
 *
 * GIVEN: AI utility functions with timeout and retry capabilities
 * WHEN: We call generateTextWithRetry with a valid prompt
 * THEN: It should return a result within the timeout period
 *
 * GIVEN: A function that fails transiently
 * WHEN: We call withRetry
 * THEN: It should retry up to maxRetries times with exponential backoff
 *
 * GIVEN: A function that always fails with a non-retryable error
 * WHEN: We call withRetry
 * THEN: It should fail immediately without retrying
 */

import { z } from "zod";
import {
  AI_CONFIG,
  generateObjectWithRetry,
  generateTextWithRetry,
  getModel,
  printTestResults,
  type TestResult,
  withRetry,
} from "../lib/ai-utils";

const AI_GATEWAY_API_KEY = process.env.AI_GATEWAY_API_KEY;
if (!AI_GATEWAY_API_KEY) {
  console.error("Missing AI_GATEWAY_API_KEY environment variable");
  process.exit(1);
}

async function testWithRetrySuccess(): Promise<TestResult> {
  const start = Date.now();
  let callCount = 0;

  try {
    const result = await withRetry(
      () => {
        callCount++;
        return Promise.resolve("success");
      },
      { maxRetries: 3 }
    );

    return {
      name: "withRetry - success on first try",
      success: result === "success" && callCount === 1,
      durationMs: Date.now() - start,
      metadata: { callCount },
    };
  } catch (err) {
    return {
      name: "withRetry - success on first try",
      success: false,
      durationMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function testWithRetryTransientFailure(): Promise<TestResult> {
  const start = Date.now();
  let callCount = 0;

  try {
    const result = await withRetry(
      () => {
        callCount++;
        if (callCount < 3) {
          return Promise.reject(new Error("Transient network error"));
        }
        return Promise.resolve("success after retries");
      },
      { maxRetries: 3, baseDelayMs: 100, maxDelayMs: 500 }
    );

    return {
      name: "withRetry - success after transient failures",
      success: result === "success after retries" && callCount === 3,
      durationMs: Date.now() - start,
      metadata: { callCount },
    };
  } catch (err) {
    return {
      name: "withRetry - success after transient failures",
      success: false,
      durationMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function testWithRetryExhaustion(): Promise<TestResult> {
  const start = Date.now();
  let callCount = 0;

  try {
    await withRetry(
      () => {
        callCount++;
        return Promise.reject(new Error("Always fails with timeout"));
      },
      { maxRetries: 2, baseDelayMs: 50, maxDelayMs: 100 }
    );

    return {
      name: "withRetry - exhausts all retries",
      success: false,
      durationMs: Date.now() - start,
      error: "Should have thrown",
    };
  } catch (_) {
    return {
      name: "withRetry - exhausts all retries",
      success: callCount === 3,
      durationMs: Date.now() - start,
      metadata: { callCount },
    };
  }
}

async function testGenerateTextWithRetry(): Promise<TestResult> {
  const start = Date.now();

  try {
    const result = await generateTextWithRetry({
      model: getModel(),
      prompt: "Say 'hello' and nothing else",
      timeoutMs: 30_000,
      maxRetries: 2,
    });

    const hasText = result.text.toLowerCase().includes("hello");

    return {
      name: "generateTextWithRetry - basic call",
      success: hasText,
      durationMs: Date.now() - start,
      tokens: result.usage?.totalTokens,
      metadata: { textLength: result.text.length },
    };
  } catch (error) {
    return {
      name: "generateTextWithRetry - basic call",
      success: false,
      durationMs: Date.now() - start,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function testGenerateObjectWithRetry(): Promise<TestResult> {
  const start = Date.now();

  const SimpleSchema = z.object({
    greeting: z.string(),
    count: z.number(),
  });

  try {
    const result = await generateObjectWithRetry({
      model: getModel(),
      schema: SimpleSchema,
      prompt: "Generate a greeting with a random count between 1 and 10",
      timeoutMs: 30_000,
      maxRetries: 2,
    });

    const isValid =
      typeof result.object.greeting === "string" &&
      typeof result.object.count === "number" &&
      result.object.count >= 1 &&
      result.object.count <= 10;

    return {
      name: "generateObjectWithRetry - simple schema",
      success: isValid,
      durationMs: Date.now() - start,
      tokens: result.usage?.totalTokens,
      metadata: { object: result.object },
    };
  } catch (error) {
    return {
      name: "generateObjectWithRetry - simple schema",
      success: false,
      durationMs: Date.now() - start,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function testGenerateObjectWithWrappedDiscriminatedUnion(): Promise<TestResult> {
  const start = Date.now();

  const ShapeSchema = z.object({
    type: z.literal("rectangle"),
    id: z.string(),
    label: z.string(),
  });

  const ArrowSchema = z.object({
    type: z.literal("arrow"),
    id: z.string(),
    from: z.string(),
    to: z.string(),
  });

  const DiagramSchema = z.object({
    elements: z.array(z.discriminatedUnion("type", [ShapeSchema, ArrowSchema])),
  });

  try {
    const result = await generateObjectWithRetry({
      model: getModel(),
      schema: DiagramSchema,
      prompt:
        "Create a simple diagram with 2 rectangles (A labeled 'Start', B labeled 'End') and an arrow from A to B",
      timeoutMs: 60_000,
      maxRetries: 2,
    });

    const hasShapes = result.object.elements.filter(
      (e) => e.type === "rectangle"
    ).length;
    const hasArrows = result.object.elements.filter(
      (e) => e.type === "arrow"
    ).length;

    return {
      name: "generateObjectWithRetry - wrapped discriminated union",
      success: hasShapes >= 2 && hasArrows >= 1,
      durationMs: Date.now() - start,
      tokens: result.usage?.totalTokens,
      metadata: {
        elementCount: result.object.elements.length,
        shapes: hasShapes,
        arrows: hasArrows,
      },
    };
  } catch (error) {
    return {
      name: "generateObjectWithRetry - wrapped discriminated union",
      success: false,
      durationMs: Date.now() - start,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function runAllTests() {
  console.log("=== AI Utils Test Suite ===\n");
  console.log(
    `Config: timeout=${AI_CONFIG.DEFAULT_TIMEOUT_MS}ms, retries=${AI_CONFIG.MAX_RETRIES}\n`
  );

  const results: TestResult[] = [];

  console.log("Running: withRetry tests...");
  results.push(await testWithRetrySuccess());
  results.push(await testWithRetryTransientFailure());
  results.push(await testWithRetryExhaustion());

  console.log("Running: generateTextWithRetry test...");
  results.push(await testGenerateTextWithRetry());

  console.log("Running: generateObjectWithRetry tests...");
  results.push(await testGenerateObjectWithRetry());
  results.push(await testGenerateObjectWithWrappedDiscriminatedUnion());

  printTestResults(results);

  const allPassed = results.every((r) => r.success);
  return { success: allPassed, results };
}

runAllTests().then((result) => {
  process.exit(result.success ? 0 : 1);
});
