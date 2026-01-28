import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

const TRAILING_SLASH_REGEX = /\/$/;

export type StagehandEnv = "LOCAL" | "BROWSERBASE";

export interface StagehandRunConfig {
  baseUrl: string;
  env: StagehandEnv;
  modelName: string;
  openrouterApiKey: string;
  vercelBypassSecret?: string;
  browserbaseApiKey?: string;
  browserbaseProjectId?: string;
  headless: boolean;
  chromePath?: string;
  screenshotsEnabled: boolean;
  screenshotsDir: string;
  cacheDir: string;
  verbose: 0 | 1 | 2;
  visionModelName: string;
}

const DEFAULT_MODEL = "google/gemini-2.5-flash-lite";
const DEFAULT_VISION_MODEL = "google/gemini-3-flash-preview";

export function loadConfig(): StagehandRunConfig {
  const repoRoot = findRepoRoot();
  if (repoRoot) {
    const envFiles = [
      { file: ".env.local", override: false },
      { file: ".env.e2e", override: false },
    ];
    for (const { file, override } of envFiles) {
      dotenv.config({
        path: path.join(repoRoot, file),
        override,
      });
    }
  } else {
    dotenv.config();
  }

  const baseUrl = normalizeBaseUrl(
    firstEnv("STAGEHAND_TARGET_URL", "NEXT_PUBLIC_SITE_URL") ||
      "http://localhost:3001"
  );
  const browserEnv = normalizeEnv(
    firstEnv("STAGEHAND_ENV", "STAGEHAND_BROWSER")
  );
  const modelName = firstEnv("MODEL_NAME") || DEFAULT_MODEL;
  const visionModelName = firstEnv("VISION_MODEL_NAME") || DEFAULT_VISION_MODEL;
  const openrouterApiKey = firstEnv("OPENROUTER_API_KEY");
  const vercelBypassSecret = firstEnv("VERCEL_AUTOMATION_BYPASS_SECRET");

  if (!openrouterApiKey) {
    throw new Error("Missing required env var: OPENROUTER_API_KEY");
  }

  const chromePath =
    firstEnv("STAGEHAND_CHROME_PATH", "CHROME_PATH") || undefined;

  const cfg: StagehandRunConfig = {
    baseUrl,
    env: browserEnv,
    modelName,
    openrouterApiKey,
    vercelBypassSecret,
    visionModelName,
    browserbaseApiKey: firstEnv("BROWSERBASE_API_KEY"),
    browserbaseProjectId: firstEnv("BROWSERBASE_PROJECT_ID"),
    headless: parseBoolean(firstEnv("STAGEHAND_HEADLESS"), true),
    chromePath,
    screenshotsEnabled: parseBoolean(firstEnv("STAGEHAND_SCREENSHOTS"), true),
    screenshotsDir: resolvePath(
      repoRoot,
      firstEnv("STAGEHAND_SCREENSHOTS_DIR"),
      ["tests", "e2e", "artifacts"]
    ),
    cacheDir: resolvePath(repoRoot, firstEnv("STAGEHAND_CACHE_DIR"), [
      "tests",
      "e2e",
      "artifacts",
      "cache",
    ]),
    verbose: parseVerbose(firstEnv("STAGEHAND_VERBOSE")),
  };

  if (cfg.env === "BROWSERBASE") {
    const missing: string[] = [];
    if (!cfg.browserbaseApiKey) {
      missing.push("BROWSERBASE_API_KEY");
    }
    if (!cfg.browserbaseProjectId) {
      missing.push("BROWSERBASE_PROJECT_ID");
    }
    if (missing.length > 0) {
      throw new Error(`Missing required env vars: ${missing.join(", ")}`);
    }
  }

  return cfg;
}

function normalizeEnv(value?: string): StagehandEnv {
  if (!value) {
    return "BROWSERBASE";
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "local") {
    return "LOCAL";
  }
  return "BROWSERBASE";
}

function normalizeBaseUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "http://localhost:3001";
  }
  return trimmed.replace(TRAILING_SLASH_REGEX, "");
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (!value) {
    return fallback;
  }
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function parseVerbose(value: string | undefined): 0 | 1 | 2 {
  if (!value) {
    return 0;
  }
  const parsed = Number(value);
  if (parsed === 1) {
    return 1;
  }
  if (parsed === 2) {
    return 2;
  }
  return 0;
}

function resolvePath(
  root: string | undefined,
  override: string | undefined,
  segments: string[]
): string {
  if (override) {
    return path.isAbsolute(override)
      ? override
      : path.join(root ?? process.cwd(), override);
  }
  return path.join(root ?? process.cwd(), ...segments);
}

function findRepoRoot(): string | undefined {
  let current = process.cwd();
  for (;;) {
    if (fs.existsSync(path.join(current, ".git"))) {
      return current;
    }
    const next = path.dirname(current);
    if (next === current) {
      return undefined;
    }
    current = next;
  }
}

function firstEnv(...keys: string[]): string {
  for (const key of keys) {
    const value = process.env[key];
    if (value?.trim()) {
      return value.trim();
    }
  }
  return "";
}
