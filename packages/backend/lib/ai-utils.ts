import { gateway, generateObject, generateText, type LanguageModel } from "ai";
import type { z } from "zod";

export const AI_CONFIG = {
  DEFAULT_TIMEOUT_MS: 60_000,
  MAX_RETRIES: 3,
  BASE_DELAY_MS: 1000,
  MAX_DELAY_MS: 30_000,
  DEFAULT_MODEL: "google/gemini-3-flash",
} as const;

export interface AICallOptions {
  timeoutMs?: number;
  maxRetries?: number;
  temperature?: number;
}

export interface RetryOptions {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  onRetry?: (attempt: number, error: Error, delayMs: number) => void;
}

export class AIError extends Error {
  readonly cause?: Error;
  readonly isRetryable: boolean;

  constructor(message: string, cause?: Error, isRetryable = true) {
    super(message);
    this.name = "AIError";
    this.cause = cause;
    this.isRetryable = isRetryable;
  }
}

export class AITimeoutError extends AIError {
  constructor(timeoutMs: number) {
    super(`AI call timed out after ${timeoutMs}ms`, undefined, true);
    this.name = "AITimeoutError";
  }
}

export class AIValidationError extends AIError {
  constructor(message: string, cause?: Error) {
    super(message, cause, false);
    this.name = "AIValidationError";
  }
}

function calculateBackoff(
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number
): number {
  const exponentialDelay = baseDelayMs * 2 ** attempt;
  const jitter = Math.random() * 0.3 * exponentialDelay;
  return Math.min(exponentialDelay + jitter, maxDelayMs);
}

function isRetryableError(error: unknown): boolean {
  if (error instanceof AIError) {
    return error.isRetryable;
  }

  if (error instanceof Error) {
    const message = error.message.toLowerCase();

    if (message.includes("network") || message.includes("fetch")) {
      return true;
    }

    if (message.includes("rate limit") || message.includes("429")) {
      return true;
    }

    if (message.includes("timeout") || message.includes("aborted")) {
      return true;
    }

    if (
      message.includes("500") ||
      message.includes("502") ||
      message.includes("503")
    ) {
      return true;
    }
  }

  return false;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: Partial<RetryOptions> = {}
): Promise<T> {
  const {
    maxRetries = AI_CONFIG.MAX_RETRIES,
    baseDelayMs = AI_CONFIG.BASE_DELAY_MS,
    maxDelayMs = AI_CONFIG.MAX_DELAY_MS,
    onRetry,
  } = options;

  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt === maxRetries || !isRetryableError(error)) {
        throw lastError;
      }

      const delayMs = calculateBackoff(attempt, baseDelayMs, maxDelayMs);

      if (onRetry) {
        onRetry(attempt + 1, lastError, delayMs);
      }

      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw lastError || new Error("Retry failed with no error");
}

export function getModel(modelId?: string): LanguageModel {
  return gateway(modelId ?? AI_CONFIG.DEFAULT_MODEL);
}

export function generateTextWithRetry(
  options: Parameters<typeof generateText>[0] & AICallOptions
): Promise<Awaited<ReturnType<typeof generateText>>> {
  const {
    timeoutMs = AI_CONFIG.DEFAULT_TIMEOUT_MS,
    maxRetries = AI_CONFIG.MAX_RETRIES,
    ...generateOptions
  } = options;

  return withRetry(
    () =>
      generateText({
        ...generateOptions,
        abortSignal: AbortSignal.timeout(timeoutMs),
      }),
    {
      maxRetries,
      onRetry: (attempt, error, delayMs) => {
        console.log(
          `[AI] Retry ${attempt}/${maxRetries} after ${delayMs}ms: ${error.message}`
        );
      },
    }
  );
}

export function generateObjectWithRetry<SCHEMA extends z.ZodType>(
  options: Parameters<typeof generateObject<SCHEMA>>[0] & AICallOptions
): Promise<{ object: z.infer<SCHEMA>; usage?: { totalTokens?: number } }> {
  const {
    timeoutMs = AI_CONFIG.DEFAULT_TIMEOUT_MS,
    maxRetries = AI_CONFIG.MAX_RETRIES,
    ...generateOptions
  } = options;

  return withRetry(
    async () => {
      const result = await generateObject<SCHEMA>({
        ...generateOptions,
        abortSignal: AbortSignal.timeout(timeoutMs),
      } as Parameters<typeof generateObject<SCHEMA>>[0]);
      return {
        object: result.object as z.infer<SCHEMA>,
        usage: result.usage,
      };
    },
    {
      maxRetries,
      onRetry: (attempt, error, delayMs) => {
        console.log(
          `[AI] Retry ${attempt}/${maxRetries} after ${delayMs}ms: ${error.message}`
        );
      },
    }
  );
}

export interface TestResult {
  name: string;
  success: boolean;
  durationMs: number;
  tokens?: number;
  error?: string;
  metadata?: Record<string, unknown>;
}

export async function runTest<T>(
  name: string,
  fn: () => Promise<T>,
  validate?: (result: T) => boolean
): Promise<TestResult & { result?: T }> {
  const start = Date.now();

  try {
    const result = await fn();
    const durationMs = Date.now() - start;
    const success = validate ? validate(result) : true;

    return {
      name,
      success,
      durationMs,
      result,
    };
  } catch (error) {
    const durationMs = Date.now() - start;
    return {
      name,
      success: false,
      durationMs,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function printTestResults(results: TestResult[]): void {
  console.log(`\n${"=".repeat(70)}`);
  console.log("TEST RESULTS");
  console.log("=".repeat(70));

  const passed = results.filter((r) => r.success).length;
  const total = results.length;

  for (const result of results) {
    const status = result.success ? "PASS" : "FAIL";
    const duration = `${result.durationMs}ms`;
    const tokens = result.tokens ? `${result.tokens} tokens` : "";
    const error = result.error ? `Error: ${result.error.slice(0, 50)}` : "";

    console.log(
      `${status.padEnd(5)} | ${result.name.padEnd(40)} | ${duration.padEnd(10)} | ${tokens.padEnd(15)} | ${error}`
    );
  }

  console.log("=".repeat(70));
  console.log(
    `SUMMARY: ${passed}/${total} passed (${Math.round((passed / total) * 100)}%)`
  );
  console.log(`${"=".repeat(70)}\n`);
}
